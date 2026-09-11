interface BudgetSummaryCategory {
  key: string;
  budget: number | null;
  spent: number;
}

export interface StoredBudgetSummary {
  totalBudget: number;
  totalSpent: number;
  categories: BudgetSummaryCategory[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function won(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** 명시 지출 기준의 저장된 조회 결과만 사용한다. 현재 상태로 빈 필드를 채우지 않는다. */
export function readStoredBudgetSummary(output: unknown): StoredBudgetSummary | null {
  if (!record(output)
    || output.recorded_spend_basis !== "explicit_spent_only"
    || !won(output.total_budget)
    || !won(output.total_spent)
    || !Array.isArray(output.categories)
    || !won(output.custom_categories_omitted)) return null;

  const seen = new Set<string>();
  const categories: BudgetSummaryCategory[] = [];
  let shownSpent = 0;
  for (const category of output.categories) {
    if (!record(category) || typeof category.key !== "string" || !category.key.trim()
      || seen.has(category.key) || !won(category.spent)) return null;
    const budget = category.allocated;
    if (!(category.allocated_is_set === true && won(budget))
      && !(category.allocated_is_set === false && budget === null)) return null;
    seen.add(category.key);
    categories.push({ key: category.key, budget: typeof budget === "number" ? budget : null, spent: category.spent });
    shownSpent += category.spent;
    if (!Number.isSafeInteger(shownSpent)) return null;
  }
  // 일부 사용자 항목이 생략된 목록을 전체 합계로 다시 더하지 않는다.
  if (shownSpent > output.total_spent
    || (output.custom_categories_omitted === 0 && shownSpent !== output.total_spent)) return null;

  return { totalBudget: output.total_budget, totalSpent: output.total_spent, categories };
}
