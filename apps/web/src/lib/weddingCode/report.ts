import type { WeddingCodeV05AxisScore, WeddingCodeV05ScoreResult } from "./score";

export type WeddingCodeV05AxisReport = {
  key: WeddingCodeV05AxisScore["key"];
  labelKo: string;
  summaryKo: string;
  leftScore: number | null;
  rightScore: number | null;
  confidenceBand: WeddingCodeV05AxisScore["confidenceBand"];
};

export type WeddingCodeV05ActionCard = {
  id: "contract_check" | "quote_guidance" | "one_topic_talk" | "criteria_sync";
  titleKo: string;
  bodyKo: string;
};

export type WeddingCodeV05IndividualReport = {
  titleKo: string;
  subtitleKo: string;
  axisReports: WeddingCodeV05AxisReport[];
  talkStarters: string[];
  actionCards: WeddingCodeV05ActionCard[];
  disclaimerKo: string;
};

export type WeddingCodeV05CoupleAxisOverlap = {
  key: WeddingCodeV05AxisScore["key"];
  labelKo: string;
  overlapScore: number;
  label: "high" | "medium" | "low";
  summaryKo: string;
};

export type WeddingCodeV05CoupleReport = {
  titleKo: string;
  overlapScore: number | null;
  overlapLabelKo: string;
  easyPoints: WeddingCodeV05CoupleAxisOverlap[];
  talkFirst: WeddingCodeV05CoupleAxisOverlap | null;
  guideKo: string;
  disclaimerKo: string;
};

const INDIVIDUAL_DISCLAIMER =
  "이 결과는 심리 진단이나 결혼 예측이 아니라, 현재 답변을 바탕으로 결혼 준비 대화를 시작하기 쉽게 정리한 참고 자료예요.";

const COUPLE_DISCLAIMER =
  "두 사람의 점수 차이는 좋고 나쁨이나 결혼 결과를 예측하지 않고, 결혼 준비에서 먼저 맞춰볼 대화 순서를 찾기 위한 참고예요.";

export function buildWeddingCodeV05IndividualReport(
  score: WeddingCodeV05ScoreResult
): WeddingCodeV05IndividualReport {
  const axisReports = score.publicAxes.map(axisToReport);
  const talkStarters = buildTalkStarters(score.publicAxes);
  const actionCards = buildActionCards(score);

  return {
    titleKo: "현재 답변으로 본 결혼 준비 방식",
    subtitleKo: `${score.answeredCount}개 선택을 기준으로, 강하게 단정하지 않고 대화에 쓸 수 있는 지점만 정리했어요.`,
    axisReports,
    talkStarters,
    actionCards,
    disclaimerKo: INDIVIDUAL_DISCLAIMER,
  };
}

export function buildWeddingCodeV05CoupleReport(
  first: WeddingCodeV05ScoreResult,
  second: WeddingCodeV05ScoreResult
): WeddingCodeV05CoupleReport {
  const overlaps = first.publicAxes
    .map((axis) => {
      const other = second.publicAxes.find((candidate) => candidate.key === axis.key);
      if (!other) return null;
      return axisOverlap(axis, other);
    })
    .filter((axis): axis is WeddingCodeV05CoupleAxisOverlap => axis !== null);

  if (overlaps.length < 2) {
    return {
      titleKo: "두 사람의 준비 방식 겹침도",
      overlapScore: null,
      overlapLabelKo: "아직 비교하기엔 응답이 부족해요",
      easyPoints: [],
      talkFirst: null,
      guideKo: "두 사람이 같은 문항에 조금 더 답하면, 대화가 쉬운 지점과 먼저 맞춰볼 지점을 나눠볼 수 있어요.",
      disclaimerKo: COUPLE_DISCLAIMER,
    };
  }

  const overlapScore = roundScore(overlaps.reduce((sum, axis) => sum + axis.overlapScore, 0) / overlaps.length);
  const orderedByOverlap = [...overlaps].sort((a, b) => b.overlapScore - a.overlapScore);
  const talkFirst = [...overlaps].sort((a, b) => a.overlapScore - b.overlapScore)[0] ?? null;

  return {
    titleKo: "두 사람의 준비 방식 겹침도",
    overlapScore,
    overlapLabelKo: coupleOverlapLabel(overlapScore),
    easyPoints: orderedByOverlap.slice(0, 2),
    talkFirst,
    guideKo: talkFirst
      ? `${talkFirst.labelKo}부터 먼저 맞춰보면 좋아요. 점수가 낮다는 뜻이 아니라, 대화를 시작하면 효율이 큰 지점이에요.`
      : "두 사람이 비슷하게 답한 지점부터 가볍게 이야기해보세요.",
    disclaimerKo: COUPLE_DISCLAIMER,
  };
}

