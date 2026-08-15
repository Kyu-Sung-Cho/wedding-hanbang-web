import { describe, expect, it } from "vitest";
import { findCoerciveControlSignals } from "@hanbang/shared";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

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
    ["반복 이동 감시", "어디 가는지 매번 검사해요."],
    ["고립", "상견례 얘기하다 틀어졌어요. 친구들을 못 만나게 해요."],
    ["강압", "결혼 준비를 시키는 대로 해야 하고, 말 안 들으면 화를 내요."],
    ["보복 위협", "헤어지자고 하면 가만 안 둔다고 해요."],
    ["과거 신체 폭력", "어제 날 벽으로 밀었어."],
    ["신체 폭력 완곡어", "남친이 또 손을 올렸어."],
    ["상해 위협", "나를 다치게 할 거라고 했어."],
    ["위협적 물건 투척", "화나면 물건을 던져."],
    ["대상 특정 물건 투척", "남편이 휴대폰을 나한테 던졌어"],
    ["목 압박", "남편이 숨 못 쉬게 목을 눌렀어"],
    ["머리채 폭력", "남편이 머리채를 잡았어"],
    ["팔 비틀기", "남편이 팔을 비틀었어"],
    ["비동의 성관계", "성관계 싫다고 했는데 억지로 했어"],
    ["거부 뒤 비동의 관계", "관계를 거부했는데 억지로 했어"],
    ["반복 위치 전송 강요", "외출할 때마다 위치 보내라고 해"],
    ["사진 유포 위협", "내 사진을 뿌리겠다고 겁줘"],
  ])("%s: 중재 요청이 합의안 대신 안전 경로로 간다", (_label, text) => {
    expect(mediationScope(text)).toBe("W2_high_risk_adjacent");
  });

  it.each([
    "내가 남편을 밀쳤어. 조율해줘.",
    "제가 아내 목을 졸랐어요. 중재해 주세요.",
    "내가 신랑한테 화가 나서 물건을 던졌어.",
    "내가 물건을 아내에게 던졌어. 조율해줘.",
    "내가 여자친구에게 성관계를 강요했어. 합의안을 만들어줘.",
  ])("요청자가 해를 가했다고 말해도 공동 중재로 보내지 않는다: %s", (text) => {
    expect(["W2_high_risk_adjacent", "W5_safety_override"])
      .toContain(mediationScope(text));
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
    "내가 남편과 상의해서 일정을 뒤로 밀었어.",
    "제가 아내 목도리를 느슨하게 매어 줬어요.",
    "내가 신랑한테 꽃다발을 던져 줬어.",
    "내가 물건을 아내에게 건네줬어.",
    "내가 남편을 밀친 건 아니야.",
    "내가 여자친구에게 성관계에 대한 생각을 물었고 서로 동의했어.",
  ])("중재 요청이어도 그대로 조율 경로다: %s", (text) => {
    expect(mediationScope(text)).toBe("W1_wedding_adjacent");
  });
});

describe("낮춘 문턱은 중재에만 적용된다", () => {
  it("같은 문장이라도 일반 대화는 이 규칙으로 막지 않는다", () => {
    // 일반 대화에까지 넓히면 평범한 재정·일정 이야기가 고위험으로 떨어진다.
    // (기존 고위험 패턴에 걸리는 문장은 원래대로 W2다 — 여기서는 그 목록에 없는
    //  표현을 골라 이 규칙만의 효과를 본다.)
    const text = "친구들을 못 만나게 해요.";
    expect(mediationScope(text)).toBe("W2_high_risk_adjacent");
    expect(chatScope(text)).not.toBe("W2_high_risk_adjacent");
  });
});

describe("신호 분류", () => {
  it("어떤 종류가 걸렸는지 알려준다", () => {
    expect(findCoerciveControlSignals("제 월급을 다 가져가요")).toContain("economic_control");
    expect(findCoerciveControlSignals("제 폰을 매일 확인해요")).toContain("surveillance");
    expect(findCoerciveControlSignals("어디 가는지 매번 검사해요")).toContain("surveillance");
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

  it("공유 일정 확인을 이동 감시로 오인하지 않는다", () => {
    expect(findCoerciveControlSignals("웨딩 일정이 어디까지 갔는지 매번 함께 확인해요."))
      .toEqual([]);
  });
});
