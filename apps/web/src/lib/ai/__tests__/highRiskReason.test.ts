import { describe, expect, it } from "vitest";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

// 고위험(W2)은 성격이 다른 두 가지를 한 통에 담고 있었다.
//
//   도메인 — 법률·의료·금융. 아모라가 판단할 자격이 없다는 뜻이다.
//   안전   — 폭력·통제·자해. 이 대화를 합의안으로 끌고 가면 안 된다는 뜻이다.
//
// 섞여 있으면 계약금 환불로 다투는 커플이 안전 사안과 같은 취급을 받는다. 실제로
// 평범한 중재 요약 20개 중 5개가 W2로 떨어졌다(2026-08-07 측정). 두 갈래를 앞으로
// 다르게 다뤄야 하므로 판정 시점에 사유를 남긴다.

function scope(userText: string) {
  return classifyAmoraQuestionScope({ userText, requestKind: "mediation" });
}

/** 아모라가 판단할 자격이 없는 영역. 위험한 관계라는 뜻이 아니다. */
const DOMAIN = [
  "예식장 계약금 환불이 안 된다는데 오빠는 그냥 진행하자고 하고 저는 옮기고 싶어요",
  "웨딩홀 계약 해지 문제로 서로 의견이 안 맞아요",
  "전세 대출 한도 때문에 신혼집 예산을 두고 계속 다퉈요",
  "시댁에서 보험 하나 들라고 하시는데 남편은 아무 말도 안 해요",
  "집 매매 대출 이자 때문에 다투고 있어요",
];

/** 이 대화를 합의안으로 끌고 가면 안 되는 신호. */
const SAFETY = [
  "예식장 정하는 걸로 싸웠는데 제 폰을 매일 확인하고 카톡도 다 봐요",
  "헤어지자고 하면 가만 안 둔다고 해요",
  "제 월급을 다 가져가요",
  "가족을 못 만나게 해요",
];

/**
 * 신체 폭력 서술. 예전에는 이 여섯 문장이 전부 W1(평범한 결혼 대화)로 떨어졌다 —
 * 기존 어휘가 `폭력`·`폭행` 같은 명명어이거나 "상대방 명사 + 때렸/때릴" 조합을
 * 요구해서, 사람이 실제로 쓰는 서술형을 비켜갔기 때문이다.
 */
const PHYSICAL_VIOLENCE = [
  "화나면 물건을 던지고 저를 때린 적도 있어요",
  "손찌검을 한 적이 있어요",
  "저를 밀쳐서 넘어진 적 있어요",
  "한 번 때린 뒤로는 안 그런다고 하는데요",
  "화가 나면 때리려고 손을 들어요",
  "목을 조른 적도 있어요",
  "화나면 물건을 집어 던져요",
];

/**
 * 이 어휘를 **깨려고** 만든 문장. 처음 판은 `때린|주먹|밀쳐`를 낱말 그대로 넣었고,
 * 기존 오탐 코퍼스(강압 통제를 겨냥해 만든 것)에서 오탐 0이라 안전하다고 판단했다.
 * 여기 있는 문장을 만들자 10개 중 7개가 걸렸다. 겨냥하지 않은 코퍼스의 오탐 0은
 * 아무것도 증명하지 않는다.
 */
const AIMED_AT_VIOLENCE_WORDS = [
  "상견례 때 주먹밥 도시락 어때요?",
  "답례품으로 주먹밥 세트를 생각 중이에요",
  "지하철에서 사람이 많아서 밀쳐서 넘어졌어요",
  "하객이 몰려서 서로 밀치는 상황이 걱정돼요",
  "비가 창문을 때리는 소리에 잠을 못 잤어요",
  "부케를 던지는 순서를 언제로 할까요",
  "예산이 자꾸 늘어나서 머리를 한 대 맞은 것 같아요",
  "웨딩홀 상담에서 정신을 얻어맞은 기분이었어요",
  "주먹구구식으로 예산을 잡았더니 어긋나요",
  "가위바위보로 정하자니까 주먹만 내요",
  "케이크 커팅 때 서로 크림을 던지기도 하나요",
  "반죽을 주먹으로 치대는 쿠킹클래스도 있대요",
  "답례떡을 주먹으로 누르는 체험을 한대요",
  "목을 조르는 듯한 셔츠 칼라가 불편해요",
];

