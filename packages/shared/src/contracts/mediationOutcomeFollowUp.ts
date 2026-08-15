export const MEDIATION_OUTCOME_FOLLOW_UP_CONTRACT_VERSION = 1 as const;

export const MEDIATION_OUTCOME_FOLLOW_UP_STATES = ["ready", "none"] as const;
export type MediationOutcomeFollowUpState =
  (typeof MEDIATION_OUTCOME_FOLLOW_UP_STATES)[number];

export const MEDIATION_OUTCOME_FOLLOW_UP_OUTCOMES = [
  "resolved",
  "changed",
  "blocked",
  "stop",
] as const;
export type MediationOutcomeFollowUpOutcome =
  (typeof MEDIATION_OUTCOME_FOLLOW_UP_OUTCOMES)[number];

export const MEDIATION_OUTCOME_FOLLOW_UP_CHOICES = [
  { outcome: "resolved", label: "이제 괜찮아졌어요" },
  { outcome: "changed", label: "상황이 달라졌어요" },
  { outcome: "blocked", label: "아직 막혀 있어요" },
  { outcome: "stop", label: "여기서 멈출게요" },
] as const satisfies readonly MediationOutcomeFollowUpChoice[];

// Every display string is fixed in the shared contract. The service boundary
// never has a free-text field through which raw mediation or inferred partner
// state could reach a recipient.
export const MEDIATION_OUTCOME_FOLLOW_UP_COPY = {
  title: "둘이 확인한 조율, 지금은 어떤가요?",
  question: "지금 그 조율은 어떻게 되었나요?",
  confirmed: ["두 분이 직접 확인한 조율안이 있어요."],
  unknown: ["지금 실제 결과는 아직 확인하지 않았어요."],
  impact: "내 선택은 나에게만 보이며 공동 기록이나 상대 카드에는 영향을 주지 않아요.",
} as const;

export interface MediationOutcomeFollowUpChoice {
  outcome: MediationOutcomeFollowUpOutcome;
  label: string;
}

export interface MediationOutcomeFollowUpCard {
  id: string;
  revision: number;
  sourceDigest: string;
  outcomeIdempotencyKey: string;
  kind: "mediation_outcome_follow_up";
  visibility: "private";
  title: string;
  question: string;
  confirmed: string[];
  unknown: string[];
  impact: string;
  choices: MediationOutcomeFollowUpChoice[];
  safeguards: {
    automaticSharedMutation: false;
    automaticRemediation: false;
  };
  eligibleAt: string;
  expiresAt: string;
}

export type MediationOutcomeFollowUpResponse =
  | {
      version: typeof MEDIATION_OUTCOME_FOLLOW_UP_CONTRACT_VERSION;
      state: "ready";
      recipientUserId: string;
      coupleId: string;
      card: MediationOutcomeFollowUpCard;
    }
  | {
      version: typeof MEDIATION_OUTCOME_FOLLOW_UP_CONTRACT_VERSION;
      state: "none";
      recipientUserId: string;
      coupleId: string;
    };

export interface MediationOutcomeFollowUpRequest {
  cardId: string;
  cardRevision: number;
  sourceDigest: string;
  outcome: MediationOutcomeFollowUpOutcome;
  idempotencyKey: string;
}

export interface MediationOutcomeFollowUpReceipt {
  id: string;
  cardId: string;
  cardRevision: number;
  sourceDigest: string;
  outcome: MediationOutcomeFollowUpOutcome;
  recordedAt: string;
  idempotencyKey: string;
}

export interface MediationOutcomeFollowUpReceiptResponse {
  version: typeof MEDIATION_OUTCOME_FOLLOW_UP_CONTRACT_VERSION;
  recipientUserId: string;
  coupleId: string;
  receipt: MediationOutcomeFollowUpReceipt;
}

export type MediationOutcomeFollowUpValidation<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason:
        | "invalid"
        | "version"
        | "owner"
        | "couple"
        | "state"
        | "card"
        | "outcome"
        | "receipt";
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_RE = /^[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 1;
}

function isExactTextArray(
  value: unknown,
  expected: readonly string[],
): value is string[] {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 40
    && /^\d{4}-\d{2}-\d{2}T/u.test(value)
    && Number.isFinite(Date.parse(value));
}

function isExactChoiceSet(value: unknown): value is MediationOutcomeFollowUpChoice[] {
  return Array.isArray(value)
    && value.length === MEDIATION_OUTCOME_FOLLOW_UP_CHOICES.length
    && value.every((choice, index) => {
      if (!isRecord(choice) || !hasOnlyKeys(choice, ["outcome", "label"])) {
        return false;
      }
      const expected = MEDIATION_OUTCOME_FOLLOW_UP_CHOICES[index];
      return choice.outcome === expected?.outcome && choice.label === expected.label;
    });
}

function isSafeguards(
  value: unknown,
): value is MediationOutcomeFollowUpCard["safeguards"] {
  return isRecord(value)
    && hasOnlyKeys(value, ["automaticSharedMutation", "automaticRemediation"])
    && value.automaticSharedMutation === false
    && value.automaticRemediation === false;
}

