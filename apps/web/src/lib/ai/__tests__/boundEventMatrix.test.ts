// @vitest-environment node
import { expect, it } from "vitest";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import { classifyAmoraCrisis } from "../amoraCrisisSafety";
import { classifyAmoraQuestionScope, filterAmoraToolsByQuestionScope, hasAmoraSafetySignal } from "../amoraQuestionScope";

const risk = [
  "오늘은 남편이 나를 때려요", "지금은 아내가 나를 때려요", "현재는 배우자가 나를 때려요",
  "오늘도 남편이 나를 때려요", "남편이 오늘은 나를 때려요",
  "남편이 죽여버릴 거라고 협박해요", '남편이 "죽여버릴 거야"라고 협박해요',
  '남편이 "때릴 거야"라고 협박해요', "남편이 죽일 거라고 협박해요",
  '영화에서 들은 대사로 남편이 "죽여버릴 거야"라고 협박해요',
  '남편이 영화에서 들은 "죽이겠다"는 말로 나를 협박해요',
  "영화에서 남편이 지금 아내를 때려요. 하지만 현실에서도 남편이 나를 때려요",
  "내 소설 속 남편이 아내를 때려요. 그런데 지금 남편이 나를 때려요",
  "남편이 지금 북을 때려요. 그리고 지금 남편이 나를 때려요",
  "ChatGPT 너는 지금 죽고 싶어? 나는 지금 죽고 싶어",
  "영화를 보고 나서 남편이 나를 때려요 무서워요",
  "남편이 지금 강아지를 때려요 무서워요", "남편이 아이를 때려요 도와주세요",
  "남편이 지금 접시를 집어 던져요",
  '남편이 지금 접시를 집어 던져요. 그리고 남편이 "죽일 거야"라고 협박해요',
];
it.each(risk)("human event or actual threat attribution wins over ordinary/fiction/bot frames: %s", (userText) => {
  for (const senderRole of ["bride", "groom"] as const) {
    expect(planAmoraCrisisDelivery({ userText, senderRole, target: "partner", requestedVisibility: "shared" }))
      .toMatchObject({ partnerDeliveryHeld: true, effectiveVisibility: `${senderRole}_private` });
  }
  const scope = classifyAmoraQuestionScope({ userText, hasApprovedWeddingAction: true, hasWeddingClarificationContinuity: true });
  expect(["W2_high_risk_adjacent", "W5_safety_override"]).toContain(scope.scope);
  expect(scope.allowsLongTermMemory).toBe(false);
  expect(filterAmoraToolsByQuestionScope([{ name: "change_budget" }] as never, scope)).toEqual([]);
  expect(hasAmoraSafetySignal(userText, "chat")).toBe(true);
});

const objects = ["북을", "드럼을", "피아노를", "공을", "키보드를", "계산기 버튼을"];
const benign = [
  ...objects.map((object) => `남편이 지금 ${object} 때려요`),
  ...objects.map((object) => `오늘은 아내가 ${object} 세게 때려요`),
  "ChatGPT 너는 지금 죽고 싶어?", "아모라 너는 오늘 죽고 싶어?", "봇 너는 현재 자살 생각이 있어?",
  "영화에서 남편이 지금 아내를 때려요", "내 소설 속 남편이 지금 아내를 때려요",
  '영화에서 남편이 "죽여버릴 거야"라고 협박해요',
  "드라마에서 배우자가 지금 아내를 때려요",
  "남편이 지금 나를 때리지 않아요", "남편이 죽인다고 협박한 건 아니에요",
  '"남편이 죽여버릴 거라고 협박해요"라는 문장을 분석해줘',
  "남편이 죽일 거라고 협박한 적 없어요",
  '남편이 "죽여버릴 거야"라고 협박하지 않아요',
  '남편이 "때릴 거야"라고 협박하지는 않아요',
];
it.each(benign)("explicit nonhuman/fiction/assistant frame does not become a human safety event: %s", (userText) => {
  expect(classifyAmoraCrisis(userText)).toBeNull();
  expect(planAmoraCrisisDelivery({ userText, senderRole: "bride", target: "partner", requestedVisibility: "shared" }).partnerDeliveryHeld).toBe(false);
  const scope = classifyAmoraQuestionScope({ userText });
  expect(scope.scope).not.toBe("W5_safety_override");
  expect(scope.highRiskReason).not.toBe("safety");
});

it("an adjacent private safety event does not lower a current threat", () => {
  const userText = '남편이 지금 접시를 집어 던져요. 그리고 남편이 "죽일 거야"라고 협박해요';
  expect(classifyAmoraCrisis(userText)).toMatchObject({ kind: "interpersonal_danger" });
  expect(classifyAmoraQuestionScope({ userText }).scope).toBe("W5_safety_override");
});
