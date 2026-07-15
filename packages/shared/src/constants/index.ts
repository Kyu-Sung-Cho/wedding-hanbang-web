export const COUPLE_INVITE_CODE_LENGTH = 15;
export const COUPLE_INVITE_CODE_EXAMPLE = "WH-A1B2C3D4E5F6";

/**
 * 사용자가 현재 첨부 전송 고지를 확인했다는 요청 계약 버전.
 *
 * 고지의 수령자·처리 범위가 바뀌면 이 값을 새 버전으로 올린다. 서버는
 * 첨부가 있는 요청에서 문자열 존재 여부가 아니라 이 값과의 exact match만
 * 동의로 인정한다.
 */
export const attachmentProviderConsentVersion = "2026-07-14.openai-attachments.v1" as const;

const COUPLE_INVITE_CODE_PATTERN = /^WH-[A-Z0-9]{12}$/;

export function normalizeCoupleInviteCode(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.startsWith("WH")) {
    return `WH-${compact.slice(2, 14)}`;
  }
  return compact.slice(0, COUPLE_INVITE_CODE_LENGTH);
}

export function isCoupleInviteCode(value: unknown): value is string {
  return typeof value === "string" && COUPLE_INVITE_CODE_PATTERN.test(value);
}

export function manwonInputToWon(value: string): number {
  const normalized = value.replace(/[\s,]/g, "");
  if (!/^\d+$/.test(normalized)) return 0;

  const manwon = Number(normalized);
  const won = manwon * 10_000;
  return Number.isSafeInteger(won) && won > 0 && won <= 10_000_000_000 ? won : 0;
}

export function wonToManwonInput(value: unknown): string {
  const won = Number(value);
  return Number.isFinite(won) && won > 0 ? String(won / 10_000) : "";
}

/**
 * 결혼 예산은 사용자가 직접 입력한 경우에만 값으로 취급한다.
 * 0은 현재 DB 계약에서 "아직 정하지 않음"을 뜻한다.
 */
export function normalizeOptionalBudgetWon(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  return rounded > 0 && rounded <= 10_000_000_000 ? rounded : 0;
}

/**
 * 현재 커플 권한 모델이 실제로 안전하게 지원하는 관계 구성이다.
 *
 * couples.bride_id/groom_id와 비공개 채팅 가시성을 member A/B 구조로
 * 이전하기 전까지 UI에서 이 범위를 넓혀 말하지 않는다.
 */
export const PUBLIC_BETA_RELATIONSHIP_SCOPE = Object.freeze({
  supportedRoles: Object.freeze(["bride", "groom"] as const),
  notice:
    "현재 베타의 커플 연결과 비공개 대화는 신부 1명·신랑 1명 역할 구조만 지원해요.",
  guidance:
    "관계를 판단하는 기준이 아니라 현재 데이터 보호 구조의 기술적 한계예요. 두 역할 중 하나를 정확히 선택할 수 없다면 아직 가입하지 말아 주세요.",
} as const);
