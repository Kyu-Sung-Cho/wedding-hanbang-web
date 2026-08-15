export const TODAY_ONE_CARE_V2_CONTRACT_VERSION = 2 as const;

export const TODAY_ONE_CARE_V2_STATES = [
  "ready",
  "none",
  "disabled",
  "paused",
  "daily_limit",
] as const;
export type TodayOneCareV2State = (typeof TODAY_ONE_CARE_V2_STATES)[number];

export const TODAY_ONE_CARE_V2_OUTCOMES = [
  "completed",
  "blocked",
  "changed",
  "not_sure",
] as const;
export type TodayOneCareV2Outcome = (typeof TODAY_ONE_CARE_V2_OUTCOMES)[number];

export const TODAY_ONE_CARE_V2_BLOCKER_CODES = [
  "time",
  "partner_check",
  "missing_info",
  "other",
] as const;
export type TodayOneCareV2BlockerCode =
  (typeof TODAY_ONE_CARE_V2_BLOCKER_CODES)[number];

export const TODAY_ONE_CARE_V2_CHOICES = [
  { outcome: "completed", label: "완료했어요" },
  { outcome: "blocked", label: "막혀 있어요" },
  { outcome: "changed", label: "계획이 바뀌었어요" },
  { outcome: "not_sure", label: "아직 모르겠어요" },
] as const satisfies readonly TodayOneCareV2Choice[];

export const TODAY_ONE_CARE_V2_BLOCKER_CHOICES = [
  { code: "time", label: "시간이 더 필요해요" },
  { code: "partner_check", label: "둘이 먼저 확인해야 해요" },
  { code: "missing_info", label: "정보가 더 필요해요" },
  { code: "other", label: "다른 이유가 있어요" },
] as const satisfies readonly TodayOneCareV2BlockerChoice[];

export interface TodayOneCareV2Choice {
  outcome: TodayOneCareV2Outcome;
  label: string;
}

export interface TodayOneCareV2BlockerChoice {
  code: TodayOneCareV2BlockerCode;
  label: string;
}

export interface TodayOneCareV2Card {
  id: string;
  revision: number;
  sourceRevision: number;
  sourceDigest: string;
  outcomeIdempotencyKey: string;
  kind: "action_follow_up";
  title: string;
  whyNow: string;
  confirmed: string[];
  unknown: string[];
  impact: string;
  choices: TodayOneCareV2Choice[];
  expiresAt: string;
}

export interface TodayOneCareV2Response {
  version: typeof TODAY_ONE_CARE_V2_CONTRACT_VERSION;
  state: TodayOneCareV2State;
  recipientUserId: string;
  card?: TodayOneCareV2Card;
}

export interface TodayOneCareV2OutcomeRequest {
  cardId: string;
  cardRevision: number;
  sourceRevision: number;
  outcome: TodayOneCareV2Outcome;
  blockerCode?: TodayOneCareV2BlockerCode;
  confirmed?: true;
  idempotencyKey: string;
}

export interface TodayOneCareV2OutcomeReceipt {
  id: string;
  cardId: string;
  cardRevision: number;
  outcome: TodayOneCareV2Outcome;
  actionStatus: "open" | "done" | "dismissed";
  actionRevision: number;
  blockerCode?: TodayOneCareV2BlockerCode;
  recordedAt: string;
  idempotencyKey: string;
}

export interface TodayOneCareV2OutcomeResponse {
  version: typeof TODAY_ONE_CARE_V2_CONTRACT_VERSION;
  recipientUserId: string;
  receipt: TodayOneCareV2OutcomeReceipt;
}

export type TodayOneCareV2Validation<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason:
        | "invalid"
        | "version"
        | "owner"
        | "state"
        | "card"
        | "outcome"
        | "receipt";
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const UNSAFE_DISPLAY_RE = /[\p{Cc}\p{Zl}\p{Zp}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u2060\u2061\u2062\u2063\u2064\u206A-\u206F\uFEFF]/u;
const UNSAFE_FORMAT_EXCEPT_ZWJ_RE = /(?!\u200D)\p{Cf}/u;
const BARE_ZWJ_RE = /(?:^|[^\p{Extended_Pictographic}])\u200D|\u200D(?:$|[^\p{Extended_Pictographic}])/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 1;
}

function isSafeText(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength
    && !UNSAFE_DISPLAY_RE.test(value)
    && !UNSAFE_FORMAT_EXCEPT_ZWJ_RE.test(value)
    && !BARE_ZWJ_RE.test(value);
}

