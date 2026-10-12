// @vitest-environment node
import { describe, expect, it } from "vitest";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import { classifyAmoraQuestionScope, hasAmoraSafetySignal } from "../amoraQuestionScope";

function expectProtectedDelivery(text: string): void {
  const scope = classifyAmoraQuestionScope({ userText: text });
  expect(["W2_high_risk_adjacent", "W5_safety_override"]).toContain(scope.scope);
  expect(scope.allowsLongTermMemory).toBe(false);
  for (const senderRole of ["bride", "groom"] as const) {
    for (const target of ["ai", "partner"] as const) {
      const result = planAmoraCrisisDelivery({
        userText: text, requestedVisibility: "shared", senderRole, target,
        externalSafetySignal: hasAmoraSafetySignal(text),
      });
      expect(result.disposition).not.toBe("continue");
      expect(result.effectiveVisibility).toBe(`${senderRole}_private`);
      expect(result.safetyPrivacyRedirected).toBe(true);
      if (target === "partner") expect(result.partnerDeliveryHeld).toBe(true);
    }
  }
}

describe("폭력·통제 고백의 공유 저장 전 경계", () => {
  it("발길질 고백의 연결 어미 뒤 도움 요청도 상대에게 공유하지 않는다", () => {
    expectProtectedDelivery("신랑이 나한테 발길질을 했는데 도와줘.");
  });

  it("손목을 잡아서 못 나가게 했다는 과거 사건도 상대에게 공유하지 않는다", () => {
    expectProtectedDelivery("신랑이 제 손목을 잡아서 못 나가게 했어요.");
  });

  it("협박 전언 뒤 두려움을 덧붙여도 상대에게 공유하지 않는다", () => {
    expectProtectedDelivery("신랑이 저를 죽여버린대요 너무 무서워요.");
  });

  it("주먹으로 얼굴을 가격했다고 말해도 상대에게 공유하지 않는다", () => {
    expectProtectedDelivery("남편이 주먹으로 얼굴을 가격했어요.");
  });

  it("파혼 이야기에 죽었다고 협박한 사건도 상대에게 공유하지 않는다", () => {
    expectProtectedDelivery("파혼 얘기하니까 신랑이 넌 죽었다고 협박했어요.");
  });

  it("이전에는 없던 자해 생각이 지금 난다는 갱신도 개인 안전으로 보낸다", () => {
    expectProtectedDelivery("자해 생각은 예전엔 없었지만 지금 자꾸 나요.");
  });

  it("발길질 뒤 이어진 부상 서술도 개인 안전으로 보낸다", () => {
    expectProtectedDelivery("신랑이 저한테 발길질을 했고 저는 다쳤어요.");
  });

  it("발길질을 해서 무섭다는 원인·결과 서술도 개인 안전으로 보낸다", () => {
    expectProtectedDelivery("신랑이 저한테 발길질을 해서 지금 무서워요.");
  });

  it("제게라는 피해 대상 표현도 개인 안전으로 보낸다", () => {
    expectProtectedDelivery("결혼 준비하다가 신랑이 제게 발길질을 했어요.");
  });

  it("가격했다는 연결 서술도 개인 안전으로 보낸다", () => {
    expectProtectedDelivery("남편이 제 얼굴을 주먹으로 가격했는데 무서워요.");
  });

  it("못 나가게 했다는 연결 서술도 개인 안전으로 보낸다", () => {
    expectProtectedDelivery("신랑이 제 손목을 잡고 못 나가게 했는데 무서워요.");
  });

  it("친구가 배우자에게 발길질을 당했다는 전언도 공유하지 않는다", () => {
    expectProtectedDelivery("친구가 신랑에게 발길질을 당했고 지금 무섭대요.");
  });

  it("친구의 배우자가 친구를 겨냥한 살해 협박도 공유하지 않는다", () => {
    expectProtectedDelivery("친구의 남편이 친구를 죽여버린대요.");
  });

  it("자해 생각이 지금 다시 든다는 갱신도 공유하지 않는다", () => {
    expectProtectedDelivery("자해 생각이 예전에는 없었는데 지금 다시 들어요.");
  });

  it("친구가 발길질을 당했다고 전한 경우도 공유하지 않는다", () => {
    expectProtectedDelivery("친구가 신랑에게 발길질을 당했다고 해요.");
  });

  it("준비 배경이 붙은 발길질 고백도 상대에게 공유하지 않는다", () => {
    expectProtectedDelivery("결혼식 준비하다가 신랑이 저한테 발길질을 했어요.");
  });

  it("주먹으로 얼굴을 친 고백도 상대에게 공유하지 않는다", () => {
    expectProtectedDelivery("예식장 얘기하다가 신랑이 얼굴을 주먹으로 쳤어요.");
  });

  it("손목을 잡아 나가지 못하게 하는 통제도 상대에게 공유하지 않는다", () => {
    expectProtectedDelivery("결혼식 준비 얘기하다가 신랑이 손목을 꽉 잡고 나가지 못하게 해요.");
  });

  it("파혼 뒤 죽이겠다는 보고형 협박도 상대에게 공유하지 않는다", () => {
    expectProtectedDelivery("파혼한다고 하니까 신랑이 죽여버린대요.");
  });

  it("주먹 폭력의 현재형도 상대에게 공유하지 않는다", () => {
    expectProtectedDelivery("결혼 준비하다가 신랑이 제 얼굴을 주먹으로 쳐요.");
  });

  it.each([
    "결혼 준비하다가 신랑이 주먹으로 제 얼굴을 쳤어요.",
    "결혼 준비하다가 신랑이 제 얼굴을 주먹으로 치고 있어요.",
    "결혼 준비하다가 신랑이 제 손목을 잡아서 못 나가게 해요.",
    "파혼한다고 하니까 신랑이 저를 죽여버리겠대요.",
  ])("동작 순서·현재 진행·전언 변형도 보호한다: %s", expectProtectedDelivery);
});

