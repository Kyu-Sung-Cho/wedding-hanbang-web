import { INVITATION_TEXT } from "./copy";
import type { InvitationFacts } from "./types";

/**
 * 청첩장 홈의 빈칸 계산. 홈은 "빈칸이 있는 청첩장"이고 준비가 진행될수록 날짜와 장소가
 * 채워진다(아티팩트 메모). 칸은 다섯이다: 두 사람 이름, 예식 달, 예식 시간대, 예식 날, 예식장.
 * 아티팩트 홈은 셋이 채워지고 둘(날·예식장)이 비어 "청첩장 빈칸 2개 남음"과 막대 5개 중 3개를 보인다.
 * 저장된 사실이 없는 칸을 짐작으로 채우지 않는다.
 */

export const INVITATION_FIELD_COUNT = 5;

/** 비어 있는 날짜 조각. 아티팩트는 밑줄 두 개(`__`)를 흐린 색으로 둔다. */
export const BLANK_MARK = "__";

export function invitationNames(facts: Pick<InvitationFacts, "firstName" | "secondName">): string | null {
  const names = [facts.firstName, facts.secondName].map((name) => name?.trim() ?? "").filter(Boolean);
  if (names.length === 0) return null;
  return names.join(` ${INVITATION_TEXT.joiner} `);
}

export type InvitationDatePart = { text: string; blank: boolean };

/** 날짜 줄의 조각들. 빈칸은 `blank: true` 로 표시해 화면이 흐린 색으로 그린다. */
export function invitationDateParts(facts: Pick<InvitationFacts, "year" | "month" | "day">): readonly InvitationDatePart[] {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    facts.year === null ? { text: "____", blank: true } : { text: String(facts.year), blank: false },
    facts.month === null ? { text: BLANK_MARK, blank: true } : { text: pad(facts.month), blank: false },
    facts.day === null ? { text: BLANK_MARK, blank: true } : { text: pad(facts.day), blank: false },
  ];
}

function present(value: string | null): boolean {
  return value !== null && value.trim() !== "";
}

export function filledInvitationFieldCount(facts: InvitationFacts): number {
  return [
    present(facts.firstName) && present(facts.secondName),
    facts.year !== null && facts.month !== null,
    present(facts.timeLabel),
    facts.year !== null && facts.month !== null && facts.day !== null,
    present(facts.venueName),
  ].filter(Boolean).length;
}

export function invitationBlankCount(facts: InvitationFacts): number {
  return INVITATION_FIELD_COUNT - filledInvitationFieldCount(facts);
}

export function isVenuePending(facts: Pick<InvitationFacts, "venueName">): boolean {
  return !present(facts.venueName);
}
