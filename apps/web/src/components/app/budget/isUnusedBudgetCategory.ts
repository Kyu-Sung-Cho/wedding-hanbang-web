export function isUnusedBudgetCategory(key: string, item: unknown): boolean {
  if (item === undefined) return true;
  if (item === null || typeof item !== "object" || Array.isArray(item)) return false;

  // 0원·분담·메모 등 명시된 기록은 빈 항목으로 취급하지 않는다.
  // 과거/새 필드도 보존하고, 템플릿의 시작 상태만 접는다.
  return Object.entries(item).every(([field, value]) =>
    (field === "category" && value === key)
    || (field === "status" && value === "not_started"),
  );
}

/**
 * "안 해요"로 고른 기본 항목에 예산·기록 지출·예전 금액이 하나도 없으면 예산 행으로 두지 않는다.
 * 금액이 하나라도 있으면 합계에 들어가므로 행과 '안 해요' 표시를 그대로 보여준다.
 */
export function isSkippedBudgetCategoryWithoutMoney(item: unknown): boolean {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
  const record = item as Record<string, unknown>;
  if (record.status !== "not_applicable") return false;
  return !["budget", "spent", "cost"].some((field) => {
    const value = record[field];
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  });
}
