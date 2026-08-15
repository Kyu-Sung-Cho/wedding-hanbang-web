export const TODAY_ONE_CARE_LEGACY_CONTRACT_VERSION = 1 as const;
export const TODAY_ONE_CARE_CONTRACT_VERSION = 2 as const;
export const TODAY_ONE_CARE_CONTRACT_VERSION_HEADER =
  "X-Amora-Today-One-Contract-Version" as const;

export const TODAY_ONE_CARE_STATES = [
  "ready",
  "none",
  "disabled",
  "paused",
  "daily_limit",
  "source_stale",
] as const;

export type TodayOneCareState = (typeof TODAY_ONE_CARE_STATES)[number];

export const TODAY_ONE_CARE_ACTIONS = [
  "open_source",
  "snooze",
  "dismiss",
  "mute_source",
] as const;

export type TodayOneCareAction = (typeof TODAY_ONE_CARE_ACTIONS)[number];

export const TODAY_ONE_CARE_KINDS = [
  "schedule_moment",
  "budget_guardrail",
  "decision_follow_up",
] as const;

export type TodayOneCareKind = (typeof TODAY_ONE_CARE_KINDS)[number];

export const TODAY_ONE_CARE_LEGACY_KINDS = [
  "schedule_moment",
  "budget_guardrail",
] as const;

export type TodayOneCareLegacyKind =
  (typeof TODAY_ONE_CARE_LEGACY_KINDS)[number];

export const TODAY_ONE_SCHEDULE_CARE_CONTRACT_VERSION = 1 as const;

export const TODAY_ONE_SCHEDULE_CARE_MOMENT_TYPES = [
  "family_greeting",
  "sanggyeonrye",
  "dress_fitting",
] as const;

export type TodayOneScheduleCareMomentType =
  (typeof TODAY_ONE_SCHEDULE_CARE_MOMENT_TYPES)[number];

export const TODAY_ONE_SCHEDULE_CARE_ATTENTION_WINDOWS = [
  "d3",
  "d1",
  "dAfter",
] as const;

export type TodayOneScheduleCareAttentionWindow =
  (typeof TODAY_ONE_SCHEDULE_CARE_ATTENTION_WINDOWS)[number];

export const TODAY_ONE_SCHEDULE_CARE_EVIDENCE_REFS = [
  { key: "canonical_schedule_event", label: "사용자가 저장한 일정" },
  { key: "canonical_checklist_category", label: "부모님 첫 만남 체크리스트" },
  { key: "curated_family_coordination_guidance", label: "가족 행사 중립 안내" },
  { key: "canonical_checklist_category", label: "드레스·예식 정장 체크리스트" },
  { key: "current_schedule_care_catalog", label: "현재 일정 준비 안내" },
] as const;

export type TodayOneScheduleCareEvidenceRef =
  (typeof TODAY_ONE_SCHEDULE_CARE_EVIDENCE_REFS)[number];

interface TodayOneScheduleCareBase {
  version: typeof TODAY_ONE_SCHEDULE_CARE_CONTRACT_VERSION;
  guidance: string;
  checklist: string[];
  script?: string;
  evidence: {
    refs: TodayOneScheduleCareEvidenceRef[];
    limitations: string[];
  };
}

type TodayOneMeetingCareDestination = {
  categoryKey: "meeting";
  categoryLabel: "부모님 첫 만남";
};

type TodayOneDressCareDestination = {
  categoryKey: "dress";
  categoryLabel: "드레스·예식 정장";
};

export type TodayOneScheduleCarePayload = TodayOneScheduleCareBase & (
  | {
    momentType: "family_greeting" | "sanggyeonrye";
    attentionWindow: TodayOneScheduleCareAttentionWindow;
    question?: string;
    relatedChecklist: TodayOneMeetingCareDestination;
    relatedBudget?: TodayOneMeetingCareDestination;
  }
  | {
    momentType: "dress_fitting";
    attentionWindow: "d3" | "d1";
    question?: never;
    relatedChecklist: TodayOneDressCareDestination;
    relatedBudget?: never;
  }
);

export interface TodayOneCareChoice {
  action: TodayOneCareAction;
  label: string;
}

export interface TodayOneCareCard {
  id: string;
  revision: number;
  sourceRevision: number;
  sourceKey: string;
  kind: TodayOneCareKind;
  whyNow: string;
  confirmed: string[];
  unknown: string[];
  nextAction: {
    label: string;
    href: string;
  };
  impact: string;
  choices: TodayOneCareChoice[];
  expiresAt: string;
  care?: TodayOneScheduleCarePayload;
}

