import { parseManwonInput } from "./budgetRevision.mjs";

export function evaluateOnboardingBudgetManwon(value) {
  const normalized = value.trim();
  if (normalized === "") {
    return {
      status: "empty",
      requestBudget: null,
      totalBudgetWon: 0,
      message: "아직 정하지 않았다면 비워두셔도 돼요.",
    };
  }
  let totalBudgetWon;
  try {
    totalBudgetWon = parseManwonInput(normalized);
  } catch {
    return {
      status: "invalid",
      requestBudget: null,
      totalBudgetWon: null,
      message: "총 예산은 1~100,000 사이의 숫자(만원 단위)로 입력해주세요.",
    };
  }
  const amount = Number(normalized);
  if (totalBudgetWon === 0) {
    return {
      status: "invalid",
      requestBudget: null,
      totalBudgetWon: null,
      message: "아직 정하지 않았다면 0 대신 비워주세요.",
    };
  }

  return {
    status: "valid",
    requestBudget: { amount, unit: "manwon" },
    totalBudgetWon,
    message: `${amount.toLocaleString("ko-KR")}만원으로 저장돼요.`,
  };
}
