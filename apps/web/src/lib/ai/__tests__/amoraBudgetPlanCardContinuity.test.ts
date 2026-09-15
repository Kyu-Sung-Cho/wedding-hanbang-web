// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  BUDGET_PLAN_CARD_BUBBLE_TEXT,
  extractAmoraPendingAction,
  withAmoraBudgetPlanCardLines,
} from "@/lib/ai/amoraPendingAction";
import { WEDDING_TOOLS } from "@/lib/ai/tools";

/**
 * 리뷰 [4]: 예산안 카드의 말풍선은 목록 없이 짧은 안내만 싣는다(같은 목록이 카드에 또 그려져
 * 두 번 보였다). 그런데 카드를 확인한 뒤 "그럼 한복은 얼마로 됐어?" 처럼 연결 문맥(도구 없음)으로
 * 이어지는 턴은 닻 답변의 본문만 모델에 보낸다 — 금액을 볼 곳이 없어 모르거나 지어낸다.
 * 연결 문맥에 넣는 닻 본문에만 카드에 보인 항목 줄을 사람이 읽는 형태로 되붙인다.
 */
const NOW = Date.parse("2026-09-15T01:00:00.000Z");
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_INPUT = {
  total_budget: 35_000_000,
  allocations: [
    { category: "hanbok", budget: 1_500_000, rationale: "사용자가 정한 예산" },
    { category: "yedan", budget: 2_000_000, rationale: "사용자가 정한 예산" },
  ],
  intake_summary: "한복 150만 원, 예단 200만 원 배분",
};

function issuedPlan() {
  const extraction = extractAmoraPendingAction({
    text: `[pending_action]${JSON.stringify({ tool: "apply_budget_plan", input: PLAN_INPUT })}[/pending_action]`,
    allowedTools: WEDDING_TOOLS,
    now: NOW,
    createActionId: () => ACTION_ID,
    currentTotalBudget: 30_000_000,
  });
  expect(extraction.cleanText).toBe(BUDGET_PLAN_CARD_BUBBLE_TEXT);
  return extraction.pendingAction!;
}

describe("연결 문맥의 예산안 카드 닻 본문", () => {
  it("확인 쌍이 뒤따르면 카드에 보인 금액을 적용 결과를 따르라는 표시와 함께 붙인다", () => {
    const content = withAmoraBudgetPlanCardLines(BUDGET_PLAN_CARD_BUBBLE_TEXT, issuedPlan(), { confirmationFollows: true });
    expect(content.startsWith(BUDGET_PLAN_CARD_BUBBLE_TEXT)).toBe(true);
    expect(content).toContain("- 한복: 150만 원");
    expect(content).toContain("- 총예산: 3,000만 원 → 3,500만 원");
    expect(content).toContain("[카드에 보인 예산안 — 적용 여부는 뒤의 실행 결과를 따르세요]");
    // 도구 없는 턴에서 모델이 따라 하면 가짜 확인문이 된다. 여는 질문과 표식은 싣지 않는다.
    expect(content).not.toContain("적용할까요?");
    expect(content).not.toContain("[pending_action]");
  });

  it("아직 누르지 않은 카드면 저장된 값이 아니라고 표시한다", () => {
    const content = withAmoraBudgetPlanCardLines(BUDGET_PLAN_CARD_BUBBLE_TEXT, issuedPlan(), { confirmationFollows: false });
    expect(content).toContain("[미확인 제안 — 저장된 값 아님]");
    expect(content).toContain("- 두 가족에게 드릴 선물: 200만 원");
    expect(content).not.toContain("적용 여부는 뒤의 실행 결과");
  });

  it("남은 건수 안내가 붙은 말풍선에도 붙는다", () => {
    const bubble = `${BUDGET_PLAN_CARD_BUBBLE_TEXT}\n\n나머지 1건은 이 확인이 끝나면 이어서 제안할게요.`;
    expect(withAmoraBudgetPlanCardLines(bubble, issuedPlan(), { confirmationFollows: true })).toContain("- 한복: 150만 원");
  });

  it("예산안 짧은 말풍선이 아닌 답변·다른 카드·망가진 표식에는 아무것도 붙이지 않는다", () => {
    const plan = issuedPlan();
    // 목록이 이미 본문에 있던 예전 행은 두 번 싣지 않는다.
    expect(withAmoraBudgetPlanCardLines(plan.confirmation, plan, { confirmationFollows: true })).toBe(plan.confirmation);
    expect(withAmoraBudgetPlanCardLines("총예산을 바꿨어요.", plan, { confirmationFollows: true })).toBe("총예산을 바꿨어요.");
    const budgetCard = { ...plan, tool: "update_budget", confirmation: "다음 변경을 적용할까요?\n- 총 예산: 3,000만 원" };
    expect(withAmoraBudgetPlanCardLines(BUDGET_PLAN_CARD_BUBBLE_TEXT, budgetCard, { confirmationFollows: true }))
      .toBe(BUDGET_PLAN_CARD_BUBBLE_TEXT);
    for (const broken of [null, undefined, "x", { ...plan, version: 1 }, { ...plan, confirmation: 3 }, { ...plan, confirmation: "- 한복: 150만 원" }]) {
      expect(withAmoraBudgetPlanCardLines(BUDGET_PLAN_CARD_BUBBLE_TEXT, broken, { confirmationFollows: true }))
        .toBe(BUDGET_PLAN_CARD_BUBBLE_TEXT);
    }
  });
});
