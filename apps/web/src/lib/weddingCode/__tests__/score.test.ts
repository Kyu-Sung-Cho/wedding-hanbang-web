import { describe, expect, it } from "vitest";
import {
  WEDDING_CODE_V05_PUBLIC_AXES,
  WEDDING_CODE_V05_QUESTIONS,
  type WeddingCodeV05AxisKey,
  type WeddingCodeV05AxisSide,
  type WeddingCodeV05OptionValue,
  type WeddingCodeV05QuestionKey,
} from "@/constants/weddingCodeV05";
import { scoreWeddingCodeV05, type WeddingCodeV05Answers } from "../score";

function answerForSide(
  question: (typeof WEDDING_CODE_V05_QUESTIONS)[number],
  side: WeddingCodeV05AxisSide
): WeddingCodeV05OptionValue {
  const option = question.options.find((candidate) => candidate.side === side);
  if (!option) throw new Error(`${question.key} has no ${side} option`);
  return option.value;
}

function completeAnswers(
  sideForQuestion: (question: (typeof WEDDING_CODE_V05_QUESTIONS)[number], axisIndex: number) => WeddingCodeV05AxisSide
): WeddingCodeV05Answers {
  const seenByAxis = new Map<WeddingCodeV05AxisKey, number>();
  return Object.fromEntries(
    WEDDING_CODE_V05_QUESTIONS.map((question) => {
      const axisIndex = seenByAxis.get(question.axis) ?? 0;
      seenByAxis.set(question.axis, axisIndex + 1);
      return [question.key, answerForSide(question, sideForQuestion(question, axisIndex))];
    })
  ) as WeddingCodeV05Answers;
}

describe("WeddingCode candidate.10 item contract", () => {
  it("16개 문항을 4축×4문항으로 배치하고 문항마다 같은 축의 두 시작점만 둔다", () => {
    expect(WEDDING_CODE_V05_QUESTIONS).toHaveLength(16);
    expect(new Set(WEDDING_CODE_V05_QUESTIONS.map((question) => question.key)).size).toBe(16);

    for (const axis of WEDDING_CODE_V05_PUBLIC_AXES) {
      expect(WEDDING_CODE_V05_QUESTIONS.filter((question) => question.axis === axis.key), axis.key).toHaveLength(4);
    }

    for (const question of WEDDING_CODE_V05_QUESTIONS) {
      expect(question.options, question.key).toHaveLength(2);
      expect(new Set(question.options.map((option) => option.value)), question.key).toEqual(new Set(["A", "B"]));
      expect(new Set(question.options.map((option) => option.side)), question.key).toEqual(new Set(["left", "right"]));
      expect(question.status).toBe("candidate_pending_human_validation");
      expect(question.evidenceRefs).toContain("TEST_DEVELOPMENT_METHOD");
      expect(question.evidenceRefs).toContain("PRODUCT_HYPOTHESIS");
      expect(question.evidenceRefs.length, question.key).toBeGreaterThanOrEqual(3);
    }
  });

  it("축마다 왼쪽/오른쪽 선택지를 각각 두 번씩 먼저 보여 위치 편향을 상쇄한다", () => {
    for (const axis of WEDDING_CODE_V05_PUBLIC_AXES) {
      const firstSides = WEDDING_CODE_V05_QUESTIONS
        .filter((question) => question.axis === axis.key)
        .map((question) => question.options[0].side);
      expect(firstSides.filter((side) => side === "left"), axis.key).toHaveLength(2);
      expect(firstSides.filter((side) => side === "right"), axis.key).toHaveLength(2);
    }
  });

  it("축을 A-A-A-A로 몰아 표시하지 않고 실제 흐름에서 교차 배치한다", () => {
    for (let index = 0; index < WEDDING_CODE_V05_QUESTIONS.length; index += 4) {
      expect(new Set(WEDDING_CODE_V05_QUESTIONS.slice(index, index + 4).map((question) => question.axis)).size).toBe(4);
    }
  });
});