function isSafeTextArray(
  value: unknown,
  options: { min: number; max: number; itemMax: number },
): value is string[] {
  return Array.isArray(value)
    && value.length >= options.min
    && value.length <= options.max
    && value.every((item) => isSafeText(item, options.itemMax));
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 40
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isExactChoiceSet(value: unknown): value is TodayOneCareV2Choice[] {
  return Array.isArray(value)
    && value.length === TODAY_ONE_CARE_V2_CHOICES.length
    && value.every((choice, index) => {
      if (!isRecord(choice) || !hasOnlyKeys(choice, ["outcome", "label"])) return false;
      const expected = TODAY_ONE_CARE_V2_CHOICES[index];
      return choice.outcome === expected?.outcome && choice.label === expected.label;
    });
}

function isCard(value: unknown): value is TodayOneCareV2Card {
  return isRecord(value)
    && hasOnlyKeys(value, [
      "id",
      "revision",
      "sourceRevision",
      "sourceDigest",
      "outcomeIdempotencyKey",
      "kind",
      "title",
      "whyNow",
      "confirmed",
      "unknown",
      "impact",
      "choices",
      "expiresAt",
    ])
    && typeof value.id === "string"
    && UUID_RE.test(value.id)
    && isPositiveSafeInteger(value.revision)
    && isPositiveSafeInteger(value.sourceRevision)
    && typeof value.sourceDigest === "string"
    && SHA256_RE.test(value.sourceDigest)
    && typeof value.outcomeIdempotencyKey === "string"
    && UUID_RE.test(value.outcomeIdempotencyKey)
    && value.kind === "action_follow_up"
    && isSafeText(value.title, 120)
    && isSafeText(value.whyNow, 240)
    && isSafeTextArray(value.confirmed, { min: 1, max: 4, itemMax: 180 })
    && isSafeTextArray(value.unknown, { min: 0, max: 4, itemMax: 180 })
    && isSafeText(value.impact, 180)
    && isExactChoiceSet(value.choices)
    && isIsoTimestamp(value.expiresAt);
}

export function validateTodayOneCareV2Response(
  value: unknown,
  expectedRecipientUserId: string,
): TodayOneCareV2Validation<TodayOneCareV2Response> {
  if (!UUID_RE.test(expectedRecipientUserId) || !isRecord(value)) {
    return { ok: false, reason: "invalid" };
  }
  if (value.version !== TODAY_ONE_CARE_V2_CONTRACT_VERSION) {
    return { ok: false, reason: "version" };
  }
  if (value.recipientUserId !== expectedRecipientUserId) {
    return { ok: false, reason: "owner" };
  }
  if (
    !hasOnlyKeys(value, ["version", "state", "recipientUserId", "card"])
    || !TODAY_ONE_CARE_V2_STATES.includes(value.state as TodayOneCareV2State)
  ) {
    return { ok: false, reason: "state" };
  }
  if (value.state === "ready") {
    if (!isCard(value.card)) return { ok: false, reason: "card" };
  } else if (value.card !== undefined) {
    return { ok: false, reason: "card" };
  }
  return { ok: true, value: value as unknown as TodayOneCareV2Response };
}

export function validateTodayOneCareV2OutcomeRequest(
  value: unknown,
): TodayOneCareV2Validation<TodayOneCareV2OutcomeRequest> {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      "cardId",
      "cardRevision",
      "sourceRevision",
      "outcome",
      "blockerCode",
      "confirmed",
      "idempotencyKey",
    ])
    || typeof value.cardId !== "string"
    || !UUID_RE.test(value.cardId)
    || !isPositiveSafeInteger(value.cardRevision)
    || !isPositiveSafeInteger(value.sourceRevision)
    || !TODAY_ONE_CARE_V2_OUTCOMES.includes(value.outcome as TodayOneCareV2Outcome)
    || typeof value.idempotencyKey !== "string"
    || !UUID_RE.test(value.idempotencyKey)
  ) {
    return { ok: false, reason: "invalid" };
  }

  const mutatesAction = value.outcome === "completed" || value.outcome === "changed";
  if (mutatesAction ? value.confirmed !== true : value.confirmed !== undefined) {
    return { ok: false, reason: "outcome" };
  }
  if (value.outcome === "blocked") {
    if (!TODAY_ONE_CARE_V2_BLOCKER_CODES.includes(value.blockerCode as TodayOneCareV2BlockerCode)) {
      return { ok: false, reason: "outcome" };
    }
  } else if (value.blockerCode !== undefined) {
    return { ok: false, reason: "outcome" };
  }
  return { ok: true, value: value as unknown as TodayOneCareV2OutcomeRequest };
}

function isReceipt(value: unknown): value is TodayOneCareV2OutcomeReceipt {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      "id",
      "cardId",
      "cardRevision",
      "outcome",
      "actionStatus",
      "actionRevision",
      "blockerCode",
      "recordedAt",
      "idempotencyKey",
    ])
    || typeof value.id !== "string"
    || !UUID_RE.test(value.id)
    || typeof value.cardId !== "string"
    || !UUID_RE.test(value.cardId)
    || !isPositiveSafeInteger(value.cardRevision)
    || !TODAY_ONE_CARE_V2_OUTCOMES.includes(value.outcome as TodayOneCareV2Outcome)
    || !isPositiveSafeInteger(value.actionRevision)
    || !isIsoTimestamp(value.recordedAt)
    || typeof value.idempotencyKey !== "string"
    || !UUID_RE.test(value.idempotencyKey)
  ) return false;

  const expectedStatus = value.outcome === "completed" ? "done" : "open";
  if (value.actionStatus !== expectedStatus) return false;
  if (value.outcome === "blocked") {
    return TODAY_ONE_CARE_V2_BLOCKER_CODES.includes(
      value.blockerCode as TodayOneCareV2BlockerCode,
    );
  }
  return value.blockerCode === undefined;
}

export function validateTodayOneCareV2OutcomeResponse(
  value: unknown,
  expectedRecipientUserId: string,
): TodayOneCareV2Validation<TodayOneCareV2OutcomeResponse> {
  if (!UUID_RE.test(expectedRecipientUserId) || !isRecord(value)) {
    return { ok: false, reason: "invalid" };
  }
  if (value.version !== TODAY_ONE_CARE_V2_CONTRACT_VERSION) {
    return { ok: false, reason: "version" };
  }
  if (value.recipientUserId !== expectedRecipientUserId) {
    return { ok: false, reason: "owner" };
  }
  if (
    !hasOnlyKeys(value, ["version", "recipientUserId", "receipt"])
    || !isReceipt(value.receipt)
  ) {
    return { ok: false, reason: "receipt" };
  }
  return { ok: true, value: value as unknown as TodayOneCareV2OutcomeResponse };
}
