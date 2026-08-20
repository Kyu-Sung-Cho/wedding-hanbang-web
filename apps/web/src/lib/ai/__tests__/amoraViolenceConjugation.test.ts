import { describe, expect, it } from "vitest";
import {
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
  hasAmoraSafetySignal,
} from "@/lib/ai/amoraQuestionScope";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

/**
 * 폭력 어휘 목록에 어간은 있는데 **어형 하나씩이** 빠져 있었다.
 * `밀쳤`(밀쳐·밀치·밀었은 있음), `던져`·`던졌`(던지는 있음).
 *
 * 이 파일은 그 어형들을 **겨냥해서** 만든 코퍼스다. 이 저장소가 같은 자리에서
 * 두 번 배운 것이 "겨냥하지 않은 코퍼스의 오탐 0은 아무것도 증명하지 않는다"라,
 * 탐지만 세지 않고 같은 어형을 깨뜨리려고 만든 평범한 문장도 함께 둔다.
 */

describe("빠져 있던 어형이 안전 판정에 걸린다", () => {
  it.each([
    "남편이 저를 밀쳤어요",
    "화가 나면 저를 밀쳤어요",
    "어제 다투다가 남편이 저를 밀쳤어요",
    "예식장 얘기하다 저를 밀쳤어요",
    "남편이 물건을 던져요",
    "화나면 물건을 던졌어요",
    "싸울 때 물건을 던져서 무서워요",
  ])("%s", (userText) => {
    const classification = classifyAmoraQuestionScope({ userText });
    expect(classification.scope).toBe("W2_high_risk_adjacent");
    expect(classification.highRiskReason).toBe("safety");
    expect(classification.allowsLongTermMemory).toBe(false);
    expect(filterAmoraToolsByQuestionScope(BETA_SAFE_TOOLS, classification))
      .toEqual([]);
    expect(hasAmoraSafetySignal(userText)).toBe(true);
  });

  // 이것이 가장 비싼 형태였다. 안전 판정이 먼저 도는데 거기서 안 걸리면 그대로
  // 아래로 흘러 웨딩 낱말에 잡히고, W0은 **장기 기억이 켜져 있다** —
  // 신체 폭력 서술이 커플이 함께 보는 기록으로 남는다.
  it.each([
    "예식장 계약했는데 남편이 저를 밀쳤어요",
    "스드메 예산 300만원인데 남편이 화나면 물건을 던져요",
    "청첩장 돌리는 중인데 남편이 물건을 던졌어요",
  ])("웨딩 낱말이 섞여도 공유 기억으로 새지 않는다: %s", (userText) => {
    const classification = classifyAmoraQuestionScope({ userText });
    expect(classification.scope).toBe("W2_high_risk_adjacent");
    expect(classification.allowsLongTermMemory).toBe(false);
  });
});

describe("이미 배포돼 있던 어형은 그대로다", () => {
  it.each([
    "남편이 저를 밀었어요",
    "남편이 저를 밀쳐요",
    "남편이 저를 때렸어요",
    "화나면 물건을 던지고 나가요",
  ])("%s", (userText) => {
    expect(classifyAmoraQuestionScope({ userText }).scope)
      .toBe("W2_high_risk_adjacent");
  });
});

describe("이 어형을 깨뜨리려고 만든 평범한 문장", () => {
  // 이 문장들은 걸린다. 새로 생긴 오탐이 아니라 **이미 있던 노출**이다 —
  // 같은 문장을 `밀었`·`밀쳐`·`던지`로 쓰면 이 변경 전에도 전부 W2였다.
  // 틀이 대상(`저를`)만 묶고 행위자를 묶지 않는 것이 진짜 결함이고, 그건
  // 어휘가 아니라 설계 문제라 여기서 고치지 않았다. 사실로 남겨 둔다.
  it.each([
    ["지하철이 붐벼서 뒷사람이 저를 밀쳤어요", "지하철이 붐벼서 뒷사람이 저를 밀었어요"],
    ["웨딩홀 앞이 좁아 하객들이 저를 밀쳤어요", "웨딩홀 앞이 좁아 하객들이 저를 밀었어요"],
    ["포토부스 줄에서 아이가 저를 밀쳤어요", "포토부스 줄에서 아이가 저를 밀었어요"],
  ])(
    "새 어형과 기존 어형이 같은 판정을 받는다(노출은 이전부터 있었다): %s",
    (newForm, shippedForm) => {
      const withNewForm = classifyAmoraQuestionScope({ userText: newForm }).scope;
      const withShippedForm =
        classifyAmoraQuestionScope({ userText: shippedForm }).scope;
      expect(withShippedForm).toBe("W2_high_risk_adjacent");
      expect(withNewForm).toBe(withShippedForm);
    },
  );

  // `던져`는 -어 연결형이라 보조용언과 붙어 합성동사가 된다(던져놓다=아무렇게나
  // 두다). 그 합성형은 `던지` 철자를 갖지 않아 예전에는 걸릴 수 없었으므로,
  // 조건 없이 넣으면 **새 오탐 종류**가 생긴다. 중재에서는 문턱이 더 낮아
  // 상대 전송이 막히고 "폭력·위협·통제" 문구와 112·119가 나간다 —
  // 정리정돈 불만에 그 답을 보내면 안 된다.
  it.each([
    "남편이 퇴근하면 물건을 던져놓기만 하고 정리를 안 해요",
    "택배 기사님이 물건을 던져놓고 가셨어요",
    "신랑이 물건을 던져두고 치우질 않아요",
    "이사할 때 물건을 던져 놓지 말고 하나씩 옮기자",
    "짐 정리하면서 안 쓰는 물건을 던져 버렸어요",
    "위층에서 물건을 던져주면 제가 받을게요",
    "신혼집에 물건을 던져놨더니 발 디딜 곳이 없어요",
  ])("보조용언이 붙은 합성동사는 안전 신호가 아니다: %s", (userText) => {
    expect(hasAmoraSafetySignal(userText), userText).toBe(false);
    // 중재는 문턱이 더 낮다. 여기서도 막히면 안 된다.
    expect(hasAmoraSafetySignal(userText, "mediation"), userText).toBe(false);
  });

  it.each([
    "화나면 물건을 던져요",
    "싸울 때 물건을 던져서 무서워요",
    "화가 나면 물건을 던져 대요",
  ])("보조용언이 없으면 그대로 안전 신호다: %s", (userText) => {
    expect(hasAmoraSafetySignal(userText), userText).toBe(true);
  });

  // 반대쪽 경계: `물건`이 없으면 던지는 이야기가 안전 신호가 되지 않는다.
  it.each([
    "부케를 던졌어요",
    "부케를 던져도 되나요",
    "꽃잎을 던져 주세요",
    "하객들이 쌀을 던져요",
  ])("`물건`이 없으면 걸리지 않는다: %s", (userText) => {
    expect(hasAmoraSafetySignal(userText)).toBe(false);
  });
});
