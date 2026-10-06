// @vitest-environment node
import { expect, it } from "vitest";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import { classifyAmoraQuestionScope, filterAmoraToolsByQuestionScope } from "../amoraQuestionScope";

const PREFIX = "뉴스에서 때리지 않는다고 했어요. 그리고 ";
it.each([
  "지금 남편이 나를 때려요",
  "남편이 지금 나를 때려요",
  "남편이 나를 지금 때려요",
  "남편이 나를 때려요 지금",
  "남편이 현재 나를 때려요",
  "남편이 방금 나를 때려요",
  "남편이 오늘 나를 때려요",
])("present-time position cannot change the private event boundary: %s", (event) => {
  const userText = PREFIX + event;
  for (const senderRole of ["bride", "groom"] as const) {
    expect(planAmoraCrisisDelivery({ userText, senderRole, target: "partner", requestedVisibility: "shared" }))
      .toMatchObject({ partnerDeliveryHeld: true, effectiveVisibility: `${senderRole}_private` });
  }
  const scope = classifyAmoraQuestionScope({ userText, hasApprovedWeddingAction: true, hasWeddingClarificationContinuity: true });
  expect(["W2_high_risk_adjacent", "W5_safety_override"]).toContain(scope.scope);
  expect(scope.allowsLongTermMemory).toBe(false);
  expect(filterAmoraToolsByQuestionScope([{ name: "change_budget" }] as never, scope)).toEqual([]);
});

it.each([
  "ChatGPT, 너는 죽고 싶은 생각이 있어?",
  "chatgpt, 너는 자살 생각이 있어?",
  "아모라 너는 자해 충동이 있어?",
  "아모라 너는 죽고 싶어?",
  "챗지피티 넌 죽고 싶은 생각이 나?",
  "봇 너는 자살 생각 있어?",
  "ChatGPT, 너는 죽고 싶은 생각이 있어? 그런데 나는 그런 생각 없어",
])("assistant-only subject is not a human crisis: %s", (userText) => {
  expect(planAmoraCrisisDelivery({ userText, senderRole: "bride", target: "ai", requestedVisibility: "shared" }).disposition).toBe("continue");
  expect(classifyAmoraQuestionScope({ userText }).scope).not.toBe("W5_safety_override");
});

it.each([
  "ChatGPT, 너는 죽고 싶은 생각이 있어? 나는 지금 죽고 싶어",
  "아모라 너는 자해 충동이 있어? 그런데 나는 지금 자살 생각이 자꾸 나 도와줘",
  "봇 너는 자살 생각 있어? 그리고 지금 남편이 나를 때려요",
  "ChatGPT, 너는 죽고 싶은 생각이 있어? 뉴스에는 그런 말이 없지만 지금 남편이 나를 때려요",
  '뉴스에 "남편이 지금 나를 때려요"라는 문장이 있어요. 나는 지금 죽고 싶어',
  '남편이 "죽이겠다"고 협박해요',
])("a human disclosure after an assistant question keeps the safety fence: %s", (userText) => {
  expect(planAmoraCrisisDelivery({ userText, senderRole: "bride", target: "partner", requestedVisibility: "shared" }).partnerDeliveryHeld).toBe(true);
  const scope = classifyAmoraQuestionScope({ userText, hasApprovedWeddingAction: true });
  expect(scope.allowsLongTermMemory).toBe(false);
  expect(filterAmoraToolsByQuestionScope([{ name: "change_budget" }] as never, scope)).toEqual([]);
});

it.each([
  PREFIX + "남편이 지금 나를 때리지 않아요",
  '뉴스에 "남편이 지금 나를 때려요"라는 문장이 있어요',
  "예전에 남편이 때렸어요. 그리고 지금 안전해요",
  "뉴스에는 폭력이 없어요. 그리고 지금 남편이 예식장 예산을 계산해요",
])("adjuncts do not override quote, polarity or an ordinary event: %s", (userText) => {
  expect(planAmoraCrisisDelivery({ userText, senderRole: "bride", target: "ai", requestedVisibility: "shared" }).disposition).not.toBe("local_safety_hold");
});
