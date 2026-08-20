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