export interface TodayOneCareResponse {
  version: typeof TODAY_ONE_CARE_CONTRACT_VERSION;
  state: TodayOneCareState;
  recipientUserId: string;
  claimedForDate: string;
  card?: TodayOneCareCard;
}

export interface TodayOneCareLegacyCard
  extends Omit<TodayOneCareCard, "kind" | "care"> {
  kind: TodayOneCareLegacyKind;
}

export interface TodayOneCareLegacyResponse {
  version: typeof TODAY_ONE_CARE_LEGACY_CONTRACT_VERSION;
  state: TodayOneCareState;
  recipientUserId: string;
  claimedForDate: string;
  card?: TodayOneCareLegacyCard;
}

type TodayOneCareValidationReason =
  | "invalid"
  | "version"
  | "owner"
  | "state"
  | "card"
  | "navigation";

export type TodayOneCareValidation =
  | { ok: true; value: TodayOneCareResponse }
  | {
      ok: false;
      reason: TodayOneCareValidationReason;
    };

export type TodayOneCareLegacyValidation =
  | { ok: true; value: TodayOneCareLegacyResponse }
  | { ok: false; reason: TodayOneCareValidationReason };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_SOURCE_KEY_RE = /^[a-z0-9:_-]{1,200}$/;
const UNSAFE_DISPLAY_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isSafeText(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength
    && !UNSAFE_DISPLAY_RE.test(value);
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

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 40
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && Number.isFinite(Date.parse(value));
}

export function isSafeTodayOneHref(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 240
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || UNSAFE_DISPLAY_RE.test(value)
  ) {
    return false;
  }

  try {
    const parsed = new URL(value, "https://hanbang.invalid");
    return parsed.origin === "https://hanbang.invalid"
      && parsed.username === ""
      && parsed.password === "";
  } catch {
    return false;
  }
}

function isChoice(value: unknown): value is TodayOneCareChoice {
  if (!isRecord(value) || !hasOnlyKeys(value, ["action", "label"])) return false;
  return TODAY_ONE_CARE_ACTIONS.includes(value.action as TodayOneCareAction)
    && isSafeText(value.label, 40);
}

function isScheduleCareEvidenceRef(
  value: unknown,
): value is TodayOneScheduleCareEvidenceRef {
  if (!isRecord(value) || !hasOnlyKeys(value, ["key", "label"])) return false;
  return TODAY_ONE_SCHEDULE_CARE_EVIDENCE_REFS.some((expected) => (
    value.key === expected.key && value.label === expected.label
  ));
}

function isScheduleCareDestination(
  value: unknown,
  expected: { categoryKey: "meeting" | "dress"; categoryLabel: string },
): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ["categoryKey", "categoryLabel"])
    && value.categoryKey === expected.categoryKey
    && value.categoryLabel === expected.categoryLabel;
}

function hasMomentAppropriateEvidence(
  momentType: TodayOneScheduleCareMomentType,
  refs: TodayOneScheduleCareEvidenceRef[],
): boolean {
  const allowed = momentType === "dress_fitting"
    ? [
        TODAY_ONE_SCHEDULE_CARE_EVIDENCE_REFS[0],
        TODAY_ONE_SCHEDULE_CARE_EVIDENCE_REFS[3],
        TODAY_ONE_SCHEDULE_CARE_EVIDENCE_REFS[4],
      ]
    : [
        TODAY_ONE_SCHEDULE_CARE_EVIDENCE_REFS[0],
        TODAY_ONE_SCHEDULE_CARE_EVIDENCE_REFS[1],
        TODAY_ONE_SCHEDULE_CARE_EVIDENCE_REFS[2],
      ];
  return refs.every((ref) => allowed.some((expected) => (
    ref.key === expected.key && ref.label === expected.label
  )));
}

