const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_MUTATION_KEYS = 64;

export const COMMUNITY_DECISION_PENDING_KEY_PREFIX = "community_decision_pending_";
export const COMMUNITY_DECISION_DRAFT_KEY_PREFIX = "community_decision_draft_";
export const COMMUNITY_DECISION_MUTATION_KEY_PREFIX = "community_decision_mutation_";
export const COMMUNITY_DECISION_MUTATION_INDEX_KEY_PREFIX = "community_decision_mutation_index_";
export const COMMUNITY_DECISION_MUTATION_INDEX_BACKUP_KEY_PREFIX = "community_decision_mutation_index_backup_";

function normalizeUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function compactUuid(value, errorCode) {
  const normalized = normalizeUuid(value);
  if (!normalized) throw new Error(errorCode);
  return normalized.replaceAll("-", "");
}

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function parseIndexRaw(raw, expectedOwnerId) {
  if (raw === null) return { kind: "missing" };
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 10_000) {
    return { kind: "invalid" };
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: "invalid" };
  }
  if (
    !hasExactKeys(value, ["version", "ownerId", "questionIds"])
    || value.version !== 1
    || normalizeUuid(value.ownerId) !== expectedOwnerId
    || !Array.isArray(value.questionIds)
    || value.questionIds.length > MAX_MUTATION_KEYS
  ) return { kind: "invalid" };

  const questionIds = value.questionIds.map(normalizeUuid);
  if (questionIds.some((questionId) => questionId === null)) {
    return { kind: "invalid" };
  }
  const unique = [...new Set(questionIds)].sort();
  if (unique.length !== questionIds.length) return { kind: "invalid" };
  return {
    kind: "valid",
    index: {
      version: 1,
      ownerId: expectedOwnerId,
      questionIds: unique,
    },
  };
}

export function resolveCommunityDecisionMutationIndexCopies(
  primaryRaw,
  backupRaw,
  ownerId,
) {
  const normalizedOwnerId = normalizeUuid(ownerId);
  if (!normalizedOwnerId) return { ok: false, reason: "owner_invalid" };
  const primary = parseIndexRaw(primaryRaw, normalizedOwnerId);
  const backup = parseIndexRaw(backupRaw, normalizedOwnerId);
  const valid = [primary, backup].filter((copy) => copy.kind === "valid");

  if (valid.length === 0) {
    if (primary.kind === "missing" && backup.kind === "missing") {
      return {
        ok: true,
        index: { version: 1, ownerId: normalizedOwnerId, questionIds: [] },
        needsRepair: false,
      };
    }
    return { ok: false, reason: "corrupt" };
  }

  const questionIds = [...new Set(
    valid.flatMap((copy) => copy.index.questionIds),
  )].sort();
  if (questionIds.length > MAX_MUTATION_KEYS) {
    return { ok: false, reason: "corrupt" };
  }
  const index = { version: 1, ownerId: normalizedOwnerId, questionIds };
  const normalizedRaw = JSON.stringify(index);
  return {
    ok: true,
    index,
    needsRepair: primaryRaw !== normalizedRaw || backupRaw !== normalizedRaw,
  };
}

export function communityDecisionPendingKey(ownerId) {
  return `${COMMUNITY_DECISION_PENDING_KEY_PREFIX}${compactUuid(
    ownerId,
    "COMMUNITY_DECISION_PENDING_OWNER_INVALID",
  )}`;
}

export function communityDecisionDraftKey(ownerId) {
  return `${COMMUNITY_DECISION_DRAFT_KEY_PREFIX}${compactUuid(
    ownerId,
    "COMMUNITY_DECISION_DRAFT_OWNER_INVALID",
  )}`;
}

export function communityDecisionMutationKey(ownerId, questionId) {
  return `${COMMUNITY_DECISION_MUTATION_KEY_PREFIX}${compactUuid(
    ownerId,
    "COMMUNITY_DECISION_MUTATION_OWNER_INVALID",
  )}_${compactUuid(questionId, "COMMUNITY_DECISION_MUTATION_OWNER_INVALID")}`;
}

