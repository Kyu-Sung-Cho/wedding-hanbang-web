import * as SecureStore from "expo-secure-store";
import {
  isCommunityDecisionUuid,
  parseCommunityDecisionDraft,
  parseCommunityDecisionMutationPending,
  type CommunityDecisionDraft,
  type CommunityDecisionMutationPending,
} from "./communityDecisionThread.mjs";
import {
  appendCommunityDecisionMutationIndex,
  communityDecisionDraftKey,
  communityDecisionMutationIndexBackupKey,
  communityDecisionMutationIndexKey,
  communityDecisionMutationKey,
  communityDecisionPendingKey,
  purgeCommunityDecisionOwnerKeys,
  resolveCommunityDecisionMutationIndexCopies,
  type CommunityDecisionMutationIndex,
} from "./communityDecisionPendingIndex.mjs";

const SUBMITTING_UNKNOWN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const COMMUNITY_DECISION_WAITLIST_PENDING_MAX_AGE_DAYS = 30;
const WAITLIST_PENDING_MAX_AGE_MS =
  COMMUNITY_DECISION_WAITLIST_PENDING_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const SECURE_STORE_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} as const;
const CREATE_BODY_KEYS = [
  "questionId",
  "title",
  "content",
  "topicCategory",
  "experienceScope",
  "coarseRegion",
  "preparationStage",
  "contractPhase",
  "desiredAnswer",
  "commercialRelationship",
  "sponsorshipDetail",
] as const;
const EXPERIENCE_SCOPES = new Set([
  "contract_terms",
  "extra_charge",
  "vendor_response",
  "cancellation_refund",
]);
const PREPARATION_STAGES = new Set([
  "vendor_search",
  "contract_review",
  "contracted",
  "dispute_or_cancellation",
]);
const CONTRACT_PHASES = new Set([
  "before_contract",
  "after_contract",
  "cancellation_or_refund",
]);
const COMMERCIAL_RELATIONSHIPS = new Set([
  "none",
  "gift",
  "discount",
  "refund",
  "affiliate",
  "paid",
  "employee",
  "owner_or_family",
  "platform_research_compensation",
]);

export type CommunityDecisionPendingSubmission = {
  ownerId: string;
  operationKey: string;
  questionId: string;
  bodyText: string;
  phase: "submitting_unknown" | "private_waitlist";
  commandId: string | null;
  createdAt: number;
  retryAt: number | null;
  withdrawOperationKey: string | null;
  withdrawBodyText: string | null;
};

const mutationIndexLocks = new Map<string, Promise<void>>();

async function withMutationIndexLock<T>(
  ownerId: string,
  work: () => Promise<T>,
): Promise<T> {
  if (!isCommunityDecisionUuid(ownerId)) {
    throw new Error("COMMUNITY_DECISION_MUTATION_OWNER_INVALID");
  }
  const normalizedOwnerId = ownerId.toLowerCase();
  const previous = mutationIndexLocks.get(normalizedOwnerId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  mutationIndexLocks.set(normalizedOwnerId, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (mutationIndexLocks.get(normalizedOwnerId) === tail) {
      mutationIndexLocks.delete(normalizedOwnerId);
    }
  }
}

async function writeMutationIndex(index: CommunityDecisionMutationIndex) {
  const raw = JSON.stringify(index);
  // The backup is committed first. A crash can leave a stale primary, but the
  // next read merges both owner-scoped copies and repairs them before use.
  await SecureStore.setItemAsync(
    communityDecisionMutationIndexBackupKey(index.ownerId),
    raw,
    SECURE_STORE_OPTIONS,
  );
  await SecureStore.setItemAsync(
    communityDecisionMutationIndexKey(index.ownerId),
    raw,
    SECURE_STORE_OPTIONS,
  );
}

async function deleteMutationIndex(ownerId: string) {
  const results = await Promise.allSettled([
    SecureStore.deleteItemAsync(communityDecisionMutationIndexKey(ownerId)),
    SecureStore.deleteItemAsync(
      communityDecisionMutationIndexBackupKey(ownerId),
    ),
  ]);
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("COMMUNITY_DECISION_MUTATION_INDEX_DELETE_FAILED");
  }
}

async function loadMutationIndex(ownerId: string) {
  const [primaryRaw, backupRaw] = await Promise.all([
    SecureStore.getItemAsync(communityDecisionMutationIndexKey(ownerId)),
    SecureStore.getItemAsync(
      communityDecisionMutationIndexBackupKey(ownerId),
    ),
  ]);
  const resolved = resolveCommunityDecisionMutationIndexCopies(
    primaryRaw,
    backupRaw,
    ownerId,
  );
  if (!resolved.ok) {
    throw new Error("COMMUNITY_DECISION_MUTATION_INDEX_CORRUPT");
  }
  if (resolved.needsRepair) await writeMutationIndex(resolved.index);
  return resolved.index;
}

