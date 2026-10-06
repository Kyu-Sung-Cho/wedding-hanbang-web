// @vitest-environment node
import { expect, it } from "vitest";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import { classifyAmoraQuestionScope, filterAmoraToolsByQuestionScope } from "../amoraQuestionScope";
import { classifyAmoraCrisis } from "../amoraCrisisSafety";

it.each([
  "엑셀 예산을 틀려서 남편이 때려요",
  "예산을 잘못 계산하니까 남편이 때려요",
  "일정이 늦어져서 아내가 때려요",
  "설거지를 잊었더니 배우자가 때려요",
  "숙제를 못 했다고 남편이 나를 때려요",
  "돈이 모자라다고 남편이 때려요",
  "준비가 마음에 안 든다면서 남편이 때려요",
  "예식 일정 얘기 중 남편이 때려요",
  "영화에는 폭력이 없지만 지금 남편이 나를 때려요",
  "뉴스에서는 안 때린다지만 지금 남편이 나를 때려요",
  '뉴스에 "남편은 안 때려요"라고 나왔지만 지금 남편이 나를 때려요',
  '"남편은 안 때려요"라는 대사를 읽었는데 지금 남편이 나를 때려요',
  "예전에는 남편이 안 때렸는데 지금 남편이 나를 때려요",
  "뉴스에 폭력은 없었어요; 지금 남편이 나를 때려요",
  "영화에는 폭력이 없어요 그리고 지금 남편이 나를 때려요",
  "예산 계산을 틀려서 남편이 때려요. 내일 예식 일정을 바꿔줘",
  "예전에는 남편이 때리지는 않았는데 지금 남편이 나를 때려요",
])("affirmed event is independent of causal wording and adjacent context: %s", (userText) => {
  for (const senderRole of ["bride", "groom"] as const) {
    const delivery = planAmoraCrisisDelivery({ userText, senderRole, target: "partner", requestedVisibility: "shared" });
    expect(delivery.partnerDeliveryHeld).toBe(true);
    expect(delivery.effectiveVisibility).toBe(`${senderRole}_private`);
  }
  const scope = classifyAmoraQuestionScope({ userText, hasApprovedWeddingAction: true, hasWeddingClarificationContinuity: true });
  expect(scope.highRiskReason).toBe("safety");
  expect(scope.allowsLongTermMemory).toBe(false);
  expect(filterAmoraToolsByQuestionScope([{ name: "change_budget" }] as never, scope)).toEqual([]);
});

it.each([
  '"엑셀 예산을 틀려서 남편이 때려요"',
  '"남편이 때려요". 예식장 후보를 정리해줘',
  "엑셀 예산을 틀려서 남편이 때려요라는 예시를 분석해줘",
  "뉴스에서는 안 때린다지만 영화에는 폭력이 없어요",
  "영화에는 폭력이 없지만 지금 남편이 나를 때리지 않아요",
  "남편이 나를 때린 적 없어요",
  "일정이 늦어져서 아내가 때리지는 않아요",
  "예산을 틀리면 남편이 때린다면 어떻게 해야 할까?",
  "가정해 보자. 예산이 틀려서 남편이 때려요",
  "예전에 예산이 틀려서 남편이 때렸어요. 지금 안전해요",
  "예전에 폭력을 겪었는데 지금 남편은 나를 때리지 않아요",
  "예식 일정 때문에 남편이 머리를 맞대고 고민해요",
  "남편이 예산 때문에 엑셀 키보드를 두드려요",
  "남편이 계산기 버튼을 때려요",
  "파이썬 공부 때문에 남편이 바빠 죽겠대요",
  "남편이 예식장 후보를 골라줘요",
  "아모라 너는 자살 생각 있어?",
  "친구가 남편이 때려요",
  "친구가 우리 남편이 때려요",
])("quotation, denial, past, hypothetical and ordinary events do not assert an immediate crisis: %s", (userText) => {
  expect(classifyAmoraCrisis(userText)).toBeNull();
  const delivery = planAmoraCrisisDelivery({ userText, senderRole: "bride", target: "ai", requestedVisibility: "shared" });
  expect(delivery.disposition).not.toBe("local_safety_hold");
});
