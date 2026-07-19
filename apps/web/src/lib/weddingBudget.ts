/** Product-wide wedding budget ceiling: 10억 원. */
export const MAX_WEDDING_BUDGET_WON = 1_000_000_000;

export function isValidWeddingWonAmount(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= MAX_WEDDING_BUDGET_WON;
}
