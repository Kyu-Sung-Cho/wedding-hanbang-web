// @vitest-environment node

/**
 * 되묻기 구제로 W0 이 된 턴에서 아모라가 **다른 분야의 과업을 대신 했다.**
 *
 * 2026-08-24 운영 실측: "파이썬으로 정렬 알고리즘 짜줘" 는 단독 판정이
 * `W4_out_of_scope`(confidence=low)인데, 그 조건이 곧 되묻기 답변 구제의 조건이라
 * 직전 결혼 턴의 범위로 올라갔다. 저장된 판정은 `W0_wedding_core` 였고 아모라는
 * **삽입 정렬 전체 구현**을 내놨다.
 *
 * 구제 관문의 주석은 이 상황을 "잘못 열려도 엉뚱한 답을 할 뿐" 이라고 봤는데,
 * 실측은 엉뚱한 답이 아니라 대행이었다.
 *
 * ## 왜 어휘를 넓히지 않았나
 *
 * `파이썬|자바스크립트|알고리즘` 을 범위 밖 목록에 더해봤다(2026-08-24). 그러자
 * "신랑이 파이썬 개발자라 결혼식에 회사 동료가 많이 와" 같은 **평범한 결혼 문장**
 * 7개가 차가운 거절을 받았다 — `amoraIdentityAndOffDomain.test.ts` 가 그 결정을
 * 이미 기록해 두고 있었고, 같은 실수를 반복한 것이다.
 *
 * 구제 조건 자체는 건드리지 않는다. 그 자리는 안전 축과 맞닿아 있다(폭력 서술
 * 뒤의 "응" 이 W0 을 받은 사고가 그 파일에 기록돼 있다). 대신 **구제된 턴에도
 * 대행 금지를 남긴다** — 도구·문맥은 열리되 결혼 밖 과업은 하지 않는다.
 */

import { describe, expect, it } from "vitest";

import {
  buildAmoraQuestionScopeInstruction,
  classifyAmoraQuestionScope,
} from "@/lib/ai/amoraQuestionScope";

const REFUSAL = "결혼 준비와 분명히 무관한 대행은 하지 마세요";

function instructionFor(input: Parameters<typeof classifyAmoraQuestionScope>[0]) {
  return buildAmoraQuestionScopeInstruction(classifyAmoraQuestionScope(input));
}

describe("되묻기 구제로 올라온 턴에도 대행 금지가 남는다", () => {
  it.each([
    "파이썬으로 정렬 알고리즘 짜줘",
    "자바스크립트로 정렬 함수 만들어줘",
    "영어 이메일 좀 써줘",
    "내일 서울 날씨 어때?",
  ])("%s", (userText) => {
    const rescued = classifyAmoraQuestionScope({
      userText,
      hasWeddingClarificationContinuity: true,
    });
    // 구제 자체는 그대로 — 도구와 문맥은 열린다.
    expect(rescued.scope).toBe("W0_wedding_core");
    expect(rescued.rescuedByClarificationAnswer).toBe(true);
    // 그러나 대행은 하지 않는다.
    expect(buildAmoraQuestionScopeInstruction(rescued)).toContain(REFUSAL);
  });

  it("확인 카드를 눌러 올라온 턴에는 붙이지 않는다", () => {
    // 사용자가 직접 확인한 실행이라 사정이 다르다.
    const approved = classifyAmoraQuestionScope({
      userText: "응 그렇게 해줘",
      hasApprovedWeddingAction: true,
    });
    expect(approved.scope).toBe("W0_wedding_core");
    expect(approved.rescuedByClarificationAnswer).toBe(false);
    expect(buildAmoraQuestionScopeInstruction(approved)).not.toContain(REFUSAL);
  });

  it("평범한 결혼 질문에는 붙지 않는다", () => {
    for (const userText of [
      "총예산 5천만원으로 바꿔줘",
      "드레스 투어 일정 추가해줘",
      "신랑이 파이썬 개발자라 결혼식에 회사 동료가 많이 와",
    ]) {
      expect(instructionFor({ userText })).not.toContain(REFUSAL);
    }
  });

  it("모호 갈래는 예전대로 대행을 막는다", () => {
    expect(instructionFor({ userText: "파이썬으로 피보나치 짜줘" })).toContain(REFUSAL);
  });
});
