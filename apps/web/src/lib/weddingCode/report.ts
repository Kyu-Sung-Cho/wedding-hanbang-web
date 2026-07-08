import {
  WEDDING_CODE_V05_QUESTIONS,
  type WeddingCodeV05OptionValue,
  type WeddingCodeV05QuestionKey,
} from "@/constants/weddingCodeV05";
import type { WeddingCodeV05Answers, WeddingCodeV05AxisScore, WeddingCodeV05ScoreResult } from "./score";

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
  firstSideKo: string;
  secondSideKo: string;
};

export type WeddingCodeV05CoupleSolutionCard = {
  id:
    | "dress_budget_style"
    | "vendor_shortlist_roles"
    | "family_guest_scope"
    | "planning_talk_order";
  axisKey: WeddingCodeV05AxisScore["key"];
  categoryKo: string;
  titleKo: string;
  attentionKo: string;
  solutionKo: string;
  firstQuestionKo: string;
  overlapScore: number;
};

export type WeddingCodeV05CoupleScenarioCard = {
  id: string;
  relation: "same" | "different";
  categoryKo: string;
  titleKo: string;
  firstChoiceKo: string;
  secondChoiceKo: string;
  attentionKo: string;
  solutionKo: string;
  firstQuestionKo: string;
};

export type WeddingCodeV05CoupleReport = {
  titleKo: string;
  overlapScore: number | null;
  overlapLabelKo: string;
  easyPoints: WeddingCodeV05CoupleAxisOverlap[];
  talkFirst: WeddingCodeV05CoupleAxisOverlap | null;
  scenarioCards: WeddingCodeV05CoupleScenarioCard[];
  solutionCards: WeddingCodeV05CoupleSolutionCard[];
  guideKo: string;
  disclaimerKo: string;
};

const INDIVIDUAL_DISCLAIMER =
  "이 결과는 현재 답변을 바탕으로 결혼 준비 대화를 시작하기 쉽게 정리한 참고 자료예요. 사람을 평가하거나 앞날을 단정하는 데 쓰지 않아요.";

const COUPLE_DISCLAIMER =
  "두 사람의 점수 차이는 좋고 나쁨을 가르는 기준이 아니라, 결혼 준비에서 무엇부터 이야기할지 찾기 위한 참고예요.";

export function buildWeddingCodeV05IndividualReport(
  score: WeddingCodeV05ScoreResult
): WeddingCodeV05IndividualReport {
  const axisReports = score.publicAxes.map(axisToReport);
  const talkStarters = buildTalkStarters(score.publicAxes);
  const actionCards = buildActionCards(score);

  return {
    titleKo: "현재 답변으로 본 결혼 준비 방식",
    subtitleKo: `${score.answeredCount}개 선택을 바탕으로, 단정하지 않고 대화에 쓸 수 있는 내용만 정리했어요.`,
    axisReports,
    talkStarters,
    actionCards,
    disclaimerKo: INDIVIDUAL_DISCLAIMER,
  };
}

