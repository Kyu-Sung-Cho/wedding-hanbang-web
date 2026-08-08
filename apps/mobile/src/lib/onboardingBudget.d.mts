export interface TaggedOnboardingBudget {
  amount: number;
  unit: "manwon";
}

export interface ValidOnboardingBudgetEvaluation {
  status: "valid";
  requestBudget: TaggedOnboardingBudget;
  totalBudgetWon: number;
  message: string;
}

export interface EmptyOnboardingBudgetEvaluation {
  status: "empty";
  requestBudget: null;
  totalBudgetWon: 0;
  message: string;
}

export interface InvalidOnboardingBudgetEvaluation {
  status: "invalid";
  requestBudget: null;
  totalBudgetWon: null;
  message: string;
}

export function evaluateOnboardingBudgetManwon(
  value: string,
):
  | ValidOnboardingBudgetEvaluation
  | EmptyOnboardingBudgetEvaluation
  | InvalidOnboardingBudgetEvaluation;
