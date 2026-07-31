/**
 * 갈등 감지의 클라이언트/서버 공통 안전 규칙.
 *
 * 이 모듈은 브라우저에서도 사용할 수 있도록 외부 provider나 서버 전용
 * 의존성을 갖지 않는다.
 */

export function normalizeConflictText(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/[?!.,~^_\-:;'"`*]/g, "")
    .replace(/(.)\1{2,}/g, "$1$1")
    .toLowerCase();
}

const THIRD_PARTY_SUBJECTS = [
  "엄마가", "아빠가", "아버지가", "어머니가",
  "부모님이", "시어머니가", "시아버지가", "장모님이", "장인어른이",
  "시댁에서", "친정에서",
  "친구가", "동료가", "회사에서", "상사가",
  "플래너가", "업체가", "직원이", "담당자가",
  "걔가", "쟤가", "그애가", "그분이",
];

/**
 * 제3자를 주어로 한 현재/과거 서술은 시점 표현이 없어도 제외한다.
 * 예: "친구가 너무 화났어", "엄마가 절대 반대래".
 *
 * 직접적인 커플 발화가 함께 있는 문장을 놓칠 수는 있지만, 자동 중재는
 * false positive가 관계를 악화시킬 수 있어 보수적인 false negative를 택한다.
 */
export function looksLikeThirdPartyNarrative(
  rawMessage: string,
  normalizedMessage = normalizeConflictText(rawMessage),
): boolean {
  return THIRD_PARTY_SUBJECTS.some((keyword) =>
    rawMessage.includes(keyword)
    || normalizedMessage.includes(normalizeConflictText(keyword))
  );
}