export function buildWeddingCodeV05CoupleReport(
  first: WeddingCodeV05ScoreResult,
  second: WeddingCodeV05ScoreResult,
  options: {
    firstAnswers?: WeddingCodeV05Answers;
    secondAnswers?: WeddingCodeV05Answers;
  } = {}
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
      scenarioCards: [],
      solutionCards: [],
      guideKo: "두 사람이 같은 문항에 조금 더 답하면, 쉽게 이야기할 부분과 먼저 맞출 부분을 나눠볼 수 있어요.",
      disclaimerKo: COUPLE_DISCLAIMER,
    };
  }

  const overlapScore = roundScore(overlaps.reduce((sum, axis) => sum + axis.overlapScore, 0) / overlaps.length);
  const orderedByOverlap = [...overlaps].sort((a, b) => b.overlapScore - a.overlapScore);
  const orderedByNeed = [...overlaps].sort((a, b) => a.overlapScore - b.overlapScore);
  const talkFirst = orderedByNeed[0] ?? null;

  return {
    titleKo: "두 사람의 준비 방식 겹침도",
    overlapScore,
    overlapLabelKo: coupleOverlapLabel(overlapScore),
    easyPoints: orderedByOverlap.slice(0, 2),
    talkFirst,
    scenarioCards: buildScenarioCards(options.firstAnswers, options.secondAnswers),
    solutionCards: orderedByNeed.map(solutionCardForAxis),
    guideKo: talkFirst
      ? `${talkFirst.labelKo}부터 이야기해보면 좋아요. 점수가 낮다는 뜻이 아니라, 먼저 맞추면 대화가 쉬워지는 부분이에요.`
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
        ? "포함 항목, 총액, 후기처럼 확인할 수 있는 내용이 보여야 마음이 놓이는 편이에요."
        : "이 선택이 어떤 장면과 의미로 남을지 먼저 그려봐야 마음이 움직이는 편이에요.";
    case "preparationMode":
      if (balanced) return "함께 보는 일과 맡아서 정리하는 일을 상황에 따라 섞는 편이에요.";
      return axis.leaning === "left"
        ? "상대와 같이 보고 중요한 점을 맞춰야 준비가 편해지는 편이에요."
        : "각자 잘 보는 일을 맡아 정리한 뒤 함께 확인하면 준비가 편해지는 편이에요.";
    case "coordinationScope":
      if (balanced) return "둘이 원하는 것과 가족·하객이 중요하게 볼 것을 함께 조율하려는 편이에요.";
      return axis.leaning === "left"
        ? "둘이 양보하기 어려운 것을 먼저 정해두면 가족과도 편하게 이야기하는 편이에요."
        : "부모님, 하객, 식사, 교통처럼 함께 살펴야 할 부분을 중요하게 보는 편이에요.";
    case "supportOrder":
      if (balanced) return "마음을 먼저 듣는 시간과 바로 할 일을 정하는 시간이 둘 다 필요한 편이에요.";
      return axis.leaning === "left"
        ? "걱정이나 막힌 지점을 먼저 들어야 다음 행동으로 넘어가기 쉬운 편이에요."
        : "할 일, 마감, 역할처럼 바로 움직일 내용이 잡혀야 마음이 놓이는 편이에요.";
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
      starters.push("우리가 양보하기 어려운 것 1개와 가족이 중요하게 볼 것 1개를 나란히 적어보세요.");
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
      titleKo: "중요한 점 맞추기",
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
      titleKo: "먼저 확인할 3가지",
      bodyKo: "업체나 견적이 많을 때는 먼저 확인할 것 3개만 골라 압축해보세요.",
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
    firstSideKo: sidePhrase(first),
    secondSideKo: sidePhrase(second),
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
    return `${first.labelKo}은 겹치는 부분도 있고 다른 부분도 있어요. 서로 중요하게 본 것을 한 번씩 말해보면 좋아요.`;
  }
  return `${first.labelKo}은 먼저 이야기해보면 좋은 부분이에요. 한 사람은 ${sidePhrase(first)}, 다른 사람은 ${sidePhrase(second)}에 가까울 수 있어요.`;
}

function sidePhrase(axis: WeddingCodeV05AxisScore): string {
  if (axis.leaning === "left") return axis.leftLabelKo;
  if (axis.leaning === "right") return axis.rightLabelKo;
  return "균형";
}

function coupleOverlapLabel(score: number): string {
  if (score >= 75) return "대화가 쉽게 시작될 지점이 많아요";
  if (score >= 55) return "겹치는 부분과 맞춰볼 부분이 함께 있어요";
  return "먼저 이야기할 주제가 뚜렷해요";
}