function axisToReport(axis: WeddingCodeV05AxisScore): WeddingCodeV05AxisReport {
  return {
    key: axis.key,
    labelKo: axis.labelKo,
    summaryKo: axisSummary(axis),
    leftScore: axis.leftScore,
    rightScore: axis.rightScore,
    confidenceBand: axis.confidenceBand,
  };
}

function axisSummary(axis: WeddingCodeV05AxisScore): string {
  if (axis.leaning === "insufficient_data") {
    return `${axis.labelKo}은 아직 답변이 조금 더 필요해요.`;
  }

  const balanced = axis.leaning === "balanced";
  switch (axis.key) {
    case "decisionCriteria":
      if (balanced) return "조건 확인과 의미 있는 장면을 함께 보며 결정하려는 편이에요.";
      return axis.leaning === "left"
        ? "포함 항목, 총액, 후기처럼 확인 가능한 기준이 보여야 마음이 놓이는 편이에요."
        : "이 선택이 어떤 장면과 의미로 남을지 먼저 그려봐야 마음이 움직이는 편이에요.";
    case "preparationMode":
      if (balanced) return "함께 보는 일과 맡아서 정리하는 일을 상황에 따라 섞는 편이에요.";
      return axis.leaning === "left"
        ? "상대와 같이 보고 기준을 맞추는 과정이 있어야 준비가 편해지는 편이에요."
        : "각자 잘 보는 일을 맡아 정리한 뒤 함께 확인하면 준비가 편해지는 편이에요.";
    case "coordinationScope":
      if (balanced) return "둘의 기준과 가족·하객 기준을 함께 놓고 조율하려는 편이에요.";
      return axis.leaning === "left"
        ? "둘이 지키고 싶은 기준을 먼저 세워야 가족과도 편하게 이야기하는 편이에요."
        : "부모님, 하객, 식사, 교통처럼 함께 얽힌 기준을 먼저 살피는 편이에요.";
    case "supportOrder":
      if (balanced) return "마음을 먼저 듣는 시간과 바로 할 일을 정하는 시간이 둘 다 필요한 편이에요.";
      return axis.leaning === "left"
        ? "걱정이나 막힌 지점을 먼저 들어야 다음 행동으로 넘어가기 쉬운 편이에요."
        : "할 일, 마감, 역할처럼 바로 움직일 기준이 잡혀야 마음이 놓이는 편이에요.";
  }
}

function buildTalkStarters(axes: WeddingCodeV05AxisScore[]): string[] {
  const concreteAxes = axes
    .filter((axis) => axis.differencePp !== null)
    .sort((a, b) => (b.differencePp ?? 0) - (a.differencePp ?? 0));
  const top = concreteAxes[0];
  const starters = [
    "이번 주 결혼 준비에서 각자 제일 신경 쓰이는 것 하나만 먼저 말해보세요.",
  ];
  if (!top || top.differencePp === null) return starters;

  switch (top.key) {
    case "decisionCriteria":
      starters.push("계약 전 확인할 조건 3개와, 마음에 남는 장면 1개를 같이 적어보세요.");
      break;
    case "preparationMode":
      starters.push("같이 볼 결정과 맡아서 볼 일을 나눠서, 서로 기대하는 준비 방식을 맞춰보세요.");
      break;
    case "coordinationScope":
      starters.push("우리 기준 1개와 가족이 중요하게 볼 기준 1개를 나란히 적어보세요.");
      break;
    case "supportOrder":
      starters.push("힘들 때 먼저 듣기와 바로 정리하기 중 어떤 순서가 편한지 한 문장으로 말해보세요.");
      break;
  }
  return starters;
}

