export type BudgetPayerValue =
  | "couple"
  | "bride_parents"
  | "groom_parents"
  | "both_parents";

export type BudgetPayerPresentationOption = Readonly<{
  value: BudgetPayerValue;
  label: "두 사람" | "예비 신부 가족" | "예비 신랑 가족" | "내 가족" | "파트너 가족" | "두 가족";
}>;

export function resolveBudgetPayerOptions(input: {
  memberModelVersion: 1 | 2 | null;
  viewerRole: "bride" | "groom" | null;
}): readonly BudgetPayerPresentationOption[] | null;
