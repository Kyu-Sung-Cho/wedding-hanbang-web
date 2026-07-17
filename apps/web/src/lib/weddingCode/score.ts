// CANDIDATE4_RETIRED: containment-only legacy; never import from Candidate 5 research code.
import {
  WEDDING_CODE_V05_EXPOSURE_MAX,
  WEDDING_CODE_V05_NON_PUBLIC_CONSTRUCTS,
  WEDDING_CODE_V05_PUBLIC_AXES,
  WEDDING_CODE_V05_QUESTIONS,
  type WeddingCodeV05OptionValue,
  type WeddingCodeV05QuestionKey,
} from "@/constants/weddingCodeV05";
import { WEDDING_CODE_CONSTRUCT_KEYS, type WeddingCodeConstructKey } from "@/lib/wedding-code/types";

export type WeddingCodeV05Answers = Partial<Record<WeddingCodeV05QuestionKey, WeddingCodeV05OptionValue>>;

export type WeddingCodeV05ConstructScore = {
  raw: number;
  exposureMax: number;
  normalized: number | null;
};

export type WeddingCodeV05AxisScore = {
  key: (typeof WEDDING_CODE_V05_PUBLIC_AXES)[number]["key"];
  labelKo: string;
  leftLabelKo: string;
  rightLabelKo: string;
  leftScore: number | null;
  rightScore: number | null;
  differencePp: number | null;
  leaning: "balanced" | "left" | "right" | "insufficient_data";
  confidenceBand: "balanced" | "slightly_close" | "close" | "insufficient_data";
  displayKo: string;
};

export type WeddingCodeV05ScoreResult = {
  answeredCount: number;
  constructScores: Record<WeddingCodeConstructKey, WeddingCodeV05ConstructScore>;
  publicAxes: WeddingCodeV05AxisScore[];
  internalOnly: {
    decisionPaceRisk: WeddingCodeV05ConstructScore;
    guidanceNeed: WeddingCodeV05ConstructScore;
  };
  warnings: string[];
};

const EMPTY_CONSTRUCT_SCORE = { raw: 0, exposureMax: 0, normalized: null } as const;

export function scoreWeddingCodeV05(answers: WeddingCodeV05Answers): WeddingCodeV05ScoreResult {
  const raw = initConstructNumberMap();
  const exposure = initConstructNumberMap();
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
    for (const [construct, max] of Object.entries(questionExposureMax(question))) {
      exposure[construct as WeddingCodeConstructKey] += max;
    }
    for (const weight of option.weights) {
      raw[weight.construct] += weight.value;
    }
  }

  const constructScores = initConstructScoreMap();
  for (const key of WEDDING_CODE_CONSTRUCT_KEYS) {
    const exposureMax = exposure[key];
    constructScores[key] = {
      raw: raw[key],
      exposureMax,
      normalized: exposureMax > 0 ? roundScore((raw[key] / exposureMax) * 100) : null,
    };
  }

  return {
    answeredCount,
    constructScores,
    publicAxes: WEDDING_CODE_V05_PUBLIC_AXES.map((axis) => {
      const leftScore = sideScore(axis.left.constructs, constructScores);
      const rightScore = sideScore(axis.right.constructs, constructScores);
      return axisScore({
        key: axis.key,
        labelKo: axis.labelKo,
        leftLabelKo: axis.left.labelKo,
        rightLabelKo: axis.right.labelKo,
        leftScore,
        rightScore,
      });
    }),
    internalOnly: {
      decisionPaceRisk: constructScores.decisionPaceRisk,
      guidanceNeed: constructScores.guidanceNeed,
    },
    warnings,
  };
}

export function computeWeddingCodeV05GlobalExposureMax(): Record<WeddingCodeConstructKey, number> {
  const exposure = initConstructNumberMap();
  for (const question of WEDDING_CODE_V05_QUESTIONS) {
    for (const [construct, max] of Object.entries(questionExposureMax(question))) {
      exposure[construct as WeddingCodeConstructKey] += max;
    }
  }
  return exposure;
}

