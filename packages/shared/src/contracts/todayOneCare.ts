export const TODAY_ONE_CARE_CONTRACT_VERSION = 1 as const;

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
  "task_deadline",
  "couple_decision",
  "inquiry_waiting",
  /**
   * 끝난 맡은 일(25장 갈래 4). 종류와 다음 행동 짝만 여기와 DB 검사에 미리 둔다. 고르는 코드는 갈래 4가
   * `TODAY_ONE_EXTRA_SOURCES` 에 더하고, 그 전에는 이 종류의 카드가 만들어지지 않는다.
   */
  "task_done",
] as const;

export type TodayOneCareKind = (typeof TODAY_ONE_CARE_KINDS)[number];

/**
 * 2026-11-20(25장 2절) 이전 화면이 아는 종류. 이미 설치된 앱은 이 둘 밖의 카드를 "형식을 확인하지 못했어요"로
 * 그리므로, 서버는 `?kinds=2` 를 보낸 화면에만 새 종류를 고른다(`TODAY_ONE_CARE_KINDS_PARAM`).
 */
export const TODAY_ONE_CARE_KINDS_V1 = ["schedule_moment", "budget_guardrail"] as const;

/** 새 종류를 그릴 수 있는 화면이 `GET /api/amora/today-one` 에 붙이는 표시. */
export const TODAY_ONE_CARE_KINDS_PARAM = { name: "kinds", value: "2" } as const;

/**
 * 종류마다 정해진 다음 행동. 문장은 정해진 틀이고(파운더 승인, 18장 D-12) DB 검사
 * (`amora_today_one_presentation_is_valid`)가 같은 짝을 다시 지킨다.
 */
export const TODAY_ONE_CARE_NEXT_ACTIONS: Readonly<Record<
  TodayOneCareKind,
  { label: string; hrefs: readonly string[] }
>> = {
  schedule_moment: { label: "일정 열기", hrefs: ["/schedule"] },
  budget_guardrail: { label: "예산 열기", hrefs: ["/budget"] },
  task_deadline: { label: "할 일 보기", hrefs: ["/lounge"] },
  couple_decision: { label: "정할 것 보기", hrefs: ["/halls/consultation", "/halls/letter"] },
  inquiry_waiting: { label: "문의 보기", hrefs: ["/halls/consultation"] },
  task_done: { label: "맡은 일 보기", hrefs: ["/lounge"] },
};

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
}

export interface TodayOneCareResponse {
  version: typeof TODAY_ONE_CARE_CONTRACT_VERSION;
  state: TodayOneCareState;
  recipientUserId: string;
  claimedForDate: string;
  card?: TodayOneCareCard;
}

export type TodayOneCareValidation =
  | { ok: true; value: TodayOneCareResponse }
  | {
      ok: false;
      reason:
        | "invalid"
        | "version"
        | "owner"
        | "state"
        | "card"
        | "navigation";
    };

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

function isCard(value: unknown): value is TodayOneCareCard {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
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
    ])
    || typeof value.id !== "string"
    || !UUID_RE.test(value.id)
    || !isNonNegativeSafeInteger(value.revision)
    || !isNonNegativeSafeInteger(value.sourceRevision)
    || typeof value.sourceKey !== "string"
    || !SAFE_SOURCE_KEY_RE.test(value.sourceKey)
    || !TODAY_ONE_CARE_KINDS.includes(value.kind as TodayOneCareKind)
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
  if (!isSafeTodayOneHref(value.nextAction.href)) return false;

  const expectedAction = TODAY_ONE_CARE_NEXT_ACTIONS[value.kind as TodayOneCareKind];
  return value.nextAction.label === expectedAction.label
    && expectedAction.hrefs.includes(value.nextAction.href as string);
}

export function validateTodayOneCareResponse(
  value: unknown,
  expectedRecipientUserId: string,
): TodayOneCareValidation {
  if (!UUID_RE.test(expectedRecipientUserId) || !isRecord(value)) {
    return { ok: false, reason: "invalid" };
  }
  if (value.version !== TODAY_ONE_CARE_CONTRACT_VERSION) {
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
    if (!isCard(value.card)) {
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

  return { ok: true, value: value as unknown as TodayOneCareResponse };
}
