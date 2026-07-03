export const BETA_TOTAL = 50;
export const BETA_COUNTER_MIN = 10;

export function shouldShowBetaCounter(count: number): boolean {
  return count >= BETA_COUNTER_MIN;
}
