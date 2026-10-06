// @vitest-environment node
import { expect, it } from "vitest";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import { classifyAmoraQuestionScope, filterAmoraToolsByQuestionScope } from "../amoraQuestionScope";

it.each([
  "남은 할 일은? 신랑이 죽인다고 협박해요",
  "신랑이 죽인다고 협박해요. 남은 할 일은?",
  "남편이 죽인다고 협박해요",
])("affirmed lethal reported speech takes W5 priority: %s", (userText) => {
  const scope = classifyAmoraQuestionScope({ userText, hasApprovedWeddingAction: true, hasWeddingClarificationContinuity: true });
  expect(scope.scope).toBe("W5_safety_override");
  expect(scope.allowsLongTermMemory).toBe(false);
  expect(filterAmoraToolsByQuestionScope([{ name: "change_budget" }] as never, scope)).toEqual([]);
});

it.each([
  "영화에서처럼 남편이 나를 때려요",
  "영화에서 본 것처럼 남편이 나를 때려요",
  "남편이 북을 때리는 게 아니라 나를 때려요",
  "영화에서 남편이 아내를 때려요. 실제로는 남편이 나를 때려요",
  "남편이 협박하지 않는다고 말하지만 오늘 죽여버릴 거라고 협박해요",
  "아모라야, 넌 자살 생각이 있어? 나는 그런 생각이 있어. 도와줘",
  "ChatGPT 너는 죽고 싶어? 나도 그런 생각이 있어",
  "봇 너는 자살 생각 있어? 지금은 그런 생각이 있어",
])("excluded spans cannot erase real human disclosure: %s", (userText) => {
  for (const senderRole of ["bride", "groom"] as const) {
    expect(planAmoraCrisisDelivery({ userText, senderRole, target: "partner", requestedVisibility: "shared" }))
      .toMatchObject({ partnerDeliveryHeld: true, effectiveVisibility: `${senderRole}_private` });
  }
  const scope = classifyAmoraQuestionScope({ userText, hasApprovedWeddingAction: true, hasWeddingClarificationContinuity: true });
  expect(scope.allowsLongTermMemory).toBe(false);
  expect(filterAmoraToolsByQuestionScope([{ name: "change_budget" }] as never, scope)).toEqual([]);
});

it.each([
  "아모라 너는 자살 생각 있어? 나는 그런 생각이 있는지 모르겠어",
  "아모라 너는 자살 생각 있어? 나도 그래",
])("uncertain human reference stays private without inventing immediate intent: %s", (userText) => {
  expect(planAmoraCrisisDelivery({ userText, senderRole: "bride", target: "ai", requestedVisibility: "shared" }))
    .toMatchObject({ disposition: "private_safety_route", effectiveVisibility: "bride_private" });
  expect(planAmoraCrisisDelivery({ userText, senderRole: "bride", target: "partner", requestedVisibility: "shared" }).partnerDeliveryHeld).toBe(true);
});

it.each([
  "영화에서 남편이 아내를 때렸다는 장면을 분석해줘",
  "남편이 북을 때렸어요. 나는 안전해요",
  "남편이 북을 때리는 중이에요",
  "아모라야, 넌 자살 생각이 있어? 나는 그런 생각이 아니야",
  "아모라 너는 자살 생각 있어? 나는 그런 생각이 없어",
  "남편이 북을 계속 때리고 있어요",
])("literal fiction/object or explicit human denial retains ordinary delivery: %s", (userText) => {
  expect(planAmoraCrisisDelivery({ userText, senderRole: "bride", target: "partner", requestedVisibility: "shared" }).partnerDeliveryHeld).toBe(false);
});