export function publicAxisUsesInternalOnlyConstructs(): boolean {
  const internalOnly = new Set<WeddingCodeConstructKey>(WEDDING_CODE_V05_NON_PUBLIC_CONSTRUCTS);
  return WEDDING_CODE_V05_PUBLIC_AXES.some((axis) =>
    [...axis.left.constructs, ...axis.right.constructs].some((construct) => internalOnly.has(construct))
  );
}

function initConstructNumberMap(): Record<WeddingCodeConstructKey, number> {
  return Object.fromEntries(WEDDING_CODE_CONSTRUCT_KEYS.map((key) => [key, 0])) as Record<
    WeddingCodeConstructKey,
    number
  >;
}

function initConstructScoreMap(): Record<WeddingCodeConstructKey, WeddingCodeV05ConstructScore> {
  return Object.fromEntries(WEDDING_CODE_CONSTRUCT_KEYS.map((key) => [key, { ...EMPTY_CONSTRUCT_SCORE }])) as Record<
    WeddingCodeConstructKey,
    WeddingCodeV05ConstructScore
  >;
}

function questionExposureMax(
  question: (typeof WEDDING_CODE_V05_QUESTIONS)[number]
): Partial<Record<WeddingCodeConstructKey, number>> {
  const maxByConstruct: Partial<Record<WeddingCodeConstructKey, number>> = {};
  for (const option of question.options) {
    const optionTotals: Partial<Record<WeddingCodeConstructKey, number>> = {};
    for (const weight of option.weights) {
      optionTotals[weight.construct] = (optionTotals[weight.construct] ?? 0) + weight.value;
    }
    for (const [construct, value] of Object.entries(optionTotals)) {
      const key = construct as WeddingCodeConstructKey;
      maxByConstruct[key] = Math.max(maxByConstruct[key] ?? 0, value);
    }
  }
  return maxByConstruct;
}

function sideScore(
  constructs: readonly WeddingCodeConstructKey[],
  scores: Record<WeddingCodeConstructKey, WeddingCodeV05ConstructScore>
): number | null {
  const values = constructs
    .map((construct) => scores[construct].normalized)
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return roundScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function axisScore(input: {
  key: WeddingCodeV05AxisScore["key"];
  labelKo: string;
  leftLabelKo: string;
  rightLabelKo: string;
  leftScore: number | null;
  rightScore: number | null;
}): WeddingCodeV05AxisScore {
  const { key, labelKo, leftLabelKo, rightLabelKo, leftScore, rightScore } = input;
  if (leftScore === null || rightScore === null) {
    return {
      key,
      labelKo,
      leftLabelKo,
      rightLabelKo,
      leftScore,
      rightScore,
      differencePp: null,
      leaning: "insufficient_data",
      confidenceBand: "insufficient_data",
      displayKo: "아직 결과를 말하기엔 응답이 부족해요.",
    };
  }

  const differencePp = roundScore(Math.abs(leftScore - rightScore));
  const confidenceBand =
    differencePp <= 12 ? "balanced" : differencePp <= 24 ? "slightly_close" : "close";
  const leaning = confidenceBand === "balanced" ? "balanced" : leftScore > rightScore ? "left" : "right";
  const displayKo =
    leaning === "balanced"
      ? `${labelKo}에서는 두 기준을 같이 보는 편이에요.`
      : `${labelKo}에서는 ${leaning === "left" ? leftLabelKo : rightLabelKo} 쪽에 ${
          confidenceBand === "close" ? "가까워요" : "조금 가까워요"
        }.`;

  return {
    key,
    labelKo,
    leftLabelKo,
    rightLabelKo,
    leftScore,
    rightScore,
    differencePp,
    leaning,
    confidenceBand,
    displayKo,
  };
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

export function assertWeddingCodeV05ExposureMaxMatchesDraft(): boolean {
  const computed = computeWeddingCodeV05GlobalExposureMax();
  return WEDDING_CODE_CONSTRUCT_KEYS.every((key) => computed[key] === WEDDING_CODE_V05_EXPOSURE_MAX[key]);
}