export function communityDecisionMutationIndexKey(ownerId) {
  return `${COMMUNITY_DECISION_MUTATION_INDEX_KEY_PREFIX}${compactUuid(
    ownerId,
    "COMMUNITY_DECISION_MUTATION_OWNER_INVALID",
  )}`;
}

export function communityDecisionMutationIndexBackupKey(ownerId) {
  return `${COMMUNITY_DECISION_MUTATION_INDEX_BACKUP_KEY_PREFIX}${compactUuid(
    ownerId,
    "COMMUNITY_DECISION_MUTATION_OWNER_INVALID",
  )}`;
}

export function buildCommunityDecisionOwnerPurgeKeys(ownerId, index) {
  const normalizedOwnerId = normalizeUuid(ownerId);
  if (
    !normalizedOwnerId
    || !index
    || index.version !== 1
    || normalizeUuid(index.ownerId) !== normalizedOwnerId
    || !Array.isArray(index.questionIds)
    || index.questionIds.length > MAX_MUTATION_KEYS
  ) throw new Error("COMMUNITY_DECISION_MUTATION_INDEX_INVALID");
  const questionIds = index.questionIds.map(normalizeUuid);
  if (
    questionIds.some((questionId) => questionId === null)
    || new Set(questionIds).size !== questionIds.length
  ) throw new Error("COMMUNITY_DECISION_MUTATION_INDEX_INVALID");

  return [
    communityDecisionPendingKey(normalizedOwnerId),
    communityDecisionDraftKey(normalizedOwnerId),
    communityDecisionMutationIndexKey(normalizedOwnerId),
    communityDecisionMutationIndexBackupKey(normalizedOwnerId),
    ...questionIds.sort().map((questionId) => (
      communityDecisionMutationKey(normalizedOwnerId, questionId)
    )),
  ];
}

export function appendCommunityDecisionMutationIndex(index, questionId) {
  // Reuse the purge-key validator so an invalid owner/index can never be
  // normalized into a different account's key space.
  buildCommunityDecisionOwnerPurgeKeys(index?.ownerId, index);
  const normalizedQuestionId = normalizeUuid(questionId);
  if (!normalizedQuestionId) {
    throw new Error("COMMUNITY_DECISION_MUTATION_INDEX_INVALID");
  }
  if (index.questionIds.includes(normalizedQuestionId)) {
    return {
      version: 1,
      ownerId: index.ownerId.toLowerCase(),
      questionIds: [...index.questionIds].sort(),
    };
  }
  if (index.questionIds.length >= MAX_MUTATION_KEYS) {
    throw new Error("COMMUNITY_DECISION_MUTATION_INDEX_LIMIT_REACHED");
  }
  return {
    version: 1,
    ownerId: index.ownerId.toLowerCase(),
    questionIds: [...index.questionIds, normalizedQuestionId].sort(),
  };
}

export async function purgeCommunityDecisionOwnerKeys(
  ownerId,
  index,
  deleteKey,
) {
  if (typeof deleteKey !== "function") {
    throw new Error("COMMUNITY_DECISION_OWNER_PURGE_INVALID");
  }
  const keys = buildCommunityDecisionOwnerPurgeKeys(ownerId, index);
  const indexKeys = new Set([
    communityDecisionMutationIndexKey(ownerId),
    communityDecisionMutationIndexBackupKey(ownerId),
  ]);
  const payloadResults = await Promise.allSettled(
    keys.filter((key) => !indexKeys.has(key)).map(deleteKey),
  );
  if (payloadResults.some((result) => result.status === "rejected")) {
    throw new Error("COMMUNITY_DECISION_OWNER_PURGE_UNCONFIRMED");
  }
  const indexResults = await Promise.allSettled([...indexKeys].map(deleteKey));
  if (indexResults.some((result) => result.status === "rejected")) {
    throw new Error("COMMUNITY_DECISION_OWNER_PURGE_UNCONFIRMED");
  }
}
