import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V20_AXES, WEDDING_CODE_V20_LIKERT_OPTIONS, WEDDING_CODE_V20_QUESTIONS } from "@/constants/weddingCodeV20";
import {
  answeredCountV20,
  buildWeddingCodeV20Profile,
  compareWeddingCodeV20Answers,
  decodeWeddingCodeV20,
  encodeWeddingCodeV20,
  getWeddingCodeV20FollowUp,
  WEDDING_CODE_V20_COMPARISON_NOTE,
} from "@/lib/weddingCode/v20";

describe("웨딩코드 v2.0 문장 응답", () => {
  it("문항은 네 주제를 각각 네 문장으로 나누고, 문장을 중복하지 않는다", () => {
    expect(WEDDING_CODE_V20_QUESTIONS).toHaveLength(16);
    expect(new Set(WEDDING_CODE_V20_QUESTIONS.map((question) => question.id)).size).toBe(16);
    expect(new Set(WEDDING_CODE_V20_QUESTIONS.map((question) => question.statement)).size).toBe(16);
    for (const axis of WEDDING_CODE_V20_AXES) {
      expect(WEDDING_CODE_V20_QUESTIONS.filter((question) => question.axis === axis.key)).toHaveLength(4);
    }
    expect(WEDDING_CODE_V20_LIKERT_OPTIONS.map((option) => option.label)).toEqual([
      "전혀 그렇지 않아요",
      "그렇지 않은 편이에요",
      "어느 쪽도 아니에요",
      "그런 편이에요",
      "매우 그래요",
    ]);
  });

  it("1~5 응답과 건너뛴 문장을 고정 길이 링크에서 그대로 왕복한다", () => {
    const answers = Object.fromEntries(WEDDING_CODE_V20_QUESTIONS.map((question, index) => [question.id, ((index % 5) + 1)]));
    const code = encodeWeddingCodeV20(answers);
    expect(code).toHaveLength(16);
    expect(decodeWeddingCodeV20(code)).toEqual(answers);

    const partial = { C1: 1 as const, C2: 3 as const, C3: 5 as const };
    const partialCode = encodeWeddingCodeV20(partial);
    expect(partialCode).toBe("1---3---5-------");
    expect(decodeWeddingCodeV20(partialCode)).toEqual(partial);
    expect(answeredCountV20(partial)).toBe(3);
  });

  it("잘못된 길이·문자·전부 건너뛴 링크를 거절한다", () => {
    expect(decodeWeddingCodeV20("1".repeat(15))).toBeNull();
    expect(decodeWeddingCodeV20("0".repeat(16))).toBeNull();
    expect(decodeWeddingCodeV20("-".repeat(16))).toBeNull();
  });

  it("응답마다 프롬프트·전체 문장·사람 말투 해석·다음 질문을 보존한다", () => {
    const profile = buildWeddingCodeV20Profile({ C1: 1, C2: 3, C3: 5, C4: 2 });
    const criteria = profile.readings.find((reading) => reading.axis === "criteria")!;
    expect(criteria.responses.map((response) => response.rating)).toEqual([1, 3, 5, 2]);
    expect(criteria.responses[0]).toMatchObject({
      id: "C1",
      prompt: "견적을 받으면",
      statement: "전체 비용이 얼마인지 먼저 확인하는 편이다.",
      fullText: "견적을 받으면 전체 비용이 얼마인지 먼저 확인하는 편이다.",
      ratingLabel: "전혀 그렇지 않아요",
      interpretation: "이 문장에는 가까운 편이 아니라고 답했어요.",
    });
    expect(criteria.responses.find((response) => response.id === "C4")?.statement).toBe("정해둔 예산을 넘겨도 괜찮다고 생각하는 편이다.");
    expect(criteria.responses.every((response) => response.followUp.length > 10)).toBe(true);
    expect(criteria.nextQuestion).toBe(criteria.responses[0].followUp);
    expect(criteria.summary).toContain("이 문장에는 가까운 편이 아니라고 답했어요.");
    expect(criteria.summary).toContain("예식 분위기가 마음에 드는지 먼저 본다고 답했어요.");
    expect(criteria.state).toBe("clear");
  });

  it("3점·모두 1점·모두 5점·혼합·일부 건너뛰기를 점수 합산 없이 구분한다", () => {
    const allMiddle = buildWeddingCodeV20Profile({ C1: 3, C2: 3, C3: 3, C4: 3 }).readings.find((reading) => reading.axis === "criteria")!;
    expect(allMiddle.state).toBe("mixed");
    expect(allMiddle.summary).toContain("중간으로 답했어요");

    const allLow = buildWeddingCodeV20Profile({ C1: 1, C2: 1, C3: 1, C4: 1 }).readings.find((reading) => reading.axis === "criteria")!;
    expect(allLow.state).toBe("clear");
    expect(allLow.summary).not.toContain("반대");
    expect(allLow.summary).toContain("이 문장에는 가까운 편이 아니라고 답했어요.");

    const allHigh = buildWeddingCodeV20Profile({ C1: 5, C2: 5, C3: 5, C4: 5 }).readings.find((reading) => reading.axis === "criteria")!;
    expect(allHigh.summary).toContain("전체 비용부터 확인하는 편이라고 답했어요.");

    const partial = buildWeddingCodeV20Profile({ C1: 5, C2: 2 }).readings.find((reading) => reading.axis === "criteria")!;
    expect(partial.answered).toBe(2);
    expect(partial.summary).toContain("건너뛴 2문장은 정리에 넣지 않았어요.");
    expect(buildWeddingCodeV20Profile({}).readings.find((reading) => reading.axis === "criteria")?.state).toBe("unanswered");
  });

  it("주제별로 독립된 미응답 안내와 문항별 후속 질문을 제공한다", () => {
    const profile = buildWeddingCodeV20Profile({ H1: 5 });
    const support = profile.readings.find((reading) => reading.axis === "support")!;
    expect(support.nextQuestion).toBe(getWeddingCodeV20FollowUp("H1"));
    expect(support.responses[0].fullText).toContain("힘들 때");
    const family = profile.readings.find((reading) => reading.axis === "family")!;
    expect(family.nextQuestion).toContain("부모님");
    expect(family.summary).toContain("모두 건너뛰었어요");
  });

  it("커플 비교는 비슷함·다름·한 사람만 답함·둘 다 건너뜀을 구분하고 전체 문장을 보존한다", () => {
    const result = compareWeddingCodeV20Answers({ C1: 4, C2: 2, C3: 5 }, { C1: 5, C2: 5 });
    expect(result.find((item) => item.question.id === "C1")).toMatchObject({ state: "same", stateLabel: "비슷하게 답했어요.", fullText: "견적을 받으면 전체 비용이 얼마인지 먼저 확인하는 편이다." });
    expect(result.find((item) => item.question.id === "C2")?.state).toBe("different");
    expect(result.find((item) => item.question.id === "C3")?.state).toBe("missing");
    expect(result.find((item) => item.question.id === "C4")?.state).toBe("bothSkipped");
    expect(result.find((item) => item.question.id === "C4")?.stateLabel).toContain("둘 다");
    expect(result.find((item) => item.question.id === "C2")?.followUp).toContain("취소");
    expect(WEDDING_CODE_V20_COMPARISON_NOTE).toContain("관계나 갈등");
  });
});



