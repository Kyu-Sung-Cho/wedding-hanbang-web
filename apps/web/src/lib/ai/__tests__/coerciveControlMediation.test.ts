import { describe, expect, it } from "vitest";
import { findCoerciveControlSignals } from "@hanbang/shared";
import { classifyAmoraQuestionScope, hasAmoraSafetySignal } from "@/lib/ai/amoraQuestionScope";

// §9: "폭력, 협박, 스토킹, 위치 추적, 경제적 통제, 강압, 보복 위험, 즉각적인 안전
// 위험이 의심되면 기계적인 중립과 커플 중재를 중단한다."
//
// 중단 장치 자체는 이미 있었다 — `isStructuredMediation`이 W1일 때만 참이라
// W2로 떨어지면 합의안 카드가 만들어지지 않고 안전·전문기관 안내로 대체된다
// (apps/web/src/app/api/chat/route.ts). 비어 있던 것은 **감지 어휘**다.
//
// 사람은 "강압적 통제를 당하고 있어요"라고 말하지 않는다.

function mediationScope(userText: string) {
  return classifyAmoraQuestionScope({ userText, requestKind: "mediation" }).scope;
}
function chatScope(userText: string) {
  return classifyAmoraQuestionScope({ userText, requestKind: "chat" }).scope;
}

describe("강압적 통제가 합의안으로 넘어가지 않는다", () => {
  it.each([
    ["경제적 통제", "결혼 준비 때문에 다퉜어요. 남편이 제 월급을 다 가져가고 생활비를 안 줘요."],
    ["경제적 통제 - 허락", "예산 얘기만 하면 싸워요. 카드도 허락받고 써야 해요."],
    ["감시", "예식장 정하는 걸로 싸웠는데, 제 폰을 매일 확인하고 카톡도 다 봐요."],
    ["위치 추적", "요즘 다투는데 제가 어디 있는지 계속 확인해요."],
    ["고립", "상견례 얘기하다 틀어졌어요. 친구들을 못 만나게 해요."],
    ["강압", "결혼 준비를 시키는 대로 해야 하고, 말 안 들으면 화를 내요."],
    ["보복 위협", "헤어지자고 하면 가만 안 둔다고 해요."],
  ])("%s: 중재 요청이 합의안 대신 안전 경로로 간다", (_label, text) => {
    expect(mediationScope(text)).toBe("W2_high_risk_adjacent");
  });
});

describe("평범한 결혼 대화를 고위험으로 만들지 않는다", () => {
  // 오탐의 대가도 실재한다 — 고위험으로 떨어지면 도구가 전부 막힌다.
  it.each([
    "예산은 신랑이 관리하기로 했는데 제가 좀 답답해요.",
    "부모님이 통장을 하나 만들어 주셨어요. 어떻게 쓰는 게 좋을까요?",
    "예식장 위치를 아직 못 정했어요.",
    "친구들을 몇 명이나 부를지로 의견이 달라요.",
    "생활비를 어떻게 나눌지 아직 얘기 못 했어요.",
    "청첩장 문구를 각자 확인하기로 했어요.",
    "스드메 계약을 누가 할지 정하지 못했어요.",
  ])("중재 요청이어도 그대로 조율 경로다: %s", (text) => {
    expect(mediationScope(text)).toBe("W1_wedding_adjacent");
  });
});

describe("낮춘 문턱은 중재에만 적용된다", () => {
  // 일반 대화에까지 넓히면 평범한 재정·일정 이야기가 고위험으로 떨어진다. 아래 두 문장은 고백이
  // 아니다 — 낮춘 문턱의 낱말(`돈 … 가져가`·`시키는 대로`)이 들어 있을 뿐이다. 중재에서는 이런
  // 문장도 안전 경로로 가는데, 그것은 받아들인 값이다(합의안 대신 사실 정리를 받는 안전한 실패,
  // `coerciveControlSignals.ts` 머리말). 일반 대화에서는 그대로 조율 경로여야 한다.
  // (기존 고위험 패턴에 걸리는 문장은 원래대로 W2다 — 여기서는 그 목록에 없는 표현을 골라
  //  이 규칙만의 효과를 본다.)
  //
  // 2026-09-27: 예전 판은 실제 고백 `친구들을 못 만나게 해서 속상해요.` 를 여기에 두고 "일반 대화는
  // W2 가 아니다" 로 못 박았다. 그 전 예문 `친구들을 못 만나게 해요.` 가 닫힌 어휘 폭력 판정에
  // 잡히자 다른 고백으로 갈아 끼운 것이다. 이 단언은 누출을 정상으로 고정하고 있었다. 예문은 고백이
  // 아닌 문장으로 바꾸고, 그 고백은 아래 누출 기록으로 옮겼다.
  it.each([
    "계약금 낼 돈은 신랑이 가져가서 예식장에 냈어요.",
    "일정은 웨딩플래너가 시키는 대로 잡았어요.",
  ])("같은 문장이라도 일반 대화는 이 규칙으로 막지 않는다: %s", (text) => {
    // 이 규칙의 낱말이 실제로 들어 있다(안 들어 있으면 아래 두 단언은 아무것도 재지 않는다).
    expect(findCoerciveControlSignals(text)).not.toEqual([]);
    expect(mediationScope(text)).toBe("W2_high_risk_adjacent");
    expect(chatScope(text)).not.toBe("W2_high_risk_adjacent");
    expect(hasAmoraSafetySignal(text, "chat")).toBe(false);
  });
});

describe("민감공유 보호 — 일반 대화의 고립 고백도 공유·기억·준비 도구로 넘기지 않는다", () => {
  // 낮은 문턱의 중재 정규식은 그대로 둔다. 별도 절 단위 보호가 이 일반 고백을 잡는다.
  const LEAK = "친구들을 못 만나게 해서 속상해요.";

  it("중재 요청이면 낮춘 문턱이 잡는다", () => {
    expect(mediationScope(LEAK)).toBe("W2_high_risk_adjacent");
  });

  it("일반 대화에서도 안전 신호가 서고 장기기억을 허용하지 않는다", () => {
    expect(hasAmoraSafetySignal(LEAK, "chat")).toBe(true);
    expect(classifyAmoraQuestionScope({ userText: LEAK, requestKind: "chat" }))
      .toMatchObject({ scope: "W2_high_risk_adjacent", highRiskReason: "safety", allowsLongTermMemory: false });
  });
});

describe("신호 분류", () => {
  it("어떤 종류가 걸렸는지 알려준다", () => {
    expect(findCoerciveControlSignals("제 월급을 다 가져가요")).toContain("economic_control");
    expect(findCoerciveControlSignals("제 폰을 매일 확인해요")).toContain("surveillance");
    expect(findCoerciveControlSignals("가족을 못 만나게 해요")).toContain("isolation");
    expect(findCoerciveControlSignals("시키는 대로 해야 해요")).toContain("coercion");
    expect(findCoerciveControlSignals("신고하면 가만 안 둔대요")).toContain("retaliation_threat");
  });

  it("적대적인 입력에도 던지지 않는다", () => {
    for (const hostile of [null, undefined, 42, {}, []]) {
      expect(() => findCoerciveControlSignals(hostile as never)).not.toThrow();
      expect(findCoerciveControlSignals(hostile as never)).toEqual([]);
    }
  });

  it("문장이 끊기면 넘어서 잇지 않는다", () => {
    // 마침표 너머의 무관한 단어를 끌어와 억지로 신호를 만들지 않는다.
    expect(findCoerciveControlSignals("월급 얘기를 했어요. 요즘은 예산을 다 확인해요."))
      .toEqual([]);
  });
});
