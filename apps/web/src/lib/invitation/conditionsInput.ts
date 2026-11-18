import {
  CONDITION_LIMITS,
  cleanConditionText,
  isPreparationStartStage,
  normalizeInvitationRegion,
  parseGuestCount,
  type InvitationConditions,
} from "@hanbang/shared/invitation";
import { isRecord } from "@/utils/requestValidation";

/**
 * PATCH `/api/invitation/conditions` 본문 검사. 보낸 칸만 바꾸고 null 은 그 칸을 지운다.
 * 모르는 칸이 하나라도 있으면 통째로 거절한다. 희망 연도와 달은 함께 보내야 하고 지난 달은 받지 않는다.
 * 지역은 정본 목록(`INVITATION_REGIONS`)의 짧은 이름으로만 저장한다. 하객 수는 `parseGuestCount` 로 읽는다.
 */

const KEYS = new Set(["hopedYear", "hopedMonth", "region", "guestCount", "timeLabel", "startStage"]);

export type ConditionsPatchResult =
  | { ok: true; patch: Partial<InvitationConditions> }
  | { ok: false; field: string; error: string };

const fail = (field: string, error: string): ConditionsPatchResult => ({ ok: false, field, error });

/** `todayYmd` 는 한국 날짜(YYYY-MM-DD)다. */
export function parseConditionsPatch(body: unknown, todayYmd: string): ConditionsPatchResult {
  if (!isRecord(body)) return fail("body", "요청 형식이 올바르지 않아요.");
  const keys = Object.keys(body);
  if (keys.length === 0) return fail("body", "바꿀 조건이 없어요.");
  if (keys.some((key) => !KEYS.has(key))) return fail("body", "알 수 없는 조건이 있어요.");

  const patch: Partial<InvitationConditions> = {};
  const hasYear = "hopedYear" in body;
  const hasMonth = "hopedMonth" in body;
  if (hasYear !== hasMonth) return fail("hopedMonth", "희망 연도와 달을 함께 보내 주세요.");
  if (hasYear && hasMonth) {
    if (body.hopedYear === null && body.hopedMonth === null) {
      patch.hopedYear = null;
      patch.hopedMonth = null;
    } else {
      const year = body.hopedYear;
      const month = body.hopedMonth;
      const [thisYear, thisMonth] = todayYmd.split("-").map(Number);
      if (
        typeof year !== "number" || !Number.isSafeInteger(year)
        || typeof month !== "number" || !Number.isSafeInteger(month)
        || month < 1 || month > 12
        || year < thisYear || year > thisYear + CONDITION_LIMITS.yearsAhead
        || (year === thisYear && month < thisMonth)
      ) {
        return fail("hopedMonth", "희망 시기는 이번 달부터 5년 안에서 골라 주세요.");
      }
      patch.hopedYear = year;
      patch.hopedMonth = month;
    }
  }

  if ("region" in body) {
    if (body.region === null) patch.region = null;
    else {
      const region = normalizeInvitationRegion(body.region);
      if (!region) return fail("region", "지역은 목록에서 골라 주세요.");
      patch.region = region;
    }
  }

  if ("guestCount" in body) {
    if (body.guestCount === null) patch.guestCount = null;
    else {
      const guests = parseGuestCount(body.guestCount);
      if (guests === null) return fail("guestCount", "하객 수는 1명부터 2,000명 사이의 숫자 하나로 적어 주세요.");
      patch.guestCount = guests;
    }
  }

  if ("timeLabel" in body) {
    if (body.timeLabel === null) patch.timeLabel = null;
    else {
      const timeLabel = cleanConditionText(body.timeLabel, CONDITION_LIMITS.timeLabelMaxChars);
      if (!timeLabel) return fail("timeLabel", "시간대는 20자 안으로 적어 주세요.");
      patch.timeLabel = timeLabel;
    }
  }

  if ("startStage" in body) {
    if (body.startStage === null) patch.startStage = null;
    else if (!isPreparationStartStage(body.startStage)) return fail("startStage", "준비 단계를 다시 골라 주세요.");
    else patch.startStage = body.startStage;
  }

  return { ok: true, patch };
}

/** 저장된 조건에 바꿀 칸을 얹는다. 저장 모양은 `parseInvitationConditions` 가 읽는 모양과 같다. */
export function mergeConditions(
  current: InvitationConditions,
  patch: Partial<InvitationConditions>,
): InvitationConditions {
  return { ...current, ...patch };
}

export function conditionsEqual(left: InvitationConditions, right: InvitationConditions): boolean {
  return (Object.keys(left) as (keyof InvitationConditions)[]).every((key) => left[key] === right[key]);
}

/** 확정 기록과 상대 알림에 남는 한 줄. 사람이 읽는 꼴이고 240자를 넘지 않는다. */
export function conditionsChangeSummary(next: InvitationConditions): string {
  const parts: string[] = [];
  if (next.hopedYear !== null && next.hopedMonth !== null) parts.push(`${next.hopedYear}년 ${next.hopedMonth}월`);
  if (next.region) parts.push(next.region);
  if (next.guestCount !== null) parts.push(`하객 ${next.guestCount}명`);
  if (next.timeLabel) parts.push(next.timeLabel);
  return parts.length > 0 ? `결혼 조건: ${parts.join(", ")}` : "결혼 조건을 비웠어요";
}
