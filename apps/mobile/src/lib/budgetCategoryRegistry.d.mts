export interface BudgetCategoryDescriptor {
  key: string;
  label: string;
}

export function resolveCanonicalBudgetCategoryDeepLink(
  requestedCategory: string | string[] | undefined,
  fixedCategories: readonly BudgetCategoryDescriptor[],
): string | null;

export type BudgetCategoryPayer =
  | "couple"
  | "bride_parents"
  | "groom_parents"
  | "both_parents";

export interface VerifiedBudgetCategoryEditor {
  categoryKey: string;
  editBase: {
    ownerId: string;
    coupleId: string;
    stateRevision: number;
  };
  budgetInput: string;
  spentInput: string;
  payerInput: BudgetCategoryPayer;
}

export function buildVerifiedBudgetCategoryEditor(input: {
  requestedCategory: string | string[] | undefined;
  fixedCategories: readonly BudgetCategoryDescriptor[];
  verifiedIdentity: unknown;
}): VerifiedBudgetCategoryEditor | null;

export function listBudgetCategories(input: {
  fixedCategories: readonly BudgetCategoryDescriptor[];
  progress: Record<string, unknown>;
}): BudgetCategoryDescriptor[];