function solutionCardForAxis(axis: WeddingCodeV05CoupleAxisOverlap): WeddingCodeV05CoupleSolutionCard {
  const attentionKo = sideAttention(axis);
  switch (axis.key) {
    case "decisionCriteria":
      return {
        id: "dress_budget_style",
        axisKey: axis.key,
        categoryKo: "드레스·스튜디오 선택",
        titleKo: "예산선과 마음에 드는 장면을 같이 보기",
        attentionKo,
        solutionKo:
          "먼저 넘지 않을 상한선을 정하고, 그 선을 넘겨도 되는 이유가 있는지 한 문장으로 따로 적어보세요. 가격 이야기를 먼저 닫은 뒤, 사진·무드·오래 남을 장면을 다시 보면 대화가 덜 엉켜요.",
        firstQuestionKo: "이 선택은 얼마까지 괜찮고, 무엇 때문에 그만큼 쓸 수 있다고 느끼는지부터 말해볼까요?",
        overlapScore: axis.overlapScore,
      };
    case "preparationMode":
      return {
        id: "vendor_shortlist_roles",
        axisKey: axis.key,
        categoryKo: "업체·장소 정리",
        titleKo: "같이 볼 결정과 맡아볼 일을 분리하기",
        attentionKo,
        solutionKo:
          "처음부터 전부 같이 보려 하면 느려지고, 한쪽이 다 정리하면 소외감이 생길 수 있어요. 업체나 장소를 좁히는 일은 맡아서 하되, 계약·취향·예산이 걸린 최종 결정은 함께 보는 식으로 선을 나눠보세요.",
        firstQuestionKo: "이번 주에는 무엇을 같이 보고, 무엇을 각자 맡아 정리하면 편할까요?",
        overlapScore: axis.overlapScore,
      };
    case "coordinationScope":
      return {
        id: "family_guest_scope",
        axisKey: axis.key,
        categoryKo: "예식장·하객·가족 조율",
        titleKo: "우리가 원하는 것과 가족이 보는 것 나란히 놓기",
        attentionKo,
        solutionKo:
          "한쪽은 둘이 원하는 것을 지키고 싶고, 다른 쪽은 부모님·하객·식사·교통을 중요하게 볼 수 있어요. 우리가 원하는 것, 가족이 보는 것, 조정할 수 있는 것을 세 칸으로 나눠 적으면 누가 양보해야 하는지보다 무엇을 맞출지가 선명해져요.",
        firstQuestionKo: "우리가 양보하기 어려운 것 하나와 가족이 중요하게 볼 것 하나를 같이 적어볼까요?",
        overlapScore: axis.overlapScore,
      };
    case "supportOrder":
      return {
        id: "planning_talk_order",
        axisKey: axis.key,
        categoryKo: "준비 대화가 지칠 때",
        titleKo: "듣는 시간과 정리하는 시간을 순서대로 두기",
        attentionKo,
        solutionKo:
          "한 사람은 마음을 먼저 들어주길 바라고, 다른 사람은 바로 해결 방법을 잡아주려 할 수 있어요. 처음 5분은 걱정을 끊지 않고 듣고, 그다음 오늘 정할 한 가지만 고르는 순서로 나눠보세요.",
        firstQuestionKo: "지금은 먼저 들어줬으면 좋겠어요, 아니면 바로 정리해보는 게 편해요?",
        overlapScore: axis.overlapScore,
      };
  }
}

function sideAttention(axis: WeddingCodeV05CoupleAxisOverlap): string {
  if (axis.firstSideKo === axis.secondSideKo) {
    return `두 사람 모두 ${axis.firstSideKo}에 가까워도, 실제 결정 장면에서는 중요한 점을 말로 꺼내지 않으면 서로 이미 안다고 착각하기 쉬워요.`;
  }
  if (axis.firstSideKo === "균형" || axis.secondSideKo === "균형") {
    return `한 사람은 ${axis.firstSideKo}, 다른 사람은 ${axis.secondSideKo}에 가까울 수 있어요. 균형 쪽 답변도 상황이 급해지면 한쪽으로 기울 수 있으니 먼저 순서를 정해두면 좋아요.`;
  }
  return `한 사람은 ${axis.firstSideKo}, 다른 사람은 ${axis.secondSideKo}에 가까울 수 있어요. 둘 중 하나가 더 맞다는 뜻이 아니라, 중요하게 보는 점이 달라 대화 순서가 엉킬 수 있는 부분이에요.`;
}

type ScenarioMeta = {
  categoryKo: string;
  titleKo: string;
  differenceKo: string;
  sharedKo: string;
  solutionKo: string;
  firstQuestionKo: string;
  priority: number;
};

const SCENARIO_PUBLIC_IDS: Record<WeddingCodeV05QuestionKey, string> = {
  A1: "quote_addons",
  A2: "memory_option",
  A3: "venue_budget_gap",
  A4: "low_review_studio",
  B1: "partner_unseen_place",
  B2: "lopsided_preparation",
  B3: "different_lenses",
  B4: "candidate_overload",
  C1: "parent_guest_criteria",
  C2: "parent_direction_talk",
  C3: "simplify_ceremony",
  C4: "guest_count_guarantee",
  D1: "solution_first_support",
  D2: "tired_planning_talk",
  D3: "different_pace",
  D4: "same_day_benefit",
};

