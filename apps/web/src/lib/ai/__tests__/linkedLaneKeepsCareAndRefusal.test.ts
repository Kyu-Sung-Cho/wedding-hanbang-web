/**
 * 연결 문맥 레인도 위로와 대행 금지를 그대로 준다.
 *
 * `amoraBoundedContinuity` 의 단서 요구를 없애면서 이 레인이 받는 발화가 넓어졌다.
 * 적대적 검토가 두 부류를 재현했다.
 *
 *     "쉼터가 어디에 있나요" · "도망가고 싶어요" · "그 사람이 무서워요"
 *         -> 안전 인접 발화 19개 중 17개가 "예식장 대화 안에서만 답하고 넓히지
 *            마세요" 를 받았다. 위로 우선 줄이 이 레인에 **없었다.**
 *
 *     "파이썬으로 피보나치 짜줘"
 *         -> 결혼 밖 대행 금지 줄도 이 레인에 **없었다.** 2026-08-24 운영에서
 *            삽입 정렬 전체 구현이 나갔던 그 결함의 재발 조건이다.
 *
 * 두 줄을 넣었고, 위로 줄이 범위 제한보다 우선한다고 문구에 적었다.
 */
import { describe, expect, it } from "vitest";

import { buildAmoraQuestionScopeInstruction } from "@/lib/ai/amoraQuestionScope";

const W4_LOW = {
  scope: "W4_out_of_scope",
  allowsLongTermMemory: false,
  confidence: "low",
  needsClarification: true,
} as const;

const linked = buildAmoraQuestionScopeInstruction(W4_LOW, { linkedContextOnly: true });
const plain = buildAmoraQuestionScopeInstruction(W4_LOW, {});

describe("연결 레인이 위로를 잃지 않는다", () => {
  it("감정·안전이 담긴 말은 먼저 알아주라고 한다", () => {
    expect(linked).toContain("감정·안전·곤란함이 담긴 말이면");
  });

  it("그 원칙이 범위 제한보다 우선한다고 분명히 적는다", () => {
    // 이 단서가 없으면 "넓히지 마세요" 가 위로를 이긴다.
    expect(linked).toContain("위의 범위 제한보다 우선합니다");
  });

  it("관련성 증명을 요구하지 말라고 한다", () => {
    expect(linked).toContain("결혼 준비와의 관련성을 증명하라고 요구하지 마세요");
  });
});

describe("연결 레인이 대행 금지를 잃지 않는다", () => {
  it("결혼 밖 대행 금지 줄이 실린다", () => {
    // 평범한 W4 레인이 갖고 있는 바로 그 줄이어야 한다.
    const refusal = plain.split(String.fromCharCode(10))
      .find((line) => line.includes("대행"));
    expect(refusal, "평범한 W4 레인에 대행 금지 줄이 없다").toBeTruthy();
    expect(linked).toContain(refusal as string);
  });
});

describe("연결 레인이 열지 않는 것", () => {
  it("도구·저장·기억은 그대로 닫혀 있다", () => {
    expect(linked).toContain("도구 실행·상태 변경·변경 제안·장기 기억 저장은 하지 마세요");
    expect(linked).toContain("동의 표현도 실행 확인으로 취급하지 마세요");
  });

  it("결혼 밖 새 주제로는 넓히지 않는다", () => {
    expect(linked).toContain("결혼 준비와 무관한 새 주제로 넓히지는 마세요");
  });
});
