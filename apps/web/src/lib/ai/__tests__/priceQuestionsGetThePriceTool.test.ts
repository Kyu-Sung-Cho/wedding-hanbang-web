/**
 * 시세를 묻는 말에 시세 도구가 붙는다.
 *
 * `get_market_price`(한국소비자원 참가격)는 켜져 있는데, 운영 발화
 * `대관료는 보통 얼마야?` 에는 **붙지 않았다.** 범위는 W0 인데 도구 선택기의
 * `BUDGET_INTENT`·`VENDOR_INTENT` 어휘에 `대관료`·`식장`·`얼마` 가 없어서다.
 * 도구가 있는데 그 질문에서 한 번도 쓰이지 않는 자리였다.
 *
 * 이 목록은 **범위 판정이 아니라 도구 선택**이다. 범위 관문이 앞에서 이미
 * 결혼 대화인지 갈랐고, 여기서 틀리면 읽기 도구가 하나 더 붙을 뿐이다.
 * 그래서 `얼마` 처럼 일반적인 말도 넣을 수 있다 — 범위 어휘였다면 못 넣는다.
 *
 * ## 변형 검사 주의
 *
 * 낱말을 **하나씩** 지우면 이 테스트가 전부 통과한다 — 한 문장이 여러 낱말에
 * 걸리기 때문이다(`대관료는 보통 얼마야?` 는 `대관료` 와 `얼마` 둘 다에 걸린다).
 * 실제로 그렇게 재고 "가드가 안 잡힌다" 고 오해할 뻔했다. **추가한 넷을 한꺼번에**
 * 되돌리면 6건 중 5건이 실패한다.
 */
import { describe, expect, it } from "vitest";

import {
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
} from "@/lib/ai/amoraQuestionScope";
import { selectAmoraTools } from "@/lib/ai/amoraToolPolicy";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

/** 운영이 실제로 넘기는 집합. 쓰기 도구는 여기 오지 않는다. */
const AVAILABLE = BETA_SAFE_TOOLS.filter((tool) => !isMutatingTool(tool.name));

function hasPriceTool(userText: string): boolean {
  const classification = classifyAmoraQuestionScope({ userText });
  const selected = selectAmoraTools({
    availableTools: AVAILABLE, userText, specialistType: "general",
  } as never) as { name: string }[];
  return (filterAmoraToolsByQuestionScope(selected as never, classification) as { name: string }[])
    .some((tool) => tool.name === "get_market_price");
}

describe("대관료·시세 질문에 조회 도구가 붙는다", () => {
  it.each([
    "대관료는 보통 얼마야?",
    "대관료 얼마정도 해?",
    "대관료가 너무 비싼 것 같은데",
    "식장 빌리는 데 보통 얼마 들어?",
    "홀 대관료 평균이 궁금해",
    "대관료랑 식대 합치면 얼마야?",
  ])("%s", (userText) => {
    expect(hasPriceTool(userText)).toBe(true);
  });

  it("이미 붙던 말투는 그대로다", () => {
    // 대조군. 이 셋은 예전에도 붙었다 — 회귀가 아닌지 함께 본다.
    for (const userText of [
      "예식장 대관 비용 알려줘",
      "스튜디오 촬영 보통 얼마 해?",
      "드레스 대여 비용 평균 알려줘",
    ]) {
      expect(hasPriceTool(userText), userText).toBe(true);
    }
  });

  it("범위 밖 발화에는 붙지 않는다", () => {
    // 도구 선택 어휘를 넓혀도 범위 관문이 앞에서 막는다.
    for (const userText of [
      "노트북 얼마야?",
      "오늘 날씨 어때?",
      "주식 지금 얼마야?",
    ]) {
      expect(hasPriceTool(userText), userText).toBe(false);
    }
  });
});