function buildActionCards(score: WeddingCodeV05ScoreResult): WeddingCodeV05ActionCard[] {
  const cards: WeddingCodeV05ActionCard[] = [
    {
      id: "one_topic_talk",
      titleKo: "오늘 정할 한 가지",
      bodyKo: "전체 준비를 한 번에 다 말하지 말고, 오늘 정할 주제 하나만 골라보세요.",
    },
    {
      id: "criteria_sync",
      titleKo: "기준 맞추기",
      bodyKo: "좋았던 점과 걸리는 점을 각각 하나씩 적으면 대화가 덜 엉켜요.",
    },
  ];

  if ((score.internalOnly.decisionPaceRisk.normalized ?? 0) >= 50) {
    cards.push({
      id: "contract_check",
      titleKo: "계약 전 확인",
      bodyKo: "마음이 크게 움직인 선택일수록 총액, 추가금, 취소 조건은 문서로 한 번 더 확인해보세요.",
    });
  }
  if ((score.internalOnly.guidanceNeed.normalized ?? 0) >= 50) {
    cards.push({
      id: "quote_guidance",
      titleKo: "먼저 볼 3가지",
      bodyKo: "후보나 견적이 많을 때는 먼저 볼 기준 3개만 골라 압축해보세요.",
    });
  }
  return cards;
}

function axisOverlap(
  first: WeddingCodeV05AxisScore,
  second: WeddingCodeV05AxisScore
): WeddingCodeV05CoupleAxisOverlap | null {
  const firstPosition = axisPosition(first);
  const secondPosition = axisPosition(second);
  if (firstPosition === null || secondPosition === null) return null;
  const distance = Math.abs(firstPosition - secondPosition);
  const overlapScore = Math.max(0, roundScore(100 - (distance / 200) * 100));
  const label = overlapScore >= 75 ? "high" : overlapScore >= 55 ? "medium" : "low";
  return {
    key: first.key,
    labelKo: first.labelKo,
    overlapScore,
    label,
    summaryKo: coupleAxisSummary(first, second, overlapScore),
  };
}

function axisPosition(axis: WeddingCodeV05AxisScore): number | null {
  if (axis.leftScore === null || axis.rightScore === null) return null;
  return roundScore(axis.leftScore - axis.rightScore);
}

function coupleAxisSummary(
  first: WeddingCodeV05AxisScore,
  second: WeddingCodeV05AxisScore,
  overlapScore: number
): string {
  if (overlapScore >= 75) {
    return `${first.labelKo}은 두 사람이 비교적 비슷하게 느끼는 지점이에요. 이 부분은 대화가 쉽게 시작될 수 있어요.`;
  }
  if (overlapScore >= 55) {
    return `${first.labelKo}은 겹치는 부분도 있고 다른 부분도 있어요. 서로 먼저 보는 기준을 한 번씩 말해보면 좋아요.`;
  }
  return `${first.labelKo}은 먼저 맞춰보면 좋은 지점이에요. 한 사람은 ${sidePhrase(first)}, 다른 사람은 ${sidePhrase(second)}에 가까울 수 있어요.`;
}

function sidePhrase(axis: WeddingCodeV05AxisScore): string {
  if (axis.leaning === "left") return axis.leftLabelKo;
  if (axis.leaning === "right") return axis.rightLabelKo;
  return "균형";
}

function coupleOverlapLabel(score: number): string {
  if (score >= 75) return "대화가 쉽게 시작될 지점이 많아요";
  if (score >= 55) return "겹치는 부분과 맞춰볼 부분이 함께 있어요";
  return "먼저 맞춰볼 대화 주제가 뚜렷해요";
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}