/** 평범한 결혼 갈등. 여기가 W2로 떨어지면 그 커플은 필요한 중재를 못 받는다. */
const ORDINARY = [
  "스드메 예산을 두고 서로 생각이 너무 달라요",
  "예식 날짜를 두고 양가 어른들 의견이 갈려요",
  "청첩장 돌리는 범위 때문에 다퉜어요",
  "축의금을 각자 부모님께 드릴지 합칠지 의견이 달라요",
  "상견례 장소를 어디로 할지 서로 양보를 안 해요",
  "하객 수를 줄이자는 얘기에 서운해하더라고요",
  "신혼집 위치를 두고 직장 거리 때문에 다퉈요",
  "결혼 준비 일정을 누가 더 맡을지로 자주 싸워요",
];

describe("고위험은 사유를 남긴다", () => {
  it("법률·의료·금융은 domain으로 갈린다", () => {
    for (const text of DOMAIN) {
      const result = scope(text);
      expect(result.scope, text).toBe("W2_high_risk_adjacent");
      expect(result.highRiskReason, text).toBe("domain");
    }
  });

  it("통제 신호는 safety로 갈린다", () => {
    for (const text of SAFETY) {
      const result = scope(text);
      expect(result.scope, text).toBe("W2_high_risk_adjacent");
      expect(result.highRiskReason, text).toBe("safety");
    }
  });

  it("신체 폭력 서술이 평범한 대화로 떨어지지 않는다", () => {
    for (const text of PHYSICAL_VIOLENCE) {
      const result = scope(text);

      // 위기 분류기(W5)가 먼저 잡는 문장도 있다. 그건 W2보다 강한 처리라 괜찮다.
      // 지켜야 하는 것은 **W1로 떨어지지 않는 것**이다 — W1이면 평범한 결혼 갈등과
      // 똑같이 4필드 합의안 카드가 만들어진다.
      expect(result.scope, text).not.toBe("W1_wedding_adjacent");
      expect(
        ["W2_high_risk_adjacent", "W5_safety_override"].includes(result.scope),
        text,
      ).toBe(true);
      if (result.scope === "W2_high_risk_adjacent") {
        expect(result.highRiskReason, text).toBe("safety");
      }
    }
  });

  it("평범한 결혼 갈등은 고위험으로 떨어지지 않는다", () => {
    // 어휘를 넓힐 때 여기가 먼저 무너진다. 오탐은 그 커플이 필요한 중재를 못 받게
    // 만들므로 그것도 실패다.
    for (const text of ORDINARY) {
      expect(scope(text).scope, text).toBe("W1_wedding_adjacent");
    }
  });

  it("폭력 어휘를 겨냥한 평범한 문장도 고위험으로 떨어지지 않는다", () => {
    // 이 묶음이 없으면 "때린|주먹|밀쳐"를 낱말 그대로 넣어도 통과한다. 실제로
    // 그렇게 통과시켰다가 주먹밥·주먹구구식·인파에 밀침이 전부 걸렸다.
    for (const text of AIMED_AT_VIOLENCE_WORDS) {
      expect(scope(text).scope, text).toBe("W1_wedding_adjacent");
    }
  });

  it("완곡한 폭력 서술은 여전히 못 잡는다 — 숫자로 남긴다", () => {
    // 이 함수는 낱말 검사다. 아래는 사람이 실제로 쓰지만 지금 못 잡는 표현이고,
    // 안전이 탐지에 걸려 있으면 안 되는 이유다. 우연히 잡히게 되면 이 테스트가
    // 실패하고, 그때 이 목록을 줄이면 된다.
    const stillMissed = [
      "화가 나면 주먹으로 벽을 쳐요",
      "손이 올라간 적이 있어요",
      "그날 이후로 무서워서 말을 못 꺼내요",
    ];
    for (const text of stillMissed) {
      expect(scope(text).scope, text).toBe("W1_wedding_adjacent");
    }
  });

  it("고위험이 아니면 사유를 붙이지 않는다", () => {
    expect(scope(ORDINARY[0]).highRiskReason).toBeUndefined();
  });

  it("둘 다 걸리면 안전이 이긴다", () => {
    // 안전 신호가 있는 대화를 "자격 있는 전문가에게 물어보세요"로 끝내면 안 된다.
    const both = "계약금 환불 얘기하다가 저를 때린 적도 있어요";
    expect(scope(both).highRiskReason).toBe("safety");
  });
});