function isCard(value: unknown): value is MediationOutcomeFollowUpCard {
  return isRecord(value)
    && hasOnlyKeys(value, [
      "id",
      "revision",
      "sourceDigest",
      "outcomeIdempotencyKey",
      "kind",
      "visibility",
      "title",
      "question",
      "confirmed",
      "unknown",
      "impact",
      "choices",
      "safeguards",
      "eligibleAt",
      "expiresAt",
    ])
    && typeof value.id === "string"
    && UUID_RE.test(value.id)
    && isPositiveSafeInteger(value.revision)
    && typeof value.sourceDigest === "string"
    && SHA256_RE.test(value.sourceDigest)
    && typeof value.outcomeIdempotencyKey === "string"
    && UUID_RE.test(value.outcomeIdempotencyKey)
    && value.kind === "mediation_outcome_follow_up"
    && value.visibility === "private"
    && value.title === MEDIATION_OUTCOME_FOLLOW_UP_COPY.title
    && value.question === MEDIATION_OUTCOME_FOLLOW_UP_COPY.question
    && isExactTextArray(
      value.confirmed,
      MEDIATION_OUTCOME_FOLLOW_UP_COPY.confirmed,
    )
    && isExactTextArray(value.unknown, MEDIATION_OUTCOME_FOLLOW_UP_COPY.unknown)
    && value.impact === MEDIATION_OUTCOME_FOLLOW_UP_COPY.impact
    && isExactChoiceSet(value.choices)
    && isSafeguards(value.safeguards)
    && isIsoTimestamp(value.eligibleAt)
    && isIsoTimestamp(value.expiresAt)
    && Date.parse(value.expiresAt) > Date.parse(value.eligibleAt);
}

export function validateMediationOutcomeFollowUpResponse(
  value: unknown,
  expectedRecipientUserId: string,
  expectedCoupleId: string,
): MediationOutcomeFollowUpValidation<MediationOutcomeFollowUpResponse> {
  if (
    !UUID_RE.test(expectedRecipientUserId)
    || !UUID_RE.test(expectedCoupleId)
    || !isRecord(value)
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (value.version !== MEDIATION_OUTCOME_FOLLOW_UP_CONTRACT_VERSION) {
    return { ok: false, reason: "version" };
  }
  if (value.recipientUserId !== expectedRecipientUserId) {
    return { ok: false, reason: "owner" };
  }
  if (value.coupleId !== expectedCoupleId) {
    return { ok: false, reason: "couple" };
  }
  if (
    !hasOnlyKeys(value, ["version", "state", "recipientUserId", "coupleId", "card"])
    || !MEDIATION_OUTCOME_FOLLOW_UP_STATES.includes(
      value.state as MediationOutcomeFollowUpState,
    )
  ) {
    return { ok: false, reason: "state" };
  }
  if (value.state === "ready") {
    if (!isCard(value.card)) return { ok: false, reason: "card" };
  } else if (value.card !== undefined) {
    return { ok: false, reason: "card" };
  }
  return {
    ok: true,
    value: value as unknown as MediationOutcomeFollowUpResponse,
  };
}

export function validateMediationOutcomeFollowUpRequest(
  value: unknown,
): MediationOutcomeFollowUpValidation<MediationOutcomeFollowUpRequest> {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      "cardId",
      "cardRevision",
      "sourceDigest",
      "outcome",
      "idempotencyKey",
    ])
    || typeof value.cardId !== "string"
    || !UUID_RE.test(value.cardId)
    || !isPositiveSafeInteger(value.cardRevision)
    || typeof value.sourceDigest !== "string"
    || !SHA256_RE.test(value.sourceDigest)
    || !MEDIATION_OUTCOME_FOLLOW_UP_OUTCOMES.includes(
      value.outcome as MediationOutcomeFollowUpOutcome,
    )
    || typeof value.idempotencyKey !== "string"
    || !UUID_RE.test(value.idempotencyKey)
  ) {
    return { ok: false, reason: "outcome" };
  }
  return {
    ok: true,
    value: value as unknown as MediationOutcomeFollowUpRequest,
  };
}

function isReceipt(value: unknown): value is MediationOutcomeFollowUpReceipt {
  return isRecord(value)
    && hasOnlyKeys(value, [
      "id",
      "cardId",
      "cardRevision",
      "sourceDigest",
      "outcome",
      "recordedAt",
      "idempotencyKey",
    ])
    && typeof value.id === "string"
    && UUID_RE.test(value.id)
    && typeof value.cardId === "string"
    && UUID_RE.test(value.cardId)
    && isPositiveSafeInteger(value.cardRevision)
    && typeof value.sourceDigest === "string"
    && SHA256_RE.test(value.sourceDigest)
    && MEDIATION_OUTCOME_FOLLOW_UP_OUTCOMES.includes(
      value.outcome as MediationOutcomeFollowUpOutcome,
    )
    && isIsoTimestamp(value.recordedAt)
    && typeof value.idempotencyKey === "string"
    && UUID_RE.test(value.idempotencyKey);
}

export function validateMediationOutcomeFollowUpReceiptResponse(
  value: unknown,
  expectedRecipientUserId: string,
  expectedCoupleId: string,
): MediationOutcomeFollowUpValidation<MediationOutcomeFollowUpReceiptResponse> {
  if (
    !UUID_RE.test(expectedRecipientUserId)
    || !UUID_RE.test(expectedCoupleId)
    || !isRecord(value)
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (value.version !== MEDIATION_OUTCOME_FOLLOW_UP_CONTRACT_VERSION) {
    return { ok: false, reason: "version" };
  }
  if (value.recipientUserId !== expectedRecipientUserId) {
    return { ok: false, reason: "owner" };
  }
  if (value.coupleId !== expectedCoupleId) {
    return { ok: false, reason: "couple" };
  }
  if (
    !hasOnlyKeys(value, ["version", "recipientUserId", "coupleId", "receipt"])
    || !isReceipt(value.receipt)
  ) {
    return { ok: false, reason: "receipt" };
  }
  return {
    ok: true,
    value: value as unknown as MediationOutcomeFollowUpReceiptResponse,
  };
}
