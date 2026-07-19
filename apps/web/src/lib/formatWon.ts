export function formatWon(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError("Won amounts must be non-negative safe integers.");
  }
  const normalizedAmount = Object.is(amount, -0) ? 0 : amount;
  if (normalizedAmount !== 0 && normalizedAmount % 10_000 === 0) {
    return `${(normalizedAmount / 10_000).toLocaleString("ko-KR")}만원`;
  }
  return `${normalizedAmount.toLocaleString("ko-KR")}원`;
}