const SCENARIO_META: Record<WeddingCodeV05QuestionKey, ScenarioMeta> = {
  A1: {
    categoryKo: "견적·추가금",
    titleKo: "포함 항목과 원하는 결과물을 따로 보기",
    differenceKo:
      "한 사람은 비용 구조를 확인하고 싶고, 다른 사람은 결과물의 느낌이나 후기를 중요하게 볼 수 있어요. 이때 가격 이야기가 취향을 누르는 말처럼 들리지 않게 순서를 나누는 게 좋아요.",
    sharedKo:
      "두 사람이 비슷한 선택을 했어요. 그래도 실제 견적서 앞에서는 포함 항목, 추가금, 원하는 결과물을 각각 따로 적어두면 빠뜨리는 항목이 줄어들어요.",
    solutionKo:
      "견적서에 형광펜을 세 가지로 나눠보세요. 포함된 것, 추가로 낼 수 있는 것, 마음에 드는 결과물입니다. 세 칸을 다 본 뒤에 총액 이야기를 하면 대화가 덜 날카로워져요.",
    firstQuestionKo: "이 견적에서 꼭 확인할 비용 1개와, 마음에 드는 결과물 1개는 뭐예요?",
    priority: 88,
  },
  A2: {
    categoryKo: "영상·앨범 옵션",
    titleKo: "오래 남는 장면과 예산선을 같이 정하기",
    differenceKo:
      "한 사람은 나중에 남을 장면을 중요하게 보고, 다른 사람은 전체 예산 안에서 감당되는지를 중요하게 볼 수 있어요.",
    sharedKo:
      "두 사람이 비슷하게 보고 있어요. 그래도 추억이 남는 옵션은 현장에서 마음이 커지기 쉬워서, 미리 예산선과 이유를 같이 정해두면 좋아요.",
    solutionKo:
      "먼저 '나중에 다시 봤을 때 아깝지 않을 장면'을 한 문장으로 적고, 그다음 넘지 않을 금액을 정하세요. 장면의 이유와 금액의 선을 분리하면 둘 다 존중받는 느낌이 납니다.",
    firstQuestionKo: "이 옵션은 어떤 장면 때문에 남기고 싶고, 얼마까지면 괜찮을까요?",
    priority: 74,
  },
  A3: {
    categoryKo: "예식장 예산 차이",
    titleKo: "예산 초과분을 숫자와 이유로 나눠보기",
    differenceKo:
      "한 사람은 총액과 보증인원을 중요하게 보고, 다른 사람은 그 공간에서 하고 싶은 결혼식 장면을 중요하게 볼 수 있어요.",
    sharedKo:
      "두 사람이 비슷한 점을 보고 있어요. 그래도 예산보다 큰 선택은 나중에 부담으로 돌아올 수 있으니, 초과분의 이유를 문장으로 남겨두는 게 좋아요.",
    solutionKo:
      "초과 금액을 바로 찬반으로 보지 말고 세 줄로 나눠보세요. 전체 금액, 추가로 얻는 점, 부담되는 점입니다. 세 줄이 모두 납득될 때만 계속 알아보세요.",
    firstQuestionKo: "300만 원이 더 든다면 추가로 얻는 점과 부담되는 점은 무엇인가요?",
    priority: 100,
  },
  A4: {
    categoryKo: "스튜디오·업체 확신",
    titleKo: "취향 확신과 확인 자료를 같이 보기",
    differenceKo:
      "한 사람은 취향과 무드를 먼저 믿고 싶고, 다른 사람은 실제 후기나 포함 조건이 있어야 마음이 놓일 수 있어요.",
    sharedKo:
      "두 사람이 비슷하게 보고 있어요. 후기가 적은 업체는 마음에 들어도 확인 자료를 조금 더 모아야 나중에 불안이 줄어들어요.",
    solutionKo:
      "포트폴리오가 마음에 들수록 최근 실제 촬영본, 포함 조건, 수정 가능 범위를 한 번 더 확인하세요. 취향은 살리고, 확인할 것은 따로 체크하는 방식이 안전해요.",
    firstQuestionKo: "이 업체는 어떤 무드가 마음에 들고, 계약 전 꼭 확인할 자료는 뭐예요?",
    priority: 82,
  },
  B1: {
    categoryKo: "한쪽이 먼저 본 업체나 장소",
    titleKo: "먼저 본 사람의 확신과 나중에 보는 사람의 첫 느낌을 둘 다 살리기",
    differenceKo:
      "한 사람은 이미 끌린 이유가 있고, 다른 사람은 아직 자기 눈으로 볼 시간이 필요할 수 있어요.",
    sharedKo:
      "두 사람이 비슷하게 접근해도, 먼저 본 사람이 설명을 많이 하면 상대의 첫 느낌이 사라질 수 있어요.",
    solutionKo:
      "먼저 본 사람은 좋았던 점과 걸리는 점만 짧게 공유하고, 상대가 사진이나 조건을 본 뒤 첫 느낌을 말할 시간을 따로 주세요.",
    firstQuestionKo: "내가 좋았던 이유를 말하기 전에, 너는 처음 봤을 때 뭐가 먼저 보여?",
    priority: 58,
  },
  B2: {
    categoryKo: "역할 쏠림",
    titleKo: "부담 확인 후 역할을 다시 나누기",
    differenceKo:
      "한 사람은 일을 나누고 싶고, 다른 사람은 먼저 부담을 들어주길 바랄 수 있어요. 바로 분담표로 가면 마음이 따라오지 않을 수 있습니다.",
    sharedKo:
      "두 사람이 비슷하게 느껴도 역할이 한쪽으로 쏠렸다면, 이미 지친 부분을 먼저 확인해야 다음 분담이 오래 갑니다.",
    solutionKo:
      "처음 5분은 '어디가 제일 부담됐는지'만 말하고, 그다음 같이 볼 결정과 맡아서 볼 일을 둘로 나누세요.",
    firstQuestionKo: "지금까지 준비하면서 제일 혼자 짊어진 느낌이 든 부분은 뭐였어요?",
    priority: 86,
  },
  B3: {
    categoryKo: "업체·장소 비교",
    titleKo: "각자 중요하게 보는 점을 한 표에 합치기",
    differenceKo:
      "한 사람은 업체나 장소를 맡아 좁히고 싶고, 다른 사람은 같이 보며 중요하게 볼 점을 맞추고 싶을 수 있어요.",
    sharedKo:
      "두 사람이 비슷하게 답했어도, 실제로 볼 곳이 많아지면 서로 중요하게 보는 점이 흩어질 수 있어요.",
    solutionKo:
      "장소나 업체별로 조건, 분위기, 비용, 걸리는 점 네 칸만 적어보세요. 각자 잘 보는 칸을 맡으면 속도와 함께 보는 느낌을 둘 다 챙길 수 있어요.",
    firstQuestionKo: "나는 어떤 칸을 잘 볼 테니, 너는 어떤 칸을 봐주면 좋을까요?",
    priority: 62,
  },
  B4: {
    categoryKo: "선택지 과부하",
    titleKo: "더 보기 전에 제외할 곳부터 정하기",
    differenceKo:
      "한 사람은 선택지를 더 좁히고 싶고, 다른 사람은 같이 비교하거나 잠시 멈추고 싶을 수 있어요.",
    sharedKo:
      "두 사람이 비슷하게 답했어도, 볼 곳이 계속 늘면 피로가 결정을 끌고 갈 수 있어요.",
    solutionKo:
      "새로운 곳을 더 보기 전에 제외할 이유 2개를 먼저 정하세요. 예산, 위치, 날짜, 후기, 분위기 중 무엇이 안 맞으면 제외할지 정하면 비교가 짧아져요.",
    firstQuestionKo: "이번 주에는 어떤 곳을 더 볼지가 아니라, 어떤 곳을 그만 볼까요?",
    priority: 76,
  },
  C1: {
    categoryKo: "예식장·가족 조율",
    titleKo: "분위기와 음식·교통을 같이 놓기",
    differenceKo:
      "한 사람은 우리가 원하는 분위기를 지키고 싶고, 다른 사람은 부모님이나 하객이 중요하게 볼 부분을 살피고 싶을 수 있어요.",
    sharedKo:
      "두 사람이 비슷하게 보고 있어도, 가족이 중요하게 볼 부분이 뒤늦게 들어오면 결정이 흔들리기 쉬워요.",
    solutionKo:
      "우리가 원하는 것과 가족이 중요하게 볼 것을 경쟁시키지 말고 나란히 놓으세요. 분위기, 식사, 교통, 비용 네 칸을 만든 뒤 각 칸에서 최소로 지킬 것을 정하면 좋아요.",
    firstQuestionKo: "우리가 양보하기 어려운 것 하나와 부모님이 중요하게 볼 것 하나를 같이 적어볼까요?",
    priority: 84,
  },
  C2: {
    categoryKo: "부모님께 처음 말하기",
    titleKo: "둘이 양보하기 어려운 것을 맞춘 뒤 설명 순서 정하기",
    differenceKo:
      "한 사람은 둘이 양보하기 어려운 것을 먼저 정하고 싶고, 다른 사람은 부모님이 궁금해할 부분이나 말 꺼내는 순서를 먼저 준비하고 싶을 수 있어요.",
    sharedKo:
      "두 사람이 비슷하게 답했어도, 부모님께 말할 때는 합의한 내용과 표현 순서를 따로 맞춰두는 게 좋아요.",
    solutionKo:
      "먼저 둘이 양보하기 어려운 것 2개를 정하고, 그다음 부모님께 말할 첫 문장과 숫자로 설명할 근거를 나눠 준비하세요.",
    firstQuestionKo: "우리가 먼저 합의할 것은 뭐고, 부모님께는 어떤 순서로 말할까요?",
    priority: 80,
  },
  C3: {
    categoryKo: "전통 절차 조율",
    titleKo: "그대로 할 절차와 간단히 할 절차 나누기",
    differenceKo:
      "한 사람은 우리 상황에 맞게 간소화하고 싶고, 다른 사람은 가족이 중요하게 여길 절차를 먼저 확인하고 싶을 수 있어요.",
    sharedKo:
      "두 사람이 비슷하게 생각해도, 전통 절차는 가족에게 다르게 받아들여질 수 있어서 설명 방식이 중요해요.",
    solutionKo:
      "절차를 없앨지 말지로 바로 가지 말고, 그대로 할 것, 간단히 할 것, 설명이 필요한 것으로 나누세요. 간단히 하려는 이유를 비용보다 피로·동선·시간으로 말하면 덜 날카롭습니다.",
    firstQuestionKo: "그대로 하고 싶은 절차와 간단히 하고 싶은 절차는 각각 뭐예요?",
    priority: 70,
  },
  C4: {
    categoryKo: "하객 수·보증인원",
    titleKo: "초대 원칙과 비용 영향을 분리하기",
    differenceKo:
      "한 사람은 보증인원과 총액을 먼저 계산하고, 다른 사람은 양가가 초대하고 싶은 범위나 이유를 먼저 들을 수 있어요.",
    sharedKo:
      "두 사람이 비슷하게 답했어도, 하객 수는 양가 생각과 비용이 같이 움직여서 나중에 다시 커지기 쉬운 주제예요.",
    solutionKo:
      "먼저 예상 참석 인원과 보증인원의 차이를 계산하고, 그다음 양가 초대 원칙을 맞추세요. 비용표와 초대 원칙을 한 문서에 같이 두면 감정 싸움이 줄어듭니다.",
    firstQuestionKo: "초대하고 싶은 범위와 실제 보증인원 차이는 얼마나 나나요?",
    priority: 90,
  },
  D1: {
    categoryKo: "걱정과 해결책",
    titleKo: "듣기와 해결의 순서를 합의하기",
    differenceKo:
      "한 사람은 마음을 먼저 들어주길 바라고, 다른 사람은 바로 해결책을 찾아주려 할 수 있어요.",
    sharedKo:
      "두 사람이 비슷하게 답했어도, 피곤한 날에는 듣기와 해결의 순서가 쉽게 어긋날 수 있어요.",
    solutionKo:
      "걱정 이야기가 나오면 먼저 '듣기 모드인지, 정리 모드인지'를 확인하세요. 5분 듣고 10분 정리처럼 시간을 나누면 둘 다 덜 지칩니다.",
    firstQuestionKo: "지금은 먼저 들어줬으면 좋겠어요, 아니면 같이 정리해볼까요?",
    priority: 92,
  },
  D2: {
    categoryKo: "준비 대화 피로",
    titleKo: "멈출 시간과 오늘 정할 한 가지를 구분하기",
    differenceKo:
      "한 사람은 쉬고 다시 이야기하고 싶고, 다른 사람은 오늘 할 일을 작게 정리하고 싶을 수 있어요.",
    sharedKo:
      "두 사람이 비슷하게 답했어도, 준비 이야기가 반복되면 대화 자체가 피곤한 주제가 될 수 있어요.",
    solutionKo:
      "준비 대화가 길어지면 전체 목록을 꺼내지 말고 멈출 시간부터 정하세요. 다시 볼 시간을 잡은 뒤, 오늘 정할 한 가지 주제만 남기면 좋습니다.",
    firstQuestionKo: "오늘은 멈추는 게 좋을까요, 아니면 딱 한 가지만 정하고 끝낼까요?",
    priority: 78,
  },
  D3: {
    categoryKo: "준비 속도 차이",
    titleKo: "막힌 이유와 오늘 할 일을 따로 보기",
    differenceKo:
      "한 사람은 어디서 막혔는지 듣고 싶고, 다른 사람은 바로 할 일을 나누고 싶을 수 있어요.",
    sharedKo:
      "두 사람이 비슷하게 답해도 준비 속도는 실제 일정과 피로에 따라 계속 달라질 수 있어요.",
    solutionKo:
      "속도가 다르다고 느끼면 먼저 막힌 이유를 한 문장으로 말하고, 그다음 오늘 바로 할 수 있는 작은 일 하나만 나누세요.",
    firstQuestionKo: "지금 늦어진 이유는 마음의 부담 때문이에요, 아니면 할 일이 안 쪼개져서예요?",
    priority: 72,
  },
  D4: {
    categoryKo: "당일 혜택·계약 결정",
    titleKo: "마음이 움직인 이유와 계약 조건을 분리 확인하기",
    differenceKo:
      "한 사람은 마음이 선명할 때 결정하고 싶고, 다른 사람은 총액·추가금·취소 조건을 확인해야 마음이 놓일 수 있어요.",
    sharedKo:
      "두 사람이 비슷하게 답해도, 당일 혜택은 속도를 높이는 장치라 계약 전 확인 시간이 꼭 필요해요.",
    solutionKo:
      "오늘 계약 혜택은 메모해두되, 결정은 총액, 추가금, 취소 조건, 다른 선택지를 확인한 뒤 하세요. 마음이 움직인 이유도 같이 적어야 나중에 후회가 줄어듭니다.",
    firstQuestionKo: "오늘 마음이 움직인 이유와, 계약 전에 확인할 조건 3개는 뭐예요?",
    priority: 96,
  },
};

