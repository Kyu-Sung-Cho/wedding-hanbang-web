import { describe, expect, it } from "vitest";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import { classifyAmoraQuestionScope, hasAmoraSafetySignal } from "../amoraQuestionScope";

const PRIVATE = [
  "뉴스에서 본 것처럼 남편이 때려요",
  "뉴스에서 본 것처럼 어제 찍은 영상에서 남편이 때려요",
  "영화에서나 보던 일인데 남편이 휴대폰을 빼앗고 연락을 못 하게 해요",
  "친구들과 영화에서 본 대사를 이야기하다가 남편이 내 팔을 세게 잡았어",
  "뉴스에서 본 상담소를 찾아보려는데 자해 생각이 나요",
];
const CONTENT = [
  "영화에서 자해 생각이 나요라는 대사를 봤어",
  "요즘 자해 생각이 나요라는 문장을 뉴스에서 읽었어요",
  "드라마에서 남편이 휴대폰을 빼앗는 장면을 봤어",
  "뉴스에서 본 것처럼 연출한 장면에서 남편이 때려요",
  "영화에서 '그런 일인데 남편이 때려요'라는 대사를 봤어",
  "뉴스에서 본 상담소를 찾아보려는데 자해 생각은 없어요",
];

describe("media context must not erase a later real disclosure", () => {
  it.each(PRIVATE)("keeps the later disclosure private: %s", (text) => {
    expect(classifyAmoraQuestionScope({ userText: text }).allowsLongTermMemory).toBe(false);
    for (const senderRole of ["bride", "groom"] as const) {
      for (const target of ["ai", "partner"] as const) {
        for (const server of [false, true]) {
          const plan = planAmoraCrisisDelivery({
            userText: text, senderRole, target, requestedVisibility: "shared",
            ...(server ? { externalSafetySignal: hasAmoraSafetySignal(text, "chat") } : {}),
          });
          expect(plan.effectiveVisibility).toBe(`${senderRole}_private`);
          expect(plan.partnerDeliveryHeld).toBe(target === "partner");
        }
      }
    }
  });
  it.each(CONTENT)("preserves an explicit content reference or negation: %s", (text) => {
    const plan = planAmoraCrisisDelivery({
      userText: text, senderRole: "bride", target: "ai", requestedVisibility: "shared",
      externalSafetySignal: hasAmoraSafetySignal(text, "chat"),
    });
    expect(plan.disposition).toBe("continue");
  });
});