function isScheduleCarePayload(value: unknown): value is TodayOneScheduleCarePayload {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      "version",
      "momentType",
      "attentionWindow",
      "guidance",
      "checklist",
      "script",
      "question",
      "relatedChecklist",
      "relatedBudget",
      "evidence",
    ])
    || value.version !== TODAY_ONE_SCHEDULE_CARE_CONTRACT_VERSION
    || !TODAY_ONE_SCHEDULE_CARE_MOMENT_TYPES.includes(
      value.momentType as TodayOneScheduleCareMomentType,
    )
    || !TODAY_ONE_SCHEDULE_CARE_ATTENTION_WINDOWS.includes(
      value.attentionWindow as TodayOneScheduleCareAttentionWindow,
    )
    || !isSafeText(value.guidance, 600)
    || !isSafeTextArray(value.checklist, { min: 0, max: 8, itemMax: 180 })
    || (value.script !== undefined && !isSafeText(value.script, 500))
    || (value.question !== undefined && !isSafeText(value.question, 500))
    || !isRecord(value.evidence)
    || !hasOnlyKeys(value.evidence, ["refs", "limitations"])
    || !Array.isArray(value.evidence.refs)
    || value.evidence.refs.length < 1
    || value.evidence.refs.length > 3
    || !value.evidence.refs.every(isScheduleCareEvidenceRef)
    || new Set(value.evidence.refs.map((ref) => ref.key)).size !== value.evidence.refs.length
    || !hasMomentAppropriateEvidence(
      value.momentType as TodayOneScheduleCareMomentType,
      value.evidence.refs,
    )
    || !isSafeTextArray(value.evidence.limitations, { min: 1, max: 4, itemMax: 240 })
  ) {
    return false;
  }

  if (value.momentType === "dress_fitting") {
    return (value.attentionWindow === "d3" || value.attentionWindow === "d1")
      && value.question === undefined
      && value.relatedBudget === undefined
      && isScheduleCareDestination(value.relatedChecklist, {
        categoryKey: "dress",
        categoryLabel: "드레스·예식 정장",
      });
  }

  return isScheduleCareDestination(value.relatedChecklist, {
    categoryKey: "meeting",
    categoryLabel: "부모님 첫 만남",
  }) && (
    value.relatedBudget === undefined
    || isScheduleCareDestination(value.relatedBudget, {
      categoryKey: "meeting",
      categoryLabel: "부모님 첫 만남",
    })
  );
}

function scheduleCareSourceSuffix(
  attentionWindow: TodayOneScheduleCareAttentionWindow,
): string {
  return attentionWindow === "dAfter" ? "d_after" : attentionWindow;
}

function isCard(
  value: unknown,
  contractVersion:
    | typeof TODAY_ONE_CARE_LEGACY_CONTRACT_VERSION
    | typeof TODAY_ONE_CARE_CONTRACT_VERSION,
): value is TodayOneCareCard | TodayOneCareLegacyCard {
  const isLegacy = contractVersion === TODAY_ONE_CARE_LEGACY_CONTRACT_VERSION;
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, isLegacy ? [
      "id",
      "revision",
      "sourceRevision",
      "sourceKey",
      "kind",
      "whyNow",
      "confirmed",
      "unknown",
      "nextAction",
      "impact",
      "choices",
      "expiresAt",
    ] : [
      "id",
      "revision",
      "sourceRevision",
      "sourceKey",
      "kind",
      "whyNow",
      "confirmed",
      "unknown",
      "nextAction",
      "impact",
      "choices",
      "expiresAt",
      "care",
    ])
    || typeof value.id !== "string"
    || !UUID_RE.test(value.id)
    || !isNonNegativeSafeInteger(value.revision)
    || !isNonNegativeSafeInteger(value.sourceRevision)
    || typeof value.sourceKey !== "string"
    || !SAFE_SOURCE_KEY_RE.test(value.sourceKey)
    || !(isLegacy
      ? TODAY_ONE_CARE_LEGACY_KINDS.includes(value.kind as TodayOneCareLegacyKind)
      : TODAY_ONE_CARE_KINDS.includes(value.kind as TodayOneCareKind))
    || !isSafeText(value.whyNow, 240)
    || !isSafeTextArray(value.confirmed, { min: 1, max: 4, itemMax: 180 })
    || !isSafeTextArray(value.unknown, { min: 0, max: 4, itemMax: 180 })
    || !isSafeText(value.impact, 180)
    || !Array.isArray(value.choices)
    || value.choices.length < 2
    || value.choices.length > TODAY_ONE_CARE_ACTIONS.length
    || !value.choices.every(isChoice)
    || new Set(value.choices.map((choice) => choice.action)).size !== value.choices.length
    || !isIsoTimestamp(value.expiresAt)
    || !isRecord(value.nextAction)
    || !hasOnlyKeys(value.nextAction, ["label", "href"])
    || !isSafeText(value.nextAction.label, 80)
  ) {
    return false;
  }
  if (isLegacy && value.care !== undefined) return false;
  if (value.care !== undefined) {
    if (
      value.kind !== "schedule_moment"
      || !isScheduleCarePayload(value.care)
      || !value.sourceKey.endsWith(`:${scheduleCareSourceSuffix(value.care.attentionWindow)}`)
    ) {
      return false;
    }
  }
  if (!isSafeTodayOneHref(value.nextAction.href)) return false;

  const nextAction = value.nextAction;
  const allowedActions = value.kind === "budget_guardrail"
    ? [{ label: "예산 열기", href: "/budget" }]
    : value.kind === "schedule_moment"
      ? [{ label: "일정 열기", href: "/schedule" }]
      : [
          { label: "예산 열기", href: "/budget" },
          { label: "일정 열기", href: "/schedule" },
          { label: "준비 현황 열기", href: "/dashboard" },
        ];
  return allowedActions.some((expectedAction) => (
    nextAction.label === expectedAction.label
    && nextAction.href === expectedAction.href
  ));
}