function buildScenarioCards(
  firstAnswers: WeddingCodeV05Answers | undefined,
  secondAnswers: WeddingCodeV05Answers | undefined
): WeddingCodeV05CoupleScenarioCard[] {
  if (!firstAnswers || !secondAnswers) return [];

  return WEDDING_CODE_V05_QUESTIONS
    .map((question) => {
      const firstAnswer = firstAnswers[question.key];
      const secondAnswer = secondAnswers[question.key];
      if (!firstAnswer || !secondAnswer) return null;
      const meta = SCENARIO_META[question.key];
      const relation = firstAnswer === secondAnswer ? "same" : "different";
      const priority = meta.priority + (relation === "different" ? 100 : 0);
      const firstChoiceKo = optionLabel(question.key, firstAnswer);
      const secondChoiceKo = optionLabel(question.key, secondAnswer);
      return {
        priority,
        card: {
          id: SCENARIO_PUBLIC_IDS[question.key],
          relation,
          categoryKo: meta.categoryKo,
          titleKo: meta.titleKo,
          firstChoiceKo,
          secondChoiceKo,
          attentionKo: relation === "different" ? meta.differenceKo : meta.sharedKo,
          solutionKo: meta.solutionKo,
          firstQuestionKo: meta.firstQuestionKo,
        } satisfies WeddingCodeV05CoupleScenarioCard,
      };
    })
    .filter((entry): entry is { priority: number; card: WeddingCodeV05CoupleScenarioCard } => entry !== null)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5)
    .map((entry) => entry.card);
}

function optionLabel(questionKey: WeddingCodeV05QuestionKey, optionValue: WeddingCodeV05OptionValue): string {
  const question = WEDDING_CODE_V05_QUESTIONS.find((candidate) => candidate.key === questionKey);
  const option = question?.options.find((candidate) => candidate.value === optionValue);
  return option?.label ?? optionValue;
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}