async function updateMutationIndex(
  index: CommunityDecisionMutationIndex,
  questionIds: string[],
) {
  const next = {
    version: 1 as const,
    ownerId: index.ownerId,
    questionIds: [...new Set(questionIds.map((id) => id.toLowerCase()))].sort(),
  };
  if (next.questionIds.length > 64) {
    throw new Error("COMMUNITY_DECISION_MUTATION_INDEX_LIMIT_REACHED");
  }
  if (next.questionIds.length === 0) {
    await deleteMutationIndex(index.ownerId);
    return;
  }
  await writeMutationIndex(next);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isTrimmedText(value: unknown, min: number, max: number) {
  return typeof value === "string"
    && value === value.trim()
    && value.length >= min
    && value.length <= max;
}

function isExactCreateBody(value: unknown, questionId: string) {
  if (!isRecord(value) || !hasExactKeys(value, CREATE_BODY_KEYS)) return false;
  const relationship = value.commercialRelationship;
  const disclosureValid = relationship === "none"
    ? value.sponsorshipDetail === null
    : isTrimmedText(value.sponsorshipDetail, 3, 500);
  return value.questionId === questionId
    && isCommunityDecisionUuid(value.questionId)
    && isTrimmedText(value.title, 8, 160)
    && isTrimmedText(value.content, 20, 5_000)
    && value.topicCategory === "contract_extra_cost"
    && EXPERIENCE_SCOPES.has(value.experienceScope as string)
    && (value.coarseRegion === null || isTrimmedText(value.coarseRegion, 2, 40))
    && PREPARATION_STAGES.has(value.preparationStage as string)
    && CONTRACT_PHASES.has(value.contractPhase as string)
    && isTrimmedText(value.desiredAnswer, 5, 300)
    && COMMERCIAL_RELATIONSHIPS.has(relationship as string)
    && disclosureValid;
}

function isExactWaitlistWithdrawBody(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["expectedVersion", "reason"])
    && value.expectedVersion === null
    && isTrimmedText(value.reason, 3, 500);
}

function hasExactPendingBodies(submission: CommunityDecisionPendingSubmission) {
  try {
    if (!isExactCreateBody(JSON.parse(submission.bodyText) as unknown, submission.questionId)) {
      return false;
    }
    return submission.withdrawBodyText === null
      || isExactWaitlistWithdrawBody(JSON.parse(submission.withdrawBodyText) as unknown);
  } catch {
    return false;
  }
}

function isPendingSubmission(value: unknown): value is CommunityDecisionPendingSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return isCommunityDecisionUuid(record.ownerId)
    && isCommunityDecisionUuid(record.operationKey)
    && isCommunityDecisionUuid(record.questionId)
    && typeof record.bodyText === "string"
    && record.bodyText.length > 0
    && record.bodyText.length <= 100_000
    && (record.phase === "submitting_unknown" || record.phase === "private_waitlist")
    && (record.commandId === null || isCommunityDecisionUuid(record.commandId))
    && typeof record.createdAt === "number"
    && Number.isSafeInteger(record.createdAt)
    && record.createdAt >= 0
    && (record.retryAt === null || (
      typeof record.retryAt === "number"
      && Number.isSafeInteger(record.retryAt)
      && record.retryAt >= record.createdAt
      && record.retryAt <= record.createdAt + WAITLIST_PENDING_MAX_AGE_MS
    ))
    && (record.withdrawOperationKey === null
      || isCommunityDecisionUuid(record.withdrawOperationKey))
    && (record.withdrawBodyText === null
      || (typeof record.withdrawBodyText === "string"
        && record.withdrawBodyText.length > 0
        && record.withdrawBodyText.length <= 1_000))
    && ((record.withdrawOperationKey === null) === (record.withdrawBodyText === null))
    && (record.phase === "submitting_unknown"
      ? record.commandId === null
        && record.withdrawOperationKey === null
        && record.withdrawBodyText === null
      : isCommunityDecisionUuid(record.commandId));
}

export async function saveCommunityDecisionPending(
  submission: CommunityDecisionPendingSubmission,
) {
  if (!isPendingSubmission(submission) || !hasExactPendingBodies(submission)) {
    throw new Error("COMMUNITY_DECISION_PENDING_INVALID");
  }
  await SecureStore.setItemAsync(
    communityDecisionPendingKey(submission.ownerId),
    JSON.stringify(submission),
    SECURE_STORE_OPTIONS,
  );
}

