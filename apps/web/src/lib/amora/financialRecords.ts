export interface FinancialRecordTotals {
  categoryPlanTotal: number;
  contractedTotal: number;
  paidToDate: number;
}

function recordedAmount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Sums only current, explicitly named user records.
 * Legacy `spent`/`cost` values are intentionally excluded because their meaning is ambiguous.
 */
export function getFinancialRecords(
  progress: Record<string, unknown>,
): FinancialRecordTotals {
  return Object.entries(progress).reduce<FinancialRecordTotals>(
    (totals, [key, value]) => {
      if (key.startsWith("__") || !value || typeof value !== "object" || Array.isArray(value)) {
        return totals;
      }

      const item = value as {
        budget?: unknown;
        contractedTotal?: unknown;
        paidToDate?: unknown;
      };
      return {
        categoryPlanTotal: totals.categoryPlanTotal + recordedAmount(item.budget),
        contractedTotal: totals.contractedTotal + recordedAmount(item.contractedTotal),
        paidToDate: totals.paidToDate + recordedAmount(item.paidToDate),
      };
    },
    { categoryPlanTotal: 0, contractedTotal: 0, paidToDate: 0 },
  );
}
