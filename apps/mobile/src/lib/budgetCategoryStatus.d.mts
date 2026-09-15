export type BudgetCategoryStatus = "not_started" | "in_progress" | "completed" | "not_applicable";

export function readBudgetCategoryStatus(item: unknown): BudgetCategoryStatus;

export function isSkippedBudgetCategoryWithoutMoney(item: unknown): boolean;