describe("폭력 어휘를 빌린 비사건 표현의 경계", () => {
  it.each([
    '"결혼식 준비하다가 신랑이 저한테 발길질을 했어요."라는 문장의 어미만 고쳐줘.',
    "결혼식 준비하다가 신랑이 저한테 발길질을 한 적은 없어요.",
    "결혼식 준비하다가 신랑이 저한테 발길질을 하지 않았어요.",
    "예식장 얘기하다가 신랑이 얼굴을 주먹으로 친 적은 없어요.",
    "결혼식 준비 얘기하다가 신랑이 손목을 꽉 잡고 나가지 못하게 한 적은 없어요.",
    "파혼한다고 하니까 신랑이 죽여버린대요라는 영화 대사를 분석해줘.",
    "드라마에서 신랑이 죽여버린대요.",
    "신랑이 게임에서 몬스터를 죽여버린대요.",
    "신랑이 얼굴 모양 샌드백을 주먹으로 쳤어요.",
    "신랑이 운동장에서 공에 발길질을 했어요.",
    "친구가 신랑이 저한테 발길질을 했어요.",
    "신랑이 장난감 손목을 꽉 잡고 나가지 못하게 해요.",
    "결혼 준비하다가 신랑이 제 얼굴을 주먹으로 안 쳐요.",
    '"신랑이 제 얼굴을 주먹으로 쳐요."라는 문장을 분석해줘.',
    "신랑이 얼굴 모양 샌드백을 주먹으로 쳐요.",
    "자해 생각은 예전엔 없었지만 지금 식대만 계산해줘.",
    "신랑이 저를 죽여버린다고 한 적은 없어요.",
    "신랑이 저를 죽인다고 한 적은 없어요.",
    "신랑이 저를 죽이겠다고 말한 적이 없어요.",
    "신랑이 저를 죽여 버린다고 말한 적은 없어요.",
    "만약 친구의 남편이 친구를 죽여버린다고 한다면 어떻게 해야 하나요?",
  ])("사람 대상 고백이 아닌 표현을 공유 위기로 오판하지 않는다: %s", (text) => {
    expect(hasAmoraSafetySignal(text)).toBe(false);
    const result = planAmoraCrisisDelivery({
      userText: text, requestedVisibility: "shared", senderRole: "bride", target: "ai",
      externalSafetySignal: hasAmoraSafetySignal(text),
    });
    expect(result.disposition).toBe("continue");
    expect(result.safetyPrivacyRedirected).toBe(false);
  });
});
