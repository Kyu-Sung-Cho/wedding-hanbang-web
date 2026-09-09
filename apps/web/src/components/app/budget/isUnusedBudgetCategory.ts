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
