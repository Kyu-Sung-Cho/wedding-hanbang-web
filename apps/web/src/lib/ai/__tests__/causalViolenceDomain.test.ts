// @vitest-environment node
import { expect, it } from "vitest";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import { buildAmoraQuestionScopeInstruction, classifyAmoraQuestionScope, filterAmoraToolsByQuestionScope } from "../amoraQuestionScope";
import { buildAmoraSystemPrompt } from "../amoraPromptComposer";

it.each([
  "파이썬 공부 때문에 남편이 때려요",
  "결혼 예산 때문에 남편이 때려요",
  "숙제 때문에 아내가 때려요",
  "내가 코딩해서 남편이 때려요",
])("causal context does not suppress affirmative partner assault: %s", (userText) => {
  for (const senderRole of ["bride", "groom"] as const) {
    const delivery = planAmoraCrisisDelivery({ userText, senderRole, target: "partner", requestedVisibility: "shared" });
    expect(delivery.disposition).not.toBe("continue");
    expect(delivery.partnerDeliveryHeld).toBe(true);
    expect(delivery.effectiveVisibility).toBe(`${senderRole}_private`);
  }
  const scope = classifyAmoraQuestionScope({ userText, hasApprovedWeddingAction: true, hasWeddingClarificationContinuity: true });
  expect(scope).toMatchObject({ scope: "W2_high_risk_adjacent", highRiskReason: "safety", allowsLongTermMemory: false });
  expect(filterAmoraToolsByQuestionScope([{ name: "change_budget" }] as never, scope)).toEqual([]);
  expect(buildAmoraQuestionScopeInstruction(scope)).toContain("합의안");
});

it.each([
  "파이썬 공부 때문에 남편이 때리지 않아요",
  "파이썬 공부 때문에 남편이 때려요라는 영화 대사를 분석해줘",
  '소설에 "파이썬 공부 때문에 남편이 때려요"라는 문장이 있어',
  "파이썬 공부 때문에 남편이 때린다면 어떻게 해야 할까?",
  "예전에 파이썬 공부 때문에 남편이 때렸어요. 지금 안전해요",
  "파이썬 공부 때문에 남편이 머리를 맞대고 고민해요",
  "남편이 파이썬 공부 때문에 바빠 죽겠대요",
  "아모라 너는 자살 생각 있어?",
])("controls do not invent a current assault: %s", (userText) => {
  const delivery = planAmoraCrisisDelivery({ userText, senderRole: "bride", target: "ai", requestedVisibility: "shared" });
  expect(delivery.disposition).not.toBe("local_safety_hold");
});

it.each([
  "결혼 예산표에서 SUM 함수로 총액을 계산하려면?",
  "결혼 준비 예산표를 파이썬 코드로 합산해줘",
  "예식 준비 일정표를 엑셀 날짜순으로 정리하고 싶어",
])("useful wedding technology remains within the domain: %s", (userText) => {
  expect(classifyAmoraQuestionScope({ userText }).scope).toBe("W0_wedding_core");
});

it.each([
  "파이썬 리스트를 오름차순 정렬하는 법 알려줘",
  "파이썬으로 피보나치 짜줘",
])("unrelated coding is redirected to wedding preparation: %s", (userText) => {
  const scope = classifyAmoraQuestionScope({ userText });
  expect(scope.scope).toBe("W4_out_of_scope");
  expect(scope.allowsLongTermMemory).toBe(false);
  expect(buildAmoraQuestionScopeInstruction(scope)).toContain("결혼 준비와 분명히 무관한 대행은 하지 마세요");
  expect(buildAmoraQuestionScopeInstruction(scope)).toContain("결혼 준비 쪽으로 바꿔 도울 수 있는 것이 있으면 하나만 제시하세요");
});

it.each([undefined, "linked_context_only"] as const)("off-domain refusal reaches the composed model instruction: %s", (linkedContextMode) => {
  const questionScope = classifyAmoraQuestionScope({ userText: "파이썬 리스트를 오름차순 정렬하는 법 알려줘" });
  const prompt = buildAmoraSystemPrompt({ weddingDate: null, budget: 0, venue: null, progress: {}, bookings: [], brideName: null, groomName: null, senderName: "합성", scheduleEvents: [], chatSummaries: [] }, {
    requestKind: "chat", persistenceMode: "durable", questionScope, linkedContextMode, enabledToolNames: [],
  });
  expect(prompt).toContain("question_scope: W4_out_of_scope");
  expect(prompt).toContain("결혼 준비와 분명히 무관한 대행은 하지 마세요");
  expect(prompt).toContain("결혼 준비 쪽으로 바꿔 도울 수 있는 것이 있으면 하나만 제시하세요");
});
