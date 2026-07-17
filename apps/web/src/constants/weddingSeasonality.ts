/**
 * Wedding Hanbang's product taxonomy for SEASONAL_DATA price calculations.
 * This is not a universal claim about every vendor or local wedding market.
 */
export type WeddingSeason = "peak" | "off_peak";

export const PEAK_WEDDING_MONTHS = [4, 5, 6, 9, 10, 11] as const;
export const OFF_PEAK_WEDDING_MONTHS = [1, 2, 3, 7, 8, 12] as const;
export const PEAK_WEDDING_MONTHS_LABEL = "4~6월, 9~11월";
export const OFF_PEAK_WEDDING_MONTHS_LABEL = "1~3월, 7~8월, 12월";

const PEAK_WEDDING_MONTH_SET = new Set<number>(PEAK_WEDDING_MONTHS);

export function getWeddingSeason(month: number): WeddingSeason {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError("Wedding month must be an integer from 1 through 12");
  }

  return PEAK_WEDDING_MONTH_SET.has(month) ? "peak" : "off_peak";
}
