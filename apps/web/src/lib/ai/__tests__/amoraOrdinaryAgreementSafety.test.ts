import { describe, expect, it } from "vitest";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import { classifyAmoraQuestionScope, hasAmoraSafetySignal } from "../amoraQuestionScope";

const WEDDING_AGREEMENTS = [
  "신랑과 취향이 딱 맞았어",
  "신랑이랑 취향이 잘 맞았어",
  "신랑이랑 취향이 맞았어",
  "신랑이랑 의견이 딱 맞았어",
  "아내와 의견이 잘 맞았어요",
  "예비 신부와 취향이 맞았어요",
  "우리 신랑과 취향이 딱 맞았어. 예산부터 정하자",
  "그건 아니고 신랑이 제안한 안이 맞았어",
] as const;

const SAFE_CORRECTIONS = [
  "아니, 폭력 얘기가 아니라 의견이 맞았다는 뜻이야",
  "폭력 이야기는 아니고 취향이 맞았다는 말이에요",
  "폭행 말은 아니라 계산이 맞았다는 뜻입니다",
] as const;

const WEDDING_CORRECTIONS = [
  "신랑이 맞았다는 뜻 아니고 계산이 맞았어",
] as const;

const DANGER_CONTROLS = [
  "신랑한테 맞았어",
  "신랑과 취향이 딱 맞았어. 그런데 오늘 남편한테 맞았어",
  "신랑과 취향이 딱 맞았는데 남편이 저를 때렸어",
  "아니, 의견이 아니라 남편이 저를 때린 거예요",
  "폭력 얘기가 아니라 의견이 맞았다는 뜻이야. 그런데 지금 남편이 목을 조르고 있어",
  "신랑이랑 취향이 맞았어. 그런데 지금 죽고 싶어",
  "신랑이랑 취향이 맞았어. 남편이 제 폰을 매일 확인해요",
  "남편이 던진 양 말이 맞았어요",
  "남편이 취향이 안 맞는다고 때렸어",
  "아니, 폭력 얘기가 아니라 의견이 맞았다는 뜻이야. 어제도 신랑한테 맞았어",
  "남편이 화만 나면 맞았어요",
  "취향이 맞았다는 뜻은 아니고 남편한테 맞았어",
  "폭력 얘기가 아니라는 건 아니야. 남편한테 맞았어",
  "내가 때린 건 아니고 남편이 나를 때렸어",
  "신랑과 취향이 딱 맞았어. 친구가 오늘 죽으려고 해요",
  "작년에 남편에게 맞았어. 지금은 안전해. 신랑과 취향이 딱 맞았어",
  "신랑과 취향이 딱 맞았어. 어제 남편이 때렸고 오늘도 또 맞을까 무서워",
  "남편이 '취향이 맞았어'라고 말하면서 저를 때렸어요",
  "남편이 '폭력 얘기가 아니라 의견이 맞았다는 뜻이야'라고 하면서 저를 때렸어요",
  "'폭력 얘기가 아니라 의견이 맞았다는 뜻이야'는 예문이고 지금 남편이 목을 조르고 있어",
  "신랑이 맞았다는 뜻 아니고 계산이 맞았어. 그래도 어제 남편에게 맞았어",
  "신랑이 맞았다는 뜻 아니고 계산이 맞았어. 지금 남편이 죽이겠다고 해",
  "신랑이 맞았다는 뜻 아니고 계산이 맞았어. 친구가 오늘 죽으려고 해요",
  "신랑이 맞았다는 뜻 아니고 계산이 맞았어. 내가 때린 건 아니고 남편이 저를 때렸어",
  "신랑이 제안한 안이 맞았어. 남편이 던진 양 말이 맞았어요",
] as const;

describe("ordinary Korean agreement is not a violence disclosure", () => {
  it.each(WEDDING_AGREEMENTS)("keeps explicit abstract agreement in the requested shared lane: %s", (text) => {
    expect(hasAmoraSafetySignal(text)).toBe(false);
    expect(classifyAmoraQuestionScope({ userText: text }).scope).not.toBe("W2_high_risk_adjacent");
    for (const target of ["ai", "partner"] as const) {
      expect(planAmoraCrisisDelivery({
        userText: text, requestedVisibility: "shared", senderRole: "bride", target,
        externalSafetySignal: hasAmoraSafetySignal(text),
      })).toMatchObject({ disposition: "continue", effectiveVisibility: "shared" });
    }
  });

  it.each([...SAFE_CORRECTIONS, ...WEDDING_CORRECTIONS])("accepts an explicit correction of the word's meaning without declaring the whole message safe: %s", (text) => {
    expect(hasAmoraSafetySignal(text)).toBe(false);
    for (const target of ["ai", "partner"] as const) {
      expect(planAmoraCrisisDelivery({
        userText: text, requestedVisibility: "shared", senderRole: "groom", target,
        externalSafetySignal: hasAmoraSafetySignal(text),
      })).toMatchObject({ disposition: "continue", effectiveVisibility: "shared" });
    }
  });

  it.each(DANGER_CONTROLS)("keeps the independent or corrected actual danger: %s", (text) => {
    expect(hasAmoraSafetySignal(text)).toBe(true);
    for (const target of ["ai", "partner"] as const) {
      const delivery = planAmoraCrisisDelivery({
        userText: text, requestedVisibility: "shared", senderRole: "bride", target,
        externalSafetySignal: hasAmoraSafetySignal(text),
      });
      expect(delivery.disposition).not.toBe("continue");
      expect(delivery.effectiveVisibility).toBe("bride_private");
      if (target === "partner") expect(delivery.disposition).toBe("local_safety_hold");
    }
  });

  it.each([
    "남편이랑 다퉜는데 내가 맞았어",
    "친구 남편 말이 맞았대",
    "친구 남편과 취향이 딱 맞았어",
    "친구 남편이 맞았다는 뜻 아니고 계산이 맞았어",
    "폭력 얘기가 아니야",
    "폭력 얘기가 아니라 의견이 맞았다는 뜻이라고 말하래",
  ])("does not broaden ambiguous, third-party, or uncompleted correction boundaries: %s", (text) => {
    expect(hasAmoraSafetySignal(text)).toBe(true);
  });
});
