/** Product-wide wedding budget ceiling: 10억 원. */
export const MAX_WEDDING_BUDGET_WON = 1_000_000_000;

export function isValidWeddingWonAmount(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= MAX_WEDDING_BUDGET_WON;
}

/** 만원 입력의 소수 네 자리는 원 단위다. 부동소수점 곱셈이나 절삭 없이 읽는다. */
export function parseWeddingBudgetManwonInput(input: string): number | null {
  const normalized = input.trim();
  if (normalized.length > 32
    || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,4})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.replaceAll(",", "").split(".");
  const won = Number(whole) * 10_000 + Number(fraction.padEnd(4, "0"));
  return isValidWeddingWonAmount(won) && won > 0 ? won : null;
}

/**
 * 상한을 사람이 읽는 말로. **문구를 손으로 적지 말고 이걸 쓴다.**
 *
 * 2026-09-01 운영 실측: 아모라만 `"0원 이상 1조원 이하"` 라고 말하고 있었다.
 * 실제로 거절하는 값은 `MAX_WEDDING_BUDGET_WON`(10억)이라 **50억을 넣은 사람은
 * "1조까지 된다"는 안내를 받으며 계속 거절당한다.** 제품의 다른 표면
 * (온보딩·설정·여정·가격 조합)은 전부 10억으로 맞게 말하고 있었고 아모라 두 곳만
 * 어긋나 있었다.
 *
 * 손으로 적은 문구는 상수가 바뀔 때 같이 안 바뀐다. 그래서 값에서 만든다.
 */
export function formatWeddingBudgetCeiling(): string {
  const 억 = MAX_WEDDING_BUDGET_WON / 100_000_000;
  if (Number.isInteger(억) && 억 < 10_000) return `${억}억원`;
  const 조 = MAX_WEDDING_BUDGET_WON / 1_000_000_000_000;
  if (Number.isInteger(조)) return `${조}조원`;
  return `${MAX_WEDDING_BUDGET_WON.toLocaleString("ko-KR")}원`;
}