function validateTodayOneCareResponseVersion(
  value: unknown,
  expectedRecipientUserId: string,
  contractVersion:
    | typeof TODAY_ONE_CARE_LEGACY_CONTRACT_VERSION
    | typeof TODAY_ONE_CARE_CONTRACT_VERSION,
): TodayOneCareValidation | TodayOneCareLegacyValidation {
  if (!UUID_RE.test(expectedRecipientUserId) || !isRecord(value)) {
    return { ok: false, reason: "invalid" };
  }
  if (value.version !== contractVersion) {
    return { ok: false, reason: "version" };
  }
  if (value.recipientUserId !== expectedRecipientUserId) {
    return { ok: false, reason: "owner" };
  }
  if (
    !hasOnlyKeys(value, ["version", "state", "recipientUserId", "claimedForDate", "card"])
    || !YMD_RE.test(String(value.claimedForDate))
    || !TODAY_ONE_CARE_STATES.includes(value.state as TodayOneCareState)
  ) {
    return { ok: false, reason: "state" };
  }

  if (value.state === "ready") {
    if (!isCard(value.card, contractVersion)) {
      const href = isRecord(value.card) && isRecord(value.card.nextAction)
        ? value.card.nextAction.href
        : undefined;
      return {
        ok: false,
        reason: href !== undefined && !isSafeTodayOneHref(href)
          ? "navigation"
          : "card",
      };
    }
  } else if (value.card !== undefined) {
    return { ok: false, reason: "card" };
  }

  return contractVersion === TODAY_ONE_CARE_LEGACY_CONTRACT_VERSION
    ? { ok: true, value: value as unknown as TodayOneCareLegacyResponse }
    : { ok: true, value: value as unknown as TodayOneCareResponse };
}

export function validateTodayOneCareResponse(
  value: unknown,
  expectedRecipientUserId: string,
): TodayOneCareValidation {
  return validateTodayOneCareResponseVersion(
    value,
    expectedRecipientUserId,
    TODAY_ONE_CARE_CONTRACT_VERSION,
  ) as TodayOneCareValidation;
}

export function validateTodayOneCareLegacyResponse(
  value: unknown,
  expectedRecipientUserId: string,
): TodayOneCareLegacyValidation {
  return validateTodayOneCareResponseVersion(
    value,
    expectedRecipientUserId,
    TODAY_ONE_CARE_LEGACY_CONTRACT_VERSION,
  ) as TodayOneCareLegacyValidation;
}

/**
 * Rolling-deploy reader for current clients. A new client can safely consume
 * the frozen v1 schedule/budget response from an older server, but every v1
 * field is first checked against that exact legacy schema before it is lifted
 * into the v2 in-memory type. New v2-only fields are never inferred.
 */
export function validateCompatibleTodayOneCareResponse(
  value: unknown,
  expectedRecipientUserId: string,
): TodayOneCareValidation {
  if (isRecord(value) && value.version === TODAY_ONE_CARE_LEGACY_CONTRACT_VERSION) {
    const legacy = validateTodayOneCareLegacyResponse(value, expectedRecipientUserId);
    if (!legacy.ok) return legacy;
    return {
      ok: true,
      value: {
        ...legacy.value,
        version: TODAY_ONE_CARE_CONTRACT_VERSION,
        ...(legacy.value.card
          ? { card: { ...legacy.value.card } }
          : {}),
      },
    };
  }
  return validateTodayOneCareResponse(value, expectedRecipientUserId);
}