describe("WeddingCode candidate.10 scoring", () => {
  it("한쪽을 4번 고르면 4:0, 반대쪽을 고르면 0:4로 투명하게 계산한다", () => {
    const allLeft = scoreWeddingCodeV05(completeAnswers(() => "left"));
    const allRight = scoreWeddingCodeV05(completeAnswers(() => "right"));

    for (const axis of allLeft.publicAxes) {
      expect(axis.leftCount).toBe(4);
      expect(axis.rightCount).toBe(0);
      expect(axis.leaning).toBe("left");
      expect(axis.responsePattern).toBe("consistent");
      expect(axis.leftScore).toBe(100);
      expect(axis.rightScore).toBe(0);
    }
    for (const axis of allRight.publicAxes) {
      expect(axis.leftCount).toBe(0);
      expect(axis.rightCount).toBe(4);
      expect(axis.leaning).toBe("right");
      expect(axis.responsePattern).toBe("consistent");
    }
  });

  it("2:2는 mixed, 3:1은 leaning으로만 기술하고 통계적 신뢰도처럼 부르지 않는다", () => {
    const mixed = scoreWeddingCodeV05(completeAnswers((_, axisIndex) => (axisIndex < 2 ? "left" : "right")));
    const leaning = scoreWeddingCodeV05(completeAnswers((_, axisIndex) => (axisIndex < 3 ? "left" : "right")));

    expect(mixed.publicAxes.every((axis) => axis.responsePattern === "mixed" && axis.leaning === "balanced")).toBe(true);
    expect(mixed.publicAxes.every((axis) => axis.displayKo.includes("장면에 따라"))).toBe(true);
    expect(leaning.publicAxes.every((axis) => axis.responsePattern === "leaning" && axis.leaning === "left")).toBe(true);
    expect(leaning.publicAxes.every((axis) => axis.displayKo.includes("4개 장면 중 3개"))).toBe(true);
    expect(JSON.stringify({ mixed, leaning })).not.toContain("confidence");
    expect(JSON.stringify({ mixed, leaning })).not.toContain("신뢰");
  });

  it("한 축의 네 문항이 끝나지 않으면 그 축을 외삽하지 않는다", () => {
    const first = WEDDING_CODE_V05_QUESTIONS[0];
    const result = scoreWeddingCodeV05({ [first.key]: answerForSide(first, "left") });

    expect(result.answeredCount).toBe(1);
    expect(result.publicAxes.every((axis) => axis.responsePattern === "insufficient_data")).toBe(true);
    expect(result.publicAxes.every((axis) => axis.leftScore === null && axis.rightScore === null)).toBe(true);
  });

  it("한 답을 뒤집으면 해당 문항의 축만 바뀌고 다른 세 축은 그대로다", () => {
    const baselineAnswers = completeAnswers((_, axisIndex) => (axisIndex < 2 ? "left" : "right"));
    const target = WEDDING_CODE_V05_QUESTIONS.find((question) => question.axis === "decisionCriteria")!;
    const changedAnswers: WeddingCodeV05Answers = {
      ...baselineAnswers,
      [target.key]: answerForSide(target, "right"),
    };
    const before = scoreWeddingCodeV05(baselineAnswers);
    const after = scoreWeddingCodeV05(changedAnswers);

    for (const axis of WEDDING_CODE_V05_PUBLIC_AXES) {
      const beforeAxis = before.publicAxes.find((candidate) => candidate.key === axis.key)!;
      const afterAxis = after.publicAxes.find((candidate) => candidate.key === axis.key)!;
      if (axis.key === "decisionCriteria") expect(afterAxis).not.toEqual(beforeAxis);
      else expect(afterAxis).toEqual(beforeAxis);
    }
  });

  it("항상 첫 번째 버튼만 누르면 네 축 모두 2:2가 되어 위치만으로 성향이 생기지 않는다", () => {
    const allFirst = Object.fromEntries(
      WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, question.options[0].value])
    ) as Record<WeddingCodeV05QuestionKey, WeddingCodeV05OptionValue>;
    const result = scoreWeddingCodeV05(allFirst);

    expect(result.publicAxes.every((axis) => axis.leftCount === 2 && axis.rightCount === 2)).toBe(true);
  });
});