export async function loadCommunityDecisionPending(ownerId: string) {
  const key = communityDecisionPendingKey(ownerId);
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    await SecureStore.deleteItemAsync(key);
    return null;
  }

  const now = Date.now();
  const maxAge = isPendingSubmission(value) && value.phase === "private_waitlist"
    ? WAITLIST_PENDING_MAX_AGE_MS
    : SUBMITTING_UNKNOWN_MAX_AGE_MS;
  if (
    !isPendingSubmission(value)
    || value.ownerId.toLowerCase() !== ownerId.toLowerCase()
    || value.createdAt > now + CLOCK_SKEW_MS
    || now - value.createdAt > maxAge
  ) {
    await SecureStore.deleteItemAsync(key);
    return null;
  }

  try {
    const body = JSON.parse(value.bodyText) as unknown;
    if (!isExactCreateBody(body, value.questionId)) {
      await SecureStore.deleteItemAsync(key);
      return null;
    }
    if (value.withdrawBodyText !== null) {
      const withdrawBody = JSON.parse(value.withdrawBodyText) as unknown;
      if (!isExactWaitlistWithdrawBody(withdrawBody)) {
        await SecureStore.deleteItemAsync(key);
        return null;
      }
    }
  } catch {
    await SecureStore.deleteItemAsync(key);
    return null;
  }

  return value;
}

export async function clearCommunityDecisionPending(ownerId: string) {
  await SecureStore.deleteItemAsync(communityDecisionPendingKey(ownerId));
}

export async function clearCommunityDecisionPendingIfMatches(
  ownerId: string,
  questionId: string,
  operationKey: string,
) {
  const current = await loadCommunityDecisionPending(ownerId);
  if (
    !current
    || current.questionId !== questionId
    || current.operationKey !== operationKey
  ) return false;
  await SecureStore.deleteItemAsync(communityDecisionPendingKey(ownerId));
  return true;
}

export async function saveCommunityDecisionMutationPending(
  pending: CommunityDecisionMutationPending,
) {
  const parsed = parseCommunityDecisionMutationPending(
    pending,
    pending.ownerId,
    pending.questionId,
  );
  if (!parsed) throw new Error("COMMUNITY_DECISION_MUTATION_PENDING_INVALID");
  await withMutationIndexLock(parsed.ownerId, async () => {
    const index = await loadMutationIndex(parsed.ownerId);
    if (!index.questionIds.includes(parsed.questionId.toLowerCase())) {
      const nextIndex = appendCommunityDecisionMutationIndex(
        index,
        parsed.questionId,
      );
      await writeMutationIndex(nextIndex);
    }
    await SecureStore.setItemAsync(
      communityDecisionMutationKey(parsed.ownerId, parsed.questionId),
      JSON.stringify(parsed),
      SECURE_STORE_OPTIONS,
    );
  });
}

export async function loadCommunityDecisionMutationPending(
  ownerId: string,
  questionId: string,
) {
  const key = communityDecisionMutationKey(ownerId, questionId);
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  try {
    const parsed = parseCommunityDecisionMutationPending(
      JSON.parse(raw) as unknown,
      ownerId,
      questionId,
    );
    if (parsed) return parsed;
  } catch {
    // Invalid encrypted values are removed below and never replayed.
  }
  await SecureStore.deleteItemAsync(key);
  return null;
}

export async function clearCommunityDecisionMutationPending(
  ownerId: string,
  questionId: string,
) {
  await withMutationIndexLock(ownerId, async () => {
    await SecureStore.deleteItemAsync(
      communityDecisionMutationKey(ownerId, questionId),
    );
    const index = await loadMutationIndex(ownerId);
    await updateMutationIndex(
      index,
      index.questionIds.filter((id) => id !== questionId.toLowerCase()),
    );
  });
}

export async function saveCommunityDecisionDraft(draft: CommunityDecisionDraft) {
  const validDraft = parseCommunityDecisionDraft(draft, draft.ownerId);
  if (!validDraft) throw new Error("COMMUNITY_DECISION_DRAFT_INVALID");
  await SecureStore.setItemAsync(
    communityDecisionDraftKey(draft.ownerId),
    JSON.stringify(validDraft),
    SECURE_STORE_OPTIONS,
  );
}

export async function loadCommunityDecisionDraft(ownerId: string) {
  const key = communityDecisionDraftKey(ownerId);
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  try {
    const parsed = parseCommunityDecisionDraft(JSON.parse(raw) as unknown, ownerId);
    if (parsed) return parsed;
  } catch {
    // Invalid encrypted values are removed below and never surfaced as text.
  }
  await SecureStore.deleteItemAsync(key);
  return null;
}

export async function clearCommunityDecisionDraft(ownerId: string) {
  await SecureStore.deleteItemAsync(communityDecisionDraftKey(ownerId));
}

export async function purgeCommunityDecisionPendingForOwner(ownerId: string) {
  await withMutationIndexLock(ownerId, async () => {
    const index = await loadMutationIndex(ownerId);
    await purgeCommunityDecisionOwnerKeys(
      ownerId,
      index,
      (key) => SecureStore.deleteItemAsync(key),
    );
  });
}

export async function purgeCommunityDecisionPendingForOwnerWithRetry(
  ownerId: string,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await purgeCommunityDecisionPendingForOwner(ownerId);
      return;
    } catch {
      if (attempt === 1) break;
    }
  }
  throw new Error("COMMUNITY_DECISION_OWNER_PURGE_UNCONFIRMED");
}
