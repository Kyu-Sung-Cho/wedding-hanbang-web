export interface BudgetCategoryDescriptor {
  key: string;
  label: string;
}

export function listBudgetCategories(input: {
  fixedCategories: readonly BudgetCategoryDescriptor[];
  progress: Record<string, unknown>;
}): BudgetCategoryDescriptor[];
