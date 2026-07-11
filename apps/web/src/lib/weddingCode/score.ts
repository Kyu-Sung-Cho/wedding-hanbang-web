import {
  WEDDING_CODE_V05_PUBLIC_AXES,
  WEDDING_CODE_V05_QUESTIONS,
  type WeddingCodeV05AxisKey,
  type WeddingCodeV05OptionValue,
  type WeddingCodeV05QuestionKey,
} from "@/constants/weddingCodeV05";

export type WeddingCodeV05Answers = Partial<Record<WeddingCodeV05QuestionKey, WeddingCodeV05OptionValue>>;

export type WeddingCodeV05AxisScore = {
  key: WeddingCodeV05AxisKey;
  labelKo: string;
  leftLabelKo: string;
  rightLabelKo: string;
  answeredItems: number;
  expectedItems: number;
  leftCount: number;
  rightCount: number;
  leftScore: number | null;
  rightScore: number | null;
  differencePp: number | null;
  leaning: "balanced" | "left" | "right" | "insufficient_data";
  responsePattern: "mixed" | "leaning" | "consistent" | "insufficient_data";
  displayKo: string;
};

export type WeddingCodeV05ScoreResult = {
  answeredCount: number;
  publicAxes: WeddingCodeV05AxisScore[];
  warnings: string[];
};

type AxisCounts = {
  answered: number;
  left: number;
  right: number;
};

export function scoreWeddingCodeV05(answers: WeddingCodeV05Answers): WeddingCodeV05ScoreResult {
  const counts = initAxisCounts();
  const warnings: string[] = [];
  let answeredCount = 0;

  for (const question of WEDDING_CODE_V05_QUESTIONS) {
    const answer = answers[question.key];
    if (!answer) continue;
    const option = question.options.find((candidate) => candidate.value === answer);
    if (!option) {
      warnings.push(`Invalid answer ignored: ${question.key}=${answer}`);
      continue;
    }

    answeredCount += 1;
    counts[question.axis].answered += 1;
    counts[question.axis][option.side] += 1;
  }

  return {
    answeredCount,
    publicAxes: WEDDING_CODE_V05_PUBLIC_AXES.map((axis) =>
      buildAxisScore({
        key: axis.key,
        labelKo: axis.labelKo,
        leftLabelKo: axis.left.labelKo,
        rightLabelKo: axis.right.labelKo,
        counts: counts[axis.key],
        expectedItems: WEDDING_CODE_V05_QUESTIONS.filter((question) => question.axis === axis.key).length,
      })
    ),
    warnings,
  };
}

function initAxisCounts(): Record<WeddingCodeV05AxisKey, AxisCounts> {
  return Object.fromEntries(
    WEDDING_CODE_V05_PUBLIC_AXES.map((axis) => [
      axis.key,
      { answered: 0, left: 0, right: 0 } satisfies AxisCounts,
    ])
  ) as Record<WeddingCodeV05AxisKey, AxisCounts>;
}

function buildAxisScore(input: {
  key: WeddingCodeV05AxisKey;
  labelKo: string;
  leftLabelKo: string;
  rightLabelKo: string;
  counts: AxisCounts;
  expectedItems: number;
}): WeddingCodeV05AxisScore {
  const { key, labelKo, leftLabelKo, rightLabelKo, counts, expectedItems } = input;
  const base = {
    key,
    labelKo,
    leftLabelKo,
    rightLabelKo,
    answeredItems: counts.answered,
    expectedItems,
    leftCount: counts.left,
    rightCount: counts.right,
  };

  // Result language is calibrated to the complete four-scenario pattern. A
  // partial pattern is intentionally not extrapolated into a preference.
  if (counts.answered !== expectedItems || expectedItems === 0) {
    return {
      ...base,
      leftScore: null,
      rightScore: null,
      differencePp: null,
      leaning: "insufficient_data",
      responsePattern: "insufficient_data",
      displayKo: `${labelKo}은 ${expectedItems}개 장면에 모두 답한 뒤 보여드려요.`,
    };
  }

  const leftScore = roundScore((counts.left / expectedItems) * 100);
  const rightScore = roundScore((counts.right / expectedItems) * 100);
  const differencePp = Math.abs(leftScore - rightScore);
  const leaning = counts.left === counts.right ? "balanced" : counts.left > counts.right ? "left" : "right";
  const responsePattern =
    counts.left === counts.right ? "mixed" : Math.min(counts.left, counts.right) === 0 ? "consistent" : "leaning";

  let displayKo: string;
  if (leaning === "balanced") {
    displayKo = `${expectedItems}개 장면: ${leftLabelKo} ${counts.left}개 · ${rightLabelKo} ${counts.right}개로 나뉘었어요. 장면에 따라 먼저 고른 쪽이 달랐어요.`;
  } else {
    const selectedLabel = leaning === "left" ? leftLabelKo : rightLabelKo;
    const selectedCount = Math.max(counts.left, counts.right);
    displayKo = `${expectedItems}개 장면 중 ${selectedCount}개가 '${selectedLabel}'였어요.`;
  }

  return {
    ...base,
    leftScore,
    rightScore,
    differencePp,
    leaning,
    responsePattern,
    displayKo,
  };
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}
