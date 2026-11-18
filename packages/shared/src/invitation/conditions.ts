import type { PreparationStartStage } from "./copy";
import { normalizeInvitationRegion, type InvitationRegion } from "./regions";

/**
 * 결혼 조건(W1)과 준비 순서 계획을 `wedding_journeys.progress` 에 두는 자리.
 *
 * 마이그레이션 없이 기존 공동 계획 쓰기 경로(`submit_couple_plan_change`)로 저장한다. 그 경로가
 * 판 번호 대조, 상대 알림, 확정 기록을 이미 맡고 있어서 새 쓰기 경계를 만들지 않는다.
 *
 * 저장된 값은 사람이 직접 고르거나 말한 것만이다. 모르는 칸은 null 로 두고 짐작으로 채우지 않는다.
 */

export const INVITATION_CONDITIONS_PROGRESS_KEY = "__invitationConditions" as const;

/** `journey.ts` 의 `JourneyPlan` 이 사는 키. */
export const JOURNEY_PLAN_PROGRESS_KEY = "__journeyPlan" as const;

export const CONDITION_LIMITS = {
  regionMaxChars: 20,
  timeLabelMaxChars: 20,
  guestMin: 1,
  guestMax: 2000,
  /** 희망 연도는 올해부터 이만큼 뒤까지 받는다. */
  yearsAhead: 5,
} as const;

export const PREPARATION_START_STAGES: readonly PreparationStartStage[] = ["start", "researching", "booked"];

export type InvitationConditions = {
  hopedYear: number | null;
  hopedMonth: number | null;
  /** `INVITATION_REGIONS` 의 짧은 이름. 웨딩홀 자료의 지역과 글자 그대로 맞춰 찾는다. */
  region: InvitationRegion | null;
  guestCount: number | null;
  /** "토요일 낮"처럼 두 사람이 말한 시간대. */
  timeLabel: string | null;
  startStage: PreparationStartStage | null;
};

export const EMPTY_INVITATION_CONDITIONS: InvitationConditions = {
  hopedYear: null,
  hopedMonth: null,
  region: null,
  guestCount: null,
  timeLabel: null,
  startStage: null,
};

export type InvitationConditionKey = "month" | "region" | "guests";

export function isPreparationStartStage(value: unknown): value is PreparationStartStage {
  return typeof value === "string" && (PREPARATION_START_STAGES as readonly string[]).includes(value);
}

const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** 앞뒤 공백이 없고, 제어·서식 문자가 없고, 글자 수가 맞는 한 줄. 아니면 null. */
export function cleanConditionText(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const length = Array.from(trimmed).length;
  if (length < 1 || length > maxChars || UNSAFE_TEXT.test(trimmed)) return null;
  return trimmed;
}

function cleanInteger(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

const GUEST_TEXT = /^(?:약|대략)?\s*(\d{1,3}(?:,\d{3})+|\d{1,5})\s*명?\s*(?:정도|쯤|내외)?$/u;

/**
 * 하객 수를 읽는다. 숫자, 또는 숫자 하나로 된 글("200", "200명", "1,200명", "약 200명", "200명 정도").
 * 범위("150~200명"), 숫자가 둘 이상인 글, 1명부터 2,000명 밖의 수는 null 이다. 짐작해서 하나를 고르지 않는다.
 */
export function parseGuestCount(value: unknown): number | null {
  if (typeof value === "number") return cleanInteger(value, CONDITION_LIMITS.guestMin, CONDITION_LIMITS.guestMax);
  if (typeof value !== "string") return null;
  const match = GUEST_TEXT.exec(value.normalize("NFKC").trim());
  if (!match) return null;
  return cleanInteger(Number(match[1].replace(/,/g, "")), CONDITION_LIMITS.guestMin, CONDITION_LIMITS.guestMax);
}

/**
 * 저장된 값을 읽는다. 모양이 틀린 칸은 버리고 null 로 둔다(다른 칸은 살린다).
 * 입력 검사는 서버의 PATCH 경계가 따로 엄격하게 한다.
 */
export function parseInvitationConditions(value: unknown): InvitationConditions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY_INVITATION_CONDITIONS;
  const record = value as Record<string, unknown>;
  const hopedYear = cleanInteger(record.hopedYear, 2000, 2200);
  const hopedMonth = cleanInteger(record.hopedMonth, 1, 12);
  return {
    // 연도와 달은 함께 있을 때만 쓴다. 한쪽만 있으면 날짜 줄을 지어내게 된다.
    hopedYear: hopedYear !== null && hopedMonth !== null ? hopedYear : null,
    hopedMonth: hopedYear !== null && hopedMonth !== null ? hopedMonth : null,
    region: normalizeInvitationRegion(record.region),
    guestCount: cleanInteger(record.guestCount, CONDITION_LIMITS.guestMin, CONDITION_LIMITS.guestMax),
    timeLabel: cleanConditionText(record.timeLabel, CONDITION_LIMITS.timeLabelMaxChars),
    startStage: isPreparationStartStage(record.startStage) ? record.startStage : null,
  };
}

/** 정한 예식일이 있으면 그 연·월을, 없으면 희망 연·월을 쓴다. */
export function conditionYearMonth(
  conditions: InvitationConditions,
  weddingDate: string | null,
): { year: number; month: number } | null {
  const match = weddingDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(weddingDate) : null;
  if (match) return { year: Number(match[1]), month: Number(match[2]) };
  if (conditions.hopedYear !== null && conditions.hopedMonth !== null) {
    return { year: conditions.hopedYear, month: conditions.hopedMonth };
  }
  return null;
}

export function missingConditions(
  conditions: InvitationConditions,
  weddingDate: string | null,
): readonly InvitationConditionKey[] {
  const missing: InvitationConditionKey[] = [];
  if (!conditionYearMonth(conditions, weddingDate)) missing.push("month");
  if (!conditions.region) missing.push("region");
  if (conditions.guestCount === null) missing.push("guests");
  return missing;
}

/** 준비 순서의 조건 칸 요약("2027년 5월, 서울, 200명"). 셋 중 하나라도 없으면 null. */
export function conditionsSummary(conditions: InvitationConditions, weddingDate: string | null): string | null {
  const when = conditionYearMonth(conditions, weddingDate);
  if (!when || !conditions.region || conditions.guestCount === null) return null;
  return `${when.year}년 ${when.month}월, ${conditions.region}, ${conditions.guestCount}명`;
}
