import {
  ALL_QUESTIONS_19,
  CEILING_CHECK_QUESTION_IDS,
  CHARACTER_PROFILES_19,
  COUPLE_AXIS_SYNERGY_19,
  ITEM_INTERPRETATIONS_19,
  QUESTION_MAP_19,
  type Axis1Letter,
  type Axis2Letter,
  type Axis3Letter,
  type Axis4Letter,
  type AxisSynergyEntry,
  type CharacterProfile19,
  type Part1AnswerValue,
  type Part2AnswerValue,
  type QuestionId,
  type WeddingCode19Answers,
  type WeddingCode19AnswerValue,
  type WeddingCode19Code,
} from "./data";

export interface AxisScoreDetail<Left extends string, Right extends string> {
  axisNumber: 1 | 2 | 3 | 4;
  leftLetter: Left;
  leftLabel: string;
  rightLetter: Right;
  rightLabel: string;
  leftScore: number;
  rightScore: number;
  leftPercent: number;
  rightPercent: number;
  winner: Left | Right;
  isBalancedTie?: boolean;
  nuanceBadge?: string;
}

export interface BasketItemEntry {
  questionId: QuestionId;
  questionNumber: number;
  category: string;
  shortTitle: string;
  answer: WeddingCode19AnswerValue;
  answerBadge: string;
  interpretation: string;
  isTopPriority: boolean;
}

export interface WorkstyleManualSection {
  sectionId: "stage" | "planning" | "collaboration" | "crisis";
  title: string;
  subtitle: string;
  items: BasketItemEntry[];
}

export interface PartnerTranslationItem19 {
  whenISay: string;
  whatIReallyMean: string;
}

export interface HiddenPsychologyInsight19 {
  unconsciousTitle: string;
  unconsciousInsight: string;
  blindSpotTitle: string;
  blindSpotInsight: string;
  selfDiscoveryQuestion: string;
  partnerTranslations: PartnerTranslationItem19[];
}

export interface CoupleEmpathyTranslation19 {
  triggerSituation: string;
  myInnerThought: string;
  partnerInnerThought: string;
  bridgePrescription: string;
}

export interface CoupleEmpathyBridge19 {
  headline: string;
  myHiddenNeed: string;
  partnerHiddenNeed: string;
  translations: CoupleEmpathyTranslation19[];
}

export interface PersonalReport19 {
  code: WeddingCode19Code;
  character: CharacterProfile19;
  axes: {
    axis1: AxisScoreDetail<Axis1Letter, Axis1Letter>;
    axis2: AxisScoreDetail<Axis2Letter, Axis2Letter>;
    axis3: Axis3ScoreDetail;
    axis4: AxisScoreDetail<Axis4Letter, Axis4Letter>;
  };
  topPriorityIds: QuestionId[];
  topPriorityItems: BasketItemEntry[];
  basket: {
    mustHave5: BasketItemEntry[];
    niceToHave4: BasketItemEntry[];
    saveSimplify12: BasketItemEntry[];
    relativeSaveSuggestions: BasketItemEntry[];
    concession3D: BasketItemEntry[];
    balancedC: BasketItemEntry[];
    undecidedUnknownE: BasketItemEntry[];
    hiddenQuestionIds: QuestionId[];
  };
  workstyleSections: WorkstyleManualSection[];
  hiddenPsychology: HiddenPsychologyInsight19;
}

type Axis3ScoreDetail = AxisScoreDetail<Axis3Letter, Axis3Letter>;

export interface CoupleAlignedItem {
  questionId: QuestionId;
  questionNumber: number;
  category: string;
  shortTitle: string;
  myAnswerBadge: string;
  partnerAnswerBadge: string;
  sharedInterpretation: string;
}

export interface CoupleConcessionMatch {
  questionId: QuestionId;
  questionNumber: number;
  category: string;
  shortTitle: string;
  yielder: "me" | "partner";
  preferredBy: "me" | "partner";
  preferredAnswerBadge: string;
  preferredInterpretation: string;
  matchType?: "concession" | "lead_undecided";
}

export interface CoupleConflictItem {
  questionId: QuestionId;
  questionNumber: number;
  category: string;
  shortTitle: string;
  myAnswerBadge: string;
  myStance: string;
  partnerAnswerBadge: string;
  partnerStance: string;
  conflictSolution: string;
  myTopPriority: boolean;
  partnerTopPriority: boolean;
  conflictType?: "opposite" | "balance_gap" | "priority_gap";
}

export interface CoupleComparisonReport19 {
  myReport: PersonalReport19;
  partnerReport: PersonalReport19;
  axisSynergies: AxisSynergyEntry[];
  empathyBridge: CoupleEmpathyBridge19;
  crisisWarnings: CoupleConflictItem[];
  alignedItems: CoupleAlignedItem[];
  concessionMatches: CoupleConcessionMatch[];
  conflictItems: CoupleConflictItem[];
}

function computeAxisPercentages(leftScore: number, rightScore: number): {
  leftPercent: number;
  rightPercent: number;
} {
  const total = leftScore + rightScore;
  if (total === 0) {
    return { leftPercent: 50, rightPercent: 50 };
  }
  const leftPercent = Math.round((leftScore / total) * 100);
  return {
    leftPercent,
    rightPercent: 100 - leftPercent,
  };
}

function getPart1Direction(
  answer: WeddingCode19AnswerValue | undefined,
  positiveLetter: string,
  negativeLetter: string,
): { letter: string | null; points: number } {
  if (answer === 5) return { letter: positiveLetter, points: 2 };
  if (answer === 4) return { letter: positiveLetter, points: 1 };
  if (answer === 2) return { letter: negativeLetter, points: 1 };
  if (answer === 1) return { letter: negativeLetter, points: 2 };
  return { letter: null, points: 0 };
}

export function getCeilingCandidates19(answers: WeddingCode19Answers): QuestionId[] {
  return CEILING_CHECK_QUESTION_IDS.filter((qId) => answers[qId] === 5);
}

export function shouldTriggerCeilingModal19(answers: WeddingCode19Answers): boolean {
  return getCeilingCandidates19(answers).length >= 4;
}

export function formatAnswerBadge19(answer: WeddingCode19AnswerValue | undefined): string {
  switch (answer) {
    case 1:
      return "① 전혀 아니다";
    case 2:
      return "② 별로 아니다";
    case 3:
      return "③ 어느 쪽이든 괜찮다";
    case 4:
      return "④ 대체로 그렇다";
    case 5:
      return "⑤ 정말 그렇다";
    case "UNKNOWN":
      return "⚪ 아직 모르겠다";
    case "NA":
      return "➖ 해당 없다";
    case "A":
      return "A 선택";
    case "B":
      return "B 선택";
    case "C":
      return "C (반반 균형)";
    case "D":
      return "D (파트너에게 맞춤)";
    case "E":
      return "E (아직 잘 모르겠다)";
    case "F":
      return "F (해당 없다)";
    default:
      return "미응답";
  }
}

export function getItemInterpretationText19(
  questionId: QuestionId,
  answer: WeddingCode19AnswerValue | undefined,
): string {
  const spec = ITEM_INTERPRETATIONS_19[questionId];
  if (spec.part === 1) {
    if (answer === 4 || answer === 5) return spec.positive45;
    if (answer === 1 || answer === 2) return spec.negative12;
    if (answer === 3) {
      return "나는 어느 쪽이든 크게 상관없어 상황이나 파트너가 원하는 방향에 기분 좋게 맞출 수 있습니다.";
    }
    if (answer === "UNKNOWN") {
      return "아직 구체적으로 생각해 본 적 없는 항목입니다. 파트너와 함께 정보를 살펴보며 채워가면 좋습니다.";
    }
    return "";
  }
  if (answer === "A") return spec.choiceA;
  if (answer === "B") return spec.choiceB;
  if (answer === "C") return spec.choiceC;
  if (answer === "D") {
    return "나는 어느 방식이든 괜찮아서 파트너가 더 편하게 느끼는 방향에 기꺼이 맞출 수 있습니다.";
  }
  if (answer === "E") {
    return "아직 구체적으로 정하지 못한 항목입니다. 두 사람이 대화를 나누며 함께 기준을 세워보세요.";
  }
  return "";
}

export function scoreWeddingCode19(answers: WeddingCode19Answers): {
  code: WeddingCode19Code;
  axes: PersonalReport19["axes"];
} {
  // 축 1: S (Stage · 주인공 무대파) vs I (Intimate · 소규모 교류파)
  // Q1: 5(+2 S), 4(+1 S), 2(+1 I), 1(+2 I)
  // Q2: 5(+2 I), 4(+1 I), 2(+1 S), 1(+2 S)
  // Q4: 5(+2 I), 4(+1 I), 2(+1 S), 1(+2 S)
  // [보정]: S 긍정 문항(Q1 1개)과 I 긍정 문항(Q2·Q4 2개)의 수적 불균형을 보완하기 위해
  // Q3(개성 있는 식순·이벤트)에서 5점을 고르고 Q1도 긍정(4~5)이면 +1 S, Q3에서 1점(기본 식순만 빠르게)이면 +1 I 반영
  let sScore = 0;
  let iScore = 0;
  const q1Dir = getPart1Direction(answers.Q1, "S", "I");
  const q2Dir = getPart1Direction(answers.Q2, "I", "S");
  const q4Dir = getPart1Direction(answers.Q4, "I", "S");
  for (const d of [q1Dir, q2Dir, q4Dir]) {
    if (d.letter === "S") sScore += d.points;
    if (d.letter === "I") iScore += d.points;
  }
  if (answers.Q3 === 5 && (answers.Q1 === 4 || answers.Q1 === 5)) {
    sScore += 1;
  } else if (answers.Q3 === 1 && (answers.Q2 === 5 || answers.Q4 === 5)) {
    iScore += 1;
  }
  let axis1Winner: Axis1Letter;
  if (sScore > iScore) {
    axis1Winner = "S";
  } else if (iScore > sScore) {
    axis1Winner = "I";
  } else if (q2Dir.letter === "S" || q2Dir.letter === "I") {
    axis1Winner = q2Dir.letter;
  } else if (q1Dir.letter === "S" || q1Dir.letter === "I") {
    axis1Winner = q1Dir.letter;
  } else {
    axis1Winner = "I";
  }
  const axis1Pct = computeAxisPercentages(sScore, iScore);
  const axis1Tie = sScore === iScore;
  const axis1Nuance = axis1Tie
    ? "⚖️ 50:50 유연·균형형 (주인공 연출과 오붓한 교류를 상황에 맞춰 모두 즐기는 멀티 성향)"
    : answers.Q1 === 5 && axis1Winner === "I"
      ? "✨ 소규모로 오붓하게 모이되 입장 순간의 주인공 감동도 놓치지 않는 입체형"
      : undefined;

  // 축 2: D (Dream · 당일 로망파) vs P (Practical · 미래 실속파)
  // Q13: A(+4 D), B(+4 P)
  // Q5, Q8, Q9: 5(+2 D), 4(+1 D), 2(+1 P), 1(+2 P)
  // [보정]: Q13=B(미래 실속)를 명시적으로 고르고 하객 실속(Q6 교통·Q7 식사)에 5점을 준 경우,
  // 로망 문항 호감(5,5,4 -> +5 D) 때문에 실속 선택이 억울하게 역전되지 않도록 +1 P 보정.
  // 또한 Q6·Q7을 모두 5점으로 챙긴 순수 하객 실속파가 로망 중립일 때 P 점수가 반영되도록 보정.
  let dScore = 0;
  let pScore = 0;
  if (answers.Q13 === "A") dScore += 4;
  if (answers.Q13 === "B") pScore += 4;
  for (const qId of ["Q5", "Q8", "Q9"] as const) {
    const dir = getPart1Direction(answers[qId], "D", "P");
    if (dir.letter === "D") dScore += dir.points;
    if (dir.letter === "P") pScore += dir.points;
  }
  if (
    answers.Q13 === "B" &&
    dScore === 5 &&
    pScore === 4 &&
    (answers.Q6 === 5 || answers.Q7 === 5)
  ) {
    pScore += 1;
  } else if (
    answers.Q13 !== "A" &&
    dScore === 0 &&
    answers.Q6 === 5 &&
    answers.Q7 === 5
  ) {
    pScore += 2;
  }
  let axis2Winner: Axis2Letter;
  if (dScore > pScore) {
    axis2Winner = "D";
  } else if (pScore > dScore) {
    axis2Winner = "P";
  } else if (answers.Q13 === "A") {
    axis2Winner = "D";
  } else if (answers.Q13 === "B") {
    axis2Winner = "P";
  } else {
    axis2Winner = "P";
  }
  const axis2Pct = computeAxisPercentages(dScore, pScore);
  const axis2Tie = dScore === pScore;
  const axis2Nuance = axis2Tie
    ? "⚖️ 50:50 유연·균형형 (꼭 살릴 당일 로망과 결혼 후 실속의 황금 밸런스를 추구하는 성향)"
    : axis2Winner === "D" && (answers.Q6 === 5 || answers.Q7 === 5)
      ? "✨ 당일의 로망(D)은 물론 하객 대접(교통·식사)까지 놓치지 않는 배려 겸비형"
      : axis2Winner === "P" &&
          (answers.Q5 === 5 || answers.Q8 === 5 || answers.Q9 === 5)
        ? "✨ 전체 예산은 실속(P) 있게 지키되, 핵심 로망 1순위는 확실히 살리는 선택·집중형"
        : undefined;

  // 축 3: M (Manual · 직접 탐색·계획파) vs E (Easy · 압축·편의파)
  // Q11, Q12: 5(+2 M), 4(+1 M), 2(+1 E), 1(+2 E)
  // Q14: A(+3 M), B(+3 E) — 실제 행동 선택(발품 vs 대행)이 호기심 점수에 역전되지 않도록 +3 반영
  let mScore = 0;
  let eScore = 0;
  const q11Dir = getPart1Direction(answers.Q11, "M", "E");
  const q12Dir = getPart1Direction(answers.Q12, "M", "E");
  for (const d of [q11Dir, q12Dir]) {
    if (d.letter === "M") mScore += d.points;
    if (d.letter === "E") eScore += d.points;
  }
  if (answers.Q14 === "A") mScore += 3;
  if (answers.Q14 === "B") eScore += 3;

  let axis3Winner: Axis3Letter;
  if (mScore > eScore) {
    axis3Winner = "M";
  } else if (eScore > mScore) {
    axis3Winner = "E";
  } else if (answers.Q14 === "A") {
    axis3Winner = "M";
  } else if (answers.Q14 === "B") {
    axis3Winner = "E";
  } else if (q11Dir.letter === "M" || q11Dir.letter === "E") {
    axis3Winner = q11Dir.letter;
  } else {
    axis3Winner = "E";
  }
  const axis3Pct = computeAxisPercentages(mScore, eScore);
  const axis3Tie = mScore === eScore;
  const axis3Nuance =
    (q11Dir.letter === "M" || q12Dir.letter === "M") && answers.Q14 === "B"
      ? "💡 마음은 꼼꼼히 비교하고 싶지만(Q11·12), 현실 체력을 위해 전문가 압축(Q14)을 택한 스마트 선별형"
      : (q11Dir.letter === "E" || q12Dir.letter === "E") && answers.Q14 === "A"
        ? "💡 복잡한 탐색은 피하고 싶지만, 바가지 방지를 위해 핵심 발품(Q14)은 직접 챙기는 실속형"
        : axis3Tie
          ? "⚖️ 50:50 유연·균형형 (중요한 건 직접 비교하고 나머지는 전문가에게 맡기는 하이브리드 성향)"
          : undefined;

  // 축 4: H (Heart · 밀착 동행·공감파) vs R (Role · 역할 분담·해결파)
  // Q15: A(+3 H), B(+3 R)
  // Q19: A(+2 H), B(+2 R)
  let hScore = 0;
  let rScore = 0;
  if (answers.Q15 === "A") hScore += 3;
  if (answers.Q15 === "B") rScore += 3;
  if (answers.Q19 === "A") hScore += 2;
  if (answers.Q19 === "B") rScore += 2;

  let axis4Winner: Axis4Letter;
  if (hScore > rScore) {
    axis4Winner = "H";
  } else if (rScore > hScore) {
    axis4Winner = "R";
  } else {
    axis4Winner = "H";
  }
  const axis4Pct = computeAxisPercentages(hScore, rScore);
  const axis4Tie = hScore === rScore;
  const axis4Nuance = axis4Tie
    ? "⚖️ 50:50 유연·균형형 (다정한 공감 대화와 효율적인 역할 분담을 모두 잘하는 성향)"
    : (answers.Q15 === "A" && answers.Q19 === "B") ||
        (answers.Q15 === "B" && answers.Q19 === "A")
      ? "✨ 평엔 효율적인 분담과 감정적 유대감을 조화롭게 병행하는 외유내강형"
      : undefined;

  const code: WeddingCode19Code = `${axis1Winner}${axis2Winner}${axis3Winner}${axis4Winner}`;

  return {
    code,
    axes: {
      axis1: {
        axisNumber: 1,
        leftLetter: "S",
        leftLabel: "S (무대·주인공)",
        rightLetter: "I",
        rightLabel: "I (오붓·교류)",
        leftScore: sScore,
        rightScore: iScore,
        leftPercent: axis1Pct.leftPercent,
        rightPercent: axis1Pct.rightPercent,
        winner: axis1Winner,
        isBalancedTie: axis1Tie,
        nuanceBadge: axis1Nuance,
      },
      axis2: {
        axisNumber: 2,
        leftLetter: "D",
        leftLabel: "D (당일 로망)",
        rightLetter: "P",
        rightLabel: "P (미래 실속)",
        leftScore: dScore,
        rightScore: pScore,
        leftPercent: axis2Pct.leftPercent,
        rightPercent: axis2Pct.rightPercent,
        winner: axis2Winner,
        isBalancedTie: axis2Tie,
        nuanceBadge: axis2Nuance,
      },
      axis3: {
        axisNumber: 3,
        leftLetter: "M",
        leftLabel: "M (직접 탐색·계획)",
        rightLetter: "E",
        rightLabel: "E (압축·편의)",
        leftScore: mScore,
        rightScore: eScore,
        leftPercent: axis3Pct.leftPercent,
        rightPercent: axis3Pct.rightPercent,
        winner: axis3Winner,
        isBalancedTie: axis3Tie,
        nuanceBadge: axis3Nuance,
      },
      axis4: {
        axisNumber: 4,
        leftLetter: "H",
        leftLabel: "H (밀착 동행·공감)",
        rightLetter: "R",
        rightLabel: "R (역할 분담·해결)",
        leftScore: hScore,
        rightScore: rScore,
        leftPercent: axis4Pct.leftPercent,
        rightPercent: axis4Pct.rightPercent,
        winner: axis4Winner,
        isBalancedTie: axis4Tie,
        nuanceBadge: axis4Nuance,
      },
    },
  };
}

function buildHiddenPsychologyInsight19(
  answers: WeddingCode19Answers,
  axes: PersonalReport19["axes"],
): HiddenPsychologyInsight19 {
  const isS = axes.axis1.winner === "S";
  const isD = axes.axis2.winner === "D";
  const isM = axes.axis3.winner === "M";
  const isH = axes.axis4.winner === "H";

  const guestFirstHigh =
    (answers.Q6 === 4 || answers.Q6 === 5) && (answers.Q7 === 4 || answers.Q7 === 5);

  let unconsciousTitle = "";
  let unconsciousInsight = "";

  if (isD && isS) {
    unconsciousTitle = "평생 남을 ‘결정적 한 장면’을 통해 사랑과 축복을 확인하고 싶은 마음";
    unconsciousInsight =
      "겉으로는 화려한 공간이나 스타일링을 중시하는 것처럼 보이지만, 내면 깊은 곳에는 ‘인생의 가장 큰 전환점을 흐릿하게 흘려보내고 싶지 않다’는 열망이 있습니다. 나에게 결혼식은 단순한 행사가 아니라 두 사람의 서사를 세상에 선언하는 작품이기 때문에, 어중간하게 타협할 때 가장 큰 아쉬움을 느낍니다.";
  } else if (isD && !isS) {
    unconsciousTitle = "보여주기식 격식보다 ‘우리다운 취향의 밀도’를 지키고 싶은 마음";
    unconsciousInsight =
      "남들에게 과시하기 위한 화려함이 아니라, 우리 두 사람과 진짜 가까운 사람들이 머무는 공간의 공기·빛·감도를 온전히 내 취향으로 채우고 싶어 합니다. 억지로 꾸며낸 어색한 예식보다 ‘정말 두 사람답다’는 한마디가 내면의 가장 큰 만족감을 줍니다.";
  } else if (!isD && guestFirstHigh) {
    unconsciousTitle = "초대한 사람들에게 ‘불편이나 아쉬움을 빚지고 싶지 않은’ 다정한 책임감";
    unconsciousInsight =
      "스스로를 ‘그냥 현실적인 사람’이라고 생각하기 쉽지만, 실제로는 귀한 주말 시간을 내어 찾아와 준 손님들이 주차나 식사 때문에 눈살을 찌푸릴까 봐 마음 쓰는 배려심이 매우 깊습니다. 내 화려함보다 ‘하객이 대접받았다고 느끼는 안정감’과 ‘결혼 후 두 사람의 탄탄한 현실 기반’이 마음을 가장 편하게 만듭니다.";
  } else {
    unconsciousTitle = "하루의 이벤트보다 ‘결혼식 다음 날부터 시작될 일상의 여유’를 지키는 보호 본능";
    unconsciousInsight =
      "결혼식 당일의 짧은 몇 시간 때문에 두 사람의 체력이나 신혼 자금이 무리하게 소진되는 것을 본능적으로 경계합니다. 설렘이 부족해서가 아니라, ‘진짜 행복은 식장 문을 나선 뒤의 삶에 있다’는 확고한 내면의 기준이 있기 때문에 거품을 걷어낼 때 오히려 심리적 해방감을 느낍니다.";
  }

  let blindSpotTitle = "";
  let blindSpotInsight = "";

  if (isM && answers.Q17 === "A") {
    blindSpotTitle = "불안할수록 ‘빨리 확정 지어야 안심되는’ 과속 결정 모드";
    blindSpotInsight =
      "알아볼 것이 쌓이면 머릿속 불확실성을 견디기 힘들어, 후기와 조건표를 파고들며 당장 결론을 내리려 합니다. 이때 나만큼 빠르게 반응하지 않거나 ‘천천히 생각해보자’고 하는 파트너를 보면, 나도 모르게 ‘나만 이 결혼에 진심인가?’라는 서운함으로 번질 수 있으니 속도를 늦추는 연습이 필요합니다.";
  } else if (isM && answers.Q17 !== "A") {
    blindSpotTitle = "후회하기 싫어 완벽한 정답을 찾다가 스스로 지쳐버리는 ‘탐색 과부하’";
    blindSpotInsight =
      "내 눈으로 직접 비교해야 마음이 놓이지만, 동시에 지친 상태에서 성급히 결정하는 것도 싫어합니다. 그 결과 ‘더 나은 후보가 있지 않을까?’ 하며 선택지를 계속 열어두다가 결정 피로가 한꺼번에 몰려올 수 있습니다. 상위 3개 후보만 남기면 검색창을 닫는 기준선이 나를 지켜줍니다.";
  } else if (!isM && answers.Q17 === "B") {
    blindSpotTitle = "정보가 넘치면 무의식적으로 스위치를 끄는 ‘동굴 속 일시정지 모드’";
    blindSpotInsight =
      "세부 조건 비교나 복잡한 일정 압박이 몰려오면, 싸우거나 후회하는 선택을 피하려고 무의식적으로 결정을 미루거나 한발 물러섭니다. 내 안에서는 에너지를 충전하려는 자연스러운 방어 반응이지만, 파트너 눈에는 ‘관심이 없거나 책임을 미루는 모습’으로 오해받기 쉽습니다.";
  } else {
    blindSpotTitle = "복잡한 과정을 건너뛰고 ‘단순 명쾌한 결론’으로 직행하려는 생략 본능";
    blindSpotInsight =
      "긴 탐색과 감정 소모를 아끼고 핵심만 빠르게 결정하는 능력이 탁월합니다. 다만 과정 자체에서 설렘과 유대감을 느끼는 파트너와 함께할 때는, 나의 시원시원한 속도감이 상대에게는 ‘충분히 상의하지 않고 해치워버리는 느낌’을 줄 수 있다는 점을 기억하면 좋습니다.";
  }

  const selfDiscoveryQuestion = isH
    ? "“나는 결혼식 결과물 그 자체보다, 준비하는 내내 ‘우리가 같은 온도에서 함께 설레고 있는가’를 확인받고 싶어 하지 않나요?”"
    : "“나는 사랑과 배려를 ‘감정 표현’보다 ‘예산과 역할을 깔끔하게 정리해 두 사람의 시행착오를 줄여주는 것’으로 표현하고 있지 않나요?”";

  const partnerTranslations: PartnerTranslationItem19[] = [];
  if (isH) {
    partnerTranslations.push({
      whenISay: "“이것도 같이 보고 골라주면 안 돼? 넌 어떤 게 더 좋아?”",
      whatIReallyMean:
        "결정을 못 해서가 아니라, 너와 취향을 나누며 함께 결혼을 만들어가는 ‘우리의 추억과 연결감’을 느끼고 싶다는 뜻이에요.",
    });
  } else {
    partnerTranslations.push({
      whenISay: "“이건 각자 맡아서 추려오자. 예산이랑 조건표부터 먼저 맞춰보자.”",
      whatIReallyMean:
        "설렘이 없거나 차가워서가 아니라, 두 사람이 공연히 지치거나 싸우지 않도록 ‘현실적인 안전망’을 먼저 만들어주고 싶다는 뜻이에요.",
    });
  }

  if (answers.Q18 === "A") {
    partnerTranslations.push({
      whenISay: "“나 방금 이 부분은 좀 서운했어. 지금 바로 얘기해 줄 수 있어?”",
      whatIReallyMean:
        "당신을 공격하려는 게 아니라, 내 마음속에 앙금이 커지기 전에 빨리 털어내고 다시 다정한 우리로 돌아가고 싶다는 신호예요.",
    });
  } else {
    partnerTranslations.push({
      whenISay: "“지금은 좀 지치니까 나중에 생각 정리하고 다시 얘기하자.”",
      whatIReallyMean:
        "대화를 회피하거나 무시하는 게 아니라, 감정이 앞선 말로 당신에게 상처 주지 않기 위해 내 마음을 정돈할 시간이 잠시 필요하다는 뜻이에요.",
    });
  }

  return {
    unconsciousTitle,
    unconsciousInsight,
    blindSpotTitle,
    blindSpotInsight,
    selfDiscoveryQuestion,
    partnerTranslations,
  };
}

function buildCoupleEmpathyBridge19(
  myReport: PersonalReport19,
  partnerReport: PersonalReport19,
  myAnswers: WeddingCode19Answers,
  partnerAnswers: WeddingCode19Answers,
): CoupleEmpathyBridge19 {
  const myAxes = myReport.axes;
  const pAxes = partnerReport.axes;

  const translations: CoupleEmpathyTranslation19[] = [];

  if (myAxes.axis2.winner !== pAxes.axis2.winner) {
    const meIsD = myAxes.axis2.winner === "D";
    translations.push({
      triggerSituation: "예식 당일 로망(D) vs 결혼 후 실속(P) 예산 대화를 나눌 때",
      myInnerThought: meIsD
        ? "‘평생 한 번뿐인 날인데, 내 로망을 단순히 돈 아까운 사치로 생각하면 어쩌지?’ 하는 불안"
        : "‘하루 몇 시간에 무리했다가 결혼 후 우리 현실 생활이 빠듯해지면 어쩌지?’ 하는 보호 본능",
      partnerInnerThought: meIsD
        ? "‘당신 로망을 무시하는 게 아니라, 우리가 결혼 후에도 여유롭게 행복하길 바라서 총액을 지키려는 거야.’"
        : "‘현실을 모르는 게 아니라, 평생 기억할 딱 한두 가지 장면만큼은 후회 없이 남기고 싶은 거야.’",
      bridgePrescription:
        "실속파는 파트너의 1순위 로망 1~2가지를 ‘예외적 전액 지지 구역’으로 먼저 인정해주고, 로망파는 나머지 항목에서 과감히 기본형을 선택해 총예산 상한선을 지켜주세요.",
    });
  }

  if (myAxes.axis3.winner !== pAxes.axis3.winner) {
    const meIsM = myAxes.axis3.winner === "M";
    translations.push({
      triggerSituation: "업체 후기 비교·일정표 작성(M) vs 전문가 추천·편의(E) 방식이 부딪힐 때",
      myInnerThought: meIsM
        ? "‘직접 비교해보지 않고 덜컥 계약했다가 바가지를 쓰거나 후회하면 어떡하지?’"
        : "‘일도 바쁜데 주말마다 수십 개 업체를 비교하다가 결혼식 전에 둘 다 지쳐 쓰러지면 어떡하지?’",
      partnerInnerThought: meIsM
        ? "‘관심이 없는 게 아니라, 우리의 시간과 에너지를 아껴서 좋은 컨디션으로 준비하고 싶은 거야.’"
        : "‘당신을 못 믿어서가 아니라, 내 눈으로 데이터를 확인해야 불안이 가라앉는 내 안전장치야.’",
      bridgePrescription:
        "직접 탐색파(M)가 꼼꼼히 비교해 최종 후보 2~3곳으로 압축하면, 편의파(E)는 그 노고에 진심으로 고마움을 표현하고 최종 결정을 시원하게 함께 내려주세요.",
    });
  }

  if (myAxes.axis4.winner !== pAxes.axis4.winner || myAnswers.Q18 !== partnerAnswers.Q18) {
    const meIsH = myAxes.axis4.winner === "H";
    translations.push({
      triggerSituation: "함께하는 준비 과정·감정 공감(H) vs 효율적 역할 분담·해결책(R)이 엇갈릴 때",
      myInnerThought: meIsH
        ? "‘결혼 준비를 숙제 해치우듯 나누어 처리하면, 우리가 함께 설레는 시간은 어디서 찾지?’"
        : "‘감정 이야기만 길어지고 결론이 안 나면 남은 일정이 밀릴 텐데, 빨리 해결책부터 찾아야 하지 않나?’",
      partnerInnerThought: meIsH
        ? "‘당신과 함께하기 싫은 게 아니라, 실무를 깔끔히 분담해 두 사람의 피로를 줄여주려는 내 방식의 사랑이야.’"
        : "‘효율을 모르는 게 아니라, 내 마음을 먼저 3분만 공감해주면 나도 현실적인 타협안을 기꺼이 받아들일 수 있어.’",
      bridgePrescription:
        "의견이 막히면 첫 5분은 해결책 제시를 멈추고 ‘왜 그게 중요했는지’ 마음부터 들어준 뒤(H 충족), 다음 10분 동안 예산·일정 표를 펴고 1:1 절충안을 확정하세요(R 충족).",
    });
  }

  if (translations.length === 0) {
    translations.push({
      triggerSituation: "두 사람의 핵심 축이 비슷해 빠르게 합의가 이루어질 때",
      myInnerThought:
        "‘우린 성향이 정말 잘 맞네! 내가 생각한 방향을 파트너도 똑같이 원하고 있구나.’",
      partnerInnerThought:
        "‘큰 방향은 같지만, 둘 다 같은 쪽으로만 달리면 우리가 함께 놓치는 사각지대(예산 상한선 또는 휴식 타이밍)가 생길 수 있어.’",
      bridgePrescription:
        "성향이 닮은 커플일수록 갈등은 적지만 브레이크가 약할 수 있습니다. ‘예산 상한선 확인’이나 ‘일주일에 하루 웨딩 이야기 쉬기’ 중 우리에게 부족한 반대쪽 안전장치를 하나만 약속해 두세요.",
    });
  }

  return {
    headline: "서로의 행동을 오해하지 않게 돕는 ‘두 사람의 속마음 번역기’",
    myHiddenNeed: myReport.hiddenPsychology.unconsciousTitle,
    partnerHiddenNeed: partnerReport.hiddenPsychology.unconsciousTitle,
    translations,
  };
}

export function buildPersonalReport19(
  answers: WeddingCode19Answers,
  topPriorityIds: readonly QuestionId[] = [],
): PersonalReport19 {
  const { code, axes } = scoreWeddingCode19(answers);
  const character = CHARACTER_PROFILES_19[code];
  const topPrioritySet = new Set<QuestionId>(topPriorityIds);

  const mustHave5: BasketItemEntry[] = [];
  const niceToHave4: BasketItemEntry[] = [];
  const saveSimplify12: BasketItemEntry[] = [];
  const concession3D: BasketItemEntry[] = [];
  const balancedC: BasketItemEntry[] = [];
  const undecidedUnknownE: BasketItemEntry[] = [];
  const hiddenQuestionIds: QuestionId[] = [];

  const allVisibleEntries = new Map<QuestionId, BasketItemEntry>();

  for (const q of ALL_QUESTIONS_19) {
    const rawAns = answers[q.id];
    if (rawAns === undefined) continue;

    // NA (➖ 해당 없다) 및 F (해당 없다) 선택 문항은 결과 리포트에서 완전히 숨김 처리
    if (rawAns === "NA" || rawAns === "F") {
      hiddenQuestionIds.push(q.id);
      continue;
    }

    const entry: BasketItemEntry = {
      questionId: q.id,
      questionNumber: q.number,
      category: q.category,
      shortTitle: ITEM_INTERPRETATIONS_19[q.id].shortTitle,
      answer: rawAns,
      answerBadge: formatAnswerBadge19(rawAns),
      interpretation: getItemInterpretationText19(q.id, rawAns),
      isTopPriority: topPrioritySet.has(q.id) && rawAns === 5,
    };

    allVisibleEntries.set(q.id, entry);

    if (rawAns === 5) {
      mustHave5.push(entry);
    } else if (rawAns === 4) {
      niceToHave4.push(entry);
    } else if (rawAns === 1 || rawAns === 2) {
      saveSimplify12.push(entry);
    } else if (rawAns === 3 || rawAns === "D") {
      concession3D.push(entry);
    } else if (rawAns === "C") {
      balancedC.push(entry);
    } else if (rawAns === "UNKNOWN" || rawAns === "E") {
      undecidedUnknownE.push(entry);
    }
  }

  // 타협 불가 1순위 배지가 부여된 항목을 mustHave5 최상단에 우선 정렬
  mustHave5.sort((a, b) => Number(b.isTopPriority) - Number(a.isTopPriority));

  const topPriorityItems = mustHave5.filter((item) => item.isTopPriority);

  // [상대적 후순위 절약 후보 산출]:
  // 사용자가 ①·②를 하나도 고르지 않아 saveSimplify12가 비어 있더라도,
  // 당일 핵심 가치(Q5~Q10) 및 무대(Q1~Q4) 중 상대적으로 낮은 점수(③ 또는 ⑤ 대비 ④)를 준 항목을 찾아
  // '내가 미처 몰랐던 상대적 힘 빼기 후보'로 안내한다.
  const relativeSaveSuggestions: BasketItemEntry[] = [];
  if (saveSimplify12.length === 0) {
    const candidateIds: readonly QuestionId[] = [
      "Q5",
      "Q6",
      "Q7",
      "Q8",
      "Q9",
      "Q10",
      "Q3",
    ];
    for (const qId of candidateIds) {
      const entry = allVisibleEntries.get(qId);
      if (!entry) continue;
      if (entry.answer === 3) {
        relativeSaveSuggestions.push({
          ...entry,
          interpretation: getItemInterpretationText19(qId, 2),
        });
      }
    }
    if (relativeSaveSuggestions.length === 0 && mustHave5.length > 0) {
      for (const qId of candidateIds) {
        const entry = allVisibleEntries.get(qId);
        if (!entry) continue;
        if (entry.answer === 4) {
          relativeSaveSuggestions.push({
            ...entry,
            interpretation: getItemInterpretationText19(qId, 2),
          });
        }
      }
    }
  }

  const pickSectionItems = (ids: readonly QuestionId[]): BasketItemEntry[] =>
    ids
      .map((id) => allVisibleEntries.get(id))
      .filter((item): item is BasketItemEntry => item !== undefined);

  const workstyleSections: WorkstyleManualSection[] = [
    {
      sectionId: "stage",
      title: "내가 그리는 예식 무대 (Q1~Q4)",
      subtitle: "주목도·규모·이벤트·하객 교류 방식",
      items: pickSectionItems(["Q1", "Q2", "Q3", "Q4"]),
    },
    {
      sectionId: "planning",
      title: "탐색·일정·예산·발품 스타일 (Q11~Q14)",
      subtitle: "정보 비교·사전 계획·예산 배분·발품 vs 편의",
      items: pickSectionItems(["Q11", "Q12", "Q13", "Q14"]),
    },
    {
      sectionId: "collaboration",
      title: "협업 및 양가 소통 공식 (Q15~Q16)",
      subtitle: "파트너 동행 vs 분담·양가 어른 상의 순서",
      items: pickSectionItems(["Q15", "Q16"]),
    },
    {
      sectionId: "crisis",
      title: "번아웃 대처 및 갈등 대화법 (Q17~Q19)",
      subtitle: "피로 회복 템포·서운할 때 타이밍·의견 충돌 대화 순서",
      items: pickSectionItems(["Q17", "Q18", "Q19"]),
    },
  ];

  const hiddenPsychology = buildHiddenPsychologyInsight19(answers, axes);

  return {
    code,
    character,
    axes,
    topPriorityIds: topPriorityItems.map((i) => i.questionId),
    topPriorityItems,
    basket: {
      mustHave5,
      niceToHave4,
      saveSimplify12,
      relativeSaveSuggestions: relativeSaveSuggestions.slice(0, 3),
      concession3D,
      balancedC,
      undecidedUnknownE,
      hiddenQuestionIds,
    },
    workstyleSections,
    hiddenPsychology,
  };
}

function getCanonicalSynergyKey(
  axis: 1 | 2 | 3 | 4,
  a: string,
  b: string,
): string {
  if (a === b) return `${a}+${b}`;
  if (axis === 1) return "S+I";
  if (axis === 2) return "D+P";
  if (axis === 3) return "M+E";
  return "H+R";
}

function isDefinitePreference(ans: WeddingCode19AnswerValue | undefined): boolean {
  return ans === 1 || ans === 2 || ans === 4 || ans === 5 || ans === "A" || ans === "B";
}

function isConcessionChoice(ans: WeddingCode19AnswerValue | undefined): boolean {
  return ans === 3 || ans === "D";
}

function isUndecidedChoice(ans: WeddingCode19AnswerValue | undefined): boolean {
  return ans === "UNKNOWN" || ans === "E";
}

function isPart2BalanceGap(
  qId: QuestionId,
  myAns: WeddingCode19AnswerValue | undefined,
  partnerAns: WeddingCode19AnswerValue | undefined,
): boolean {
  const spec = QUESTION_MAP_19[qId];
  if (spec.part !== 2) return false;
  return (
    ((myAns === "A" || myAns === "B") && partnerAns === "C") ||
    (myAns === "C" && (partnerAns === "A" || partnerAns === "B"))
  );
}

function isOppositeDirection(
  qId: QuestionId,
  myAns: WeddingCode19AnswerValue | undefined,
  partnerAns: WeddingCode19AnswerValue | undefined,
): boolean {
  const spec = QUESTION_MAP_19[qId];
  if (spec.part === 1) {
    const myPos = myAns === 4 || myAns === 5;
    const myNeg = myAns === 1 || myAns === 2;
    const partPos = partnerAns === 4 || partnerAns === 5;
    const partNeg = partnerAns === 1 || partnerAns === 2;
    return (myPos && partNeg) || (myNeg && partPos);
  }
  return (myAns === "A" && partnerAns === "B") || (myAns === "B" && partnerAns === "A");
}

function isSameDirection(
  qId: QuestionId,
  myAns: WeddingCode19AnswerValue | undefined,
  partnerAns: WeddingCode19AnswerValue | undefined,
): boolean {
  const spec = QUESTION_MAP_19[qId];
  if (spec.part === 1) {
    const bothPos = (myAns === 4 || myAns === 5) && (partnerAns === 4 || partnerAns === 5);
    const bothNeg = (myAns === 1 || myAns === 2) && (partnerAns === 1 || partnerAns === 2);
    return bothPos || bothNeg;
  }
  return (
    (myAns === "A" && partnerAns === "A") ||
    (myAns === "B" && partnerAns === "B") ||
    (myAns === "C" && partnerAns === "C")
  );
}

export function buildCoupleComparison19(
  myAnswers: WeddingCode19Answers,
  partnerAnswers: WeddingCode19Answers,
  myTopPriorities: readonly QuestionId[] = [],
  partnerTopPriorities: readonly QuestionId[] = [],
): CoupleComparisonReport19 {
  const myReport = buildPersonalReport19(myAnswers, myTopPriorities);
  const partnerReport = buildPersonalReport19(partnerAnswers, partnerTopPriorities);

  const axisSynergies: AxisSynergyEntry[] = [
    COUPLE_AXIS_SYNERGY_19[
      getCanonicalSynergyKey(1, myReport.axes.axis1.winner, partnerReport.axes.axis1.winner)
    ],
    COUPLE_AXIS_SYNERGY_19[
      getCanonicalSynergyKey(2, myReport.axes.axis2.winner, partnerReport.axes.axis2.winner)
    ],
    COUPLE_AXIS_SYNERGY_19[
      getCanonicalSynergyKey(3, myReport.axes.axis3.winner, partnerReport.axes.axis3.winner)
    ],
    COUPLE_AXIS_SYNERGY_19[
      getCanonicalSynergyKey(4, myReport.axes.axis4.winner, partnerReport.axes.axis4.winner)
    ],
  ];

  const alignedItems: CoupleAlignedItem[] = [];
  const concessionMatches: CoupleConcessionMatch[] = [];
  const conflictItems: CoupleConflictItem[] = [];
  const crisisWarnings: CoupleConflictItem[] = [];

  const myTopSet = new Set(myReport.topPriorityIds);
  const partnerTopSet = new Set(partnerReport.topPriorityIds);
  const q13Opposite = isOppositeDirection("Q13", myAnswers.Q13, partnerAnswers.Q13);

  for (const q of ALL_QUESTIONS_19) {
    const myAns = myAnswers[q.id];
    const partnerAns = partnerAnswers[q.id];
    if (myAns === undefined || partnerAns === undefined) continue;
    if (myAns === "NA" || myAns === "F" || partnerAns === "NA" || partnerAns === "F") {
      continue;
    }

    const shortTitle = ITEM_INTERPRETATIONS_19[q.id].shortTitle;

    if (isSameDirection(q.id, myAns, partnerAns)) {
      alignedItems.push({
        questionId: q.id,
        questionNumber: q.number,
        category: q.category,
        shortTitle,
        myAnswerBadge: formatAnswerBadge19(myAns),
        partnerAnswerBadge: formatAnswerBadge19(partnerAns),
        sharedInterpretation: getItemInterpretationText19(
          q.id,
          myAns === 5 || partnerAns === 5 ? 5 : myAns,
        ),
      });

      // [태클 2 방어]: 둘 다 긍정(4~5)이지만 한쪽은 [타협 불가 1순위(⑤)]이고 다른 쪽은 ④(여건 되면)이면서
      // Q13 예산 배분 철학(A 당일 투자 vs B 미래 실속)이 반대인 경우, 예산 배분 시 온도차가 발생하므로
      // 1:1 조율 처방전도 함께 확인할 수 있게 conflictItems에 보조 추가한다.
      const hasTopPriorityTemperatureGap =
        q13Opposite &&
        ((myTopSet.has(q.id) && myAns === 5 && partnerAns === 4) ||
          (partnerTopSet.has(q.id) && partnerAns === 5 && myAns === 4));

      if (hasTopPriorityTemperatureGap) {
        conflictItems.push({
          questionId: q.id,
          questionNumber: q.number,
          category: q.category,
          shortTitle,
          myAnswerBadge: formatAnswerBadge19(myAns),
          myStance: getItemInterpretationText19(q.id, myAns),
          partnerAnswerBadge: formatAnswerBadge19(partnerAns),
          partnerStance: getItemInterpretationText19(q.id, partnerAns),
          conflictSolution: ITEM_INTERPRETATIONS_19[q.id].conflictSolution,
          myTopPriority: myTopSet.has(q.id),
          partnerTopPriority: partnerTopSet.has(q.id),
          conflictType: "priority_gap",
        });
      }
    } else if (isConcessionChoice(myAns) && (isDefinitePreference(partnerAns) || partnerAns === "C")) {
      concessionMatches.push({
        questionId: q.id,
        questionNumber: q.number,
        category: q.category,
        shortTitle,
        yielder: "me",
        preferredBy: "partner",
        preferredAnswerBadge: formatAnswerBadge19(partnerAns),
        preferredInterpretation: getItemInterpretationText19(q.id, partnerAns),
        matchType: "concession",
      });
    } else if ((isDefinitePreference(myAns) || myAns === "C") && isConcessionChoice(partnerAns)) {
      concessionMatches.push({
        questionId: q.id,
        questionNumber: q.number,
        category: q.category,
        shortTitle,
        yielder: "partner",
        preferredBy: "me",
        preferredAnswerBadge: formatAnswerBadge19(myAns),
        preferredInterpretation: getItemInterpretationText19(q.id, myAns),
        matchType: "concession",
      });
    } else if (isUndecidedChoice(myAns) && (isDefinitePreference(partnerAns) || partnerAns === "C")) {
      // [태클 8 방어]: 나는 아직 모르겠다(⚪/E)인데 파트너는 확고한 기준이 있는 경우 증발하지 않고 리드 카드로 안내
      concessionMatches.push({
        questionId: q.id,
        questionNumber: q.number,
        category: q.category,
        shortTitle,
        yielder: "me",
        preferredBy: "partner",
        preferredAnswerBadge: formatAnswerBadge19(partnerAns),
        preferredInterpretation: `${getItemInterpretationText19(q.id, partnerAns)} (나는 아직 미정 상태이므로 기준이 뚜렷한 파트너가 자연스럽게 리드해 설명해주면 갈등 없이 합의됩니다.)`,
        matchType: "lead_undecided",
      });
    } else if ((isDefinitePreference(myAns) || myAns === "C") && isUndecidedChoice(partnerAns)) {
      // [태클 8 방어]: 나는 확고한 기준이 있는데 파트너는 아직 모르겠다(⚪/E)인 경우
      concessionMatches.push({
        questionId: q.id,
        questionNumber: q.number,
        category: q.category,
        shortTitle,
        yielder: "partner",
        preferredBy: "me",
        preferredAnswerBadge: formatAnswerBadge19(myAns),
        preferredInterpretation: `${getItemInterpretationText19(q.id, myAns)} (파트너는 반대하는 것이 아니라 아직 생각해 본 적 없는 빈칸 상태이므로, 내가 원하는 이유를 다정하게 먼저 소개해 주세요.)`,
        matchType: "lead_undecided",
      });
    } else if (
      isOppositeDirection(q.id, myAns, partnerAns) ||
      isPart2BalanceGap(q.id, myAns, partnerAns)
    ) {
      // [태클 7 방어]: 정반대(4~5 vs 1~2, A vs B)뿐 아니라 파트 2에서 A/B(확고) vs C(반반 절충)가 엇갈린 경우도
      // 증발시키지 않고 조율 포인트 & 1:1 처방전에 포함시킨다.
      const isOpp = isOppositeDirection(q.id, myAns, partnerAns);
      const conflictEntry: CoupleConflictItem = {
        questionId: q.id,
        questionNumber: q.number,
        category: q.category,
        shortTitle,
        myAnswerBadge: formatAnswerBadge19(myAns),
        myStance: getItemInterpretationText19(q.id, myAns),
        partnerAnswerBadge: formatAnswerBadge19(partnerAns),
        partnerStance: getItemInterpretationText19(q.id, partnerAns),
        conflictSolution: ITEM_INTERPRETATIONS_19[q.id].conflictSolution,
        myTopPriority: myTopSet.has(q.id),
        partnerTopPriority: partnerTopSet.has(q.id),
        conflictType: isOpp ? "opposite" : "balance_gap",
      };
      conflictItems.push(conflictEntry);
      if (q.id === "Q17" || q.id === "Q18") {
        crisisWarnings.push(conflictEntry);
      }
    } else {
      // [태클 9 방어]: 두 사람 모두 ③/D(양보 가능) 또는 ⚪/E(아직 모르겠다)를 고른 문항도 누락 없이 가이드 제공
      const bothConcession = isConcessionChoice(myAns) && isConcessionChoice(partnerAns);
      alignedItems.push({
        questionId: q.id,
        questionNumber: q.number,
        category: q.category,
        shortTitle,
        myAnswerBadge: formatAnswerBadge19(myAns),
        partnerAnswerBadge: formatAnswerBadge19(partnerAns),
        sharedInterpretation: bothConcession
          ? "두 사람 모두 어느 쪽이든 괜찮다고 답한 항목입니다! 서로 결정을 미루느라 시간을 쓰지 말고 가장 무난한 기본형(가성비 표준 옵션)으로 즉시 확정해 에너지를 아끼세요."
          : "두 사람 모두 아직 구체적인 기준을 정하지 않은 백지상태 항목입니다. 처음부터 완벽히 정하려 애쓰지 말고, 기본 견적을 먼저 받아본 뒤 함께 기준을 세워보세요.",
      });
    }
  }

  const empathyBridge = buildCoupleEmpathyBridge19(
    myReport,
    partnerReport,
    myAnswers,
    partnerAnswers,
  );

  return {
    myReport,
    partnerReport,
    axisSynergies,
    empathyBridge,
    crisisWarnings,
    alignedItems,
    concessionMatches,
    conflictItems,
  };
}

// URL ?partner= 파라미터 직렬화·역직렬화
// 19개 문항 응답 + 타협 불가 1순위 2개 항목을 간결하고 안전한 문자열로 인코딩
const PART1_TOKEN_TO_VAL: Readonly<Record<string, Part1AnswerValue>> = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  U: "UNKNOWN",
  N: "NA",
};

const PART1_VAL_TO_TOKEN = (v: WeddingCode19AnswerValue | undefined): string => {
  if (v === 1 || v === 2 || v === 3 || v === 4 || v === 5) return String(v);
  if (v === "UNKNOWN") return "U";
  if (v === "NA") return "N";
  return "3";
};

const PART2_VALID_SET = new Set<string>(["A", "B", "C", "D", "E", "F"]);

export interface EncodedPartnerPayload19 {
  answers: WeddingCode19Answers;
  topPriorityIds: QuestionId[];
}

export function encodePartnerPayload19(
  answers: WeddingCode19Answers,
  topPriorityIds: readonly QuestionId[] = [],
): string {
  const chars: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const qId = `Q${i}` as QuestionId;
    chars.push(PART1_VAL_TO_TOKEN(answers[qId]));
  }
  for (let i = 13; i <= 19; i++) {
    const qId = `Q${i}` as QuestionId;
    const val = answers[qId];
    chars.push(typeof val === "string" && PART2_VALID_SET.has(val) ? val : "D");
  }
  const validTop = topPriorityIds
    .filter((id) => CEILING_CHECK_QUESTION_IDS.includes(id) && answers[id] === 5)
    .slice(0, 2);
  if (validTop.length > 0) {
    return `${chars.join("")}.${validTop.join(",")}`;
  }
  return chars.join("");
}

export function decodePartnerPayload19(
  raw: string | null | undefined,
): EncodedPartnerPayload19 | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const [answerPart, topPart] = trimmed.split(".");
  if (!answerPart || answerPart.length !== 19) return null;

  const answers: WeddingCode19Answers = {};
  for (let i = 0; i < 12; i++) {
    const ch = answerPart[i].toUpperCase();
    const mapped = PART1_TOKEN_TO_VAL[ch];
    if (!mapped) return null;
    answers[`Q${i + 1}` as QuestionId] = mapped;
  }
  for (let i = 12; i < 19; i++) {
    const ch = answerPart[i].toUpperCase();
    if (!PART2_VALID_SET.has(ch)) return null;
    const qId = `Q${i + 1}` as QuestionId;
    // F는 Q13, Q16에서만 유효
    if (ch === "F" && qId !== "Q13" && qId !== "Q16") return null;
    answers[qId] = ch as Part2AnswerValue;
  }

  const topPriorityIds: QuestionId[] = [];
  if (topPart) {
    for (const token of topPart.split(",")) {
      const candidate = token.trim().toUpperCase() as QuestionId;
      if (
        CEILING_CHECK_QUESTION_IDS.includes(candidate) &&
        answers[candidate] === 5 &&
        !topPriorityIds.includes(candidate)
      ) {
        topPriorityIds.push(candidate);
      }
    }
  }

  return {
    answers,
    topPriorityIds: topPriorityIds.slice(0, 2),
  };
}

/**
 * [가상 파트너 선택해서 커플 리포트 미리보기] 시뮬레이터용 프리셋 생성기.
 * 선택한 4자리 동물 캐릭터 코드(예: "SDMH" ~ "IPER")가 정확히 산출되면서
 * 현실적인 응답 분포를 가진 19문항 답변 세트를 반환한다.
 */
export function createVirtualPartnerAnswers19(
  targetCode: WeddingCode19Code,
): EncodedPartnerPayload19 {
  const isS = targetCode[0] === "S";
  const isD = targetCode[1] === "D";
  const isM = targetCode[2] === "M";
  const isH = targetCode[3] === "H";

  const answers: WeddingCode19Answers = {
    Q1: isS ? 5 : 2,
    Q2: isS ? 2 : 5,
    Q3: isD ? 4 : 2,
    Q4: isS ? 2 : 5,
    Q5: isD ? 5 : 2,
    Q6: isD ? 3 : 5,
    Q7: isS ? 5 : 4,
    Q8: isD ? 5 : 2,
    Q9: isD ? 4 : 1,
    Q10: isS ? 4 : 2,
    Q11: isM ? 5 : 2,
    Q12: isM ? 5 : 1,
    Q13: isD ? "A" : "B",
    Q14: isM ? "A" : "B",
    Q15: isH ? "A" : "B",
    Q16: isS ? "A" : "B",
    Q17: isM ? "A" : "B",
    Q18: isH ? "A" : "B",
    Q19: isH ? "A" : "B",
  };

  const topPriorityIds: QuestionId[] = isD ? ["Q5", "Q8"] : ["Q6", "Q7"];
  return { answers, topPriorityIds };
}

/**
 * 웨딩코드 19문항 결과(개인 또는 커플 비교)를 바탕으로
 * AI 웨딩 비서 아모라에게 전달할 맞춤 첫 상담 프롬프트를 생성한다.
 */
export function buildWeddingCode19AmoraPrefill(
  personalReport: PersonalReport19,
  coupleReport?: CoupleComparisonReport19 | null,
): string {
  if (coupleReport) {
    const myChar = `${coupleReport.myReport.character.characterName}(${coupleReport.myReport.code})`;
    const partnerChar = `${coupleReport.partnerReport.character.characterName}(${coupleReport.partnerReport.code})`;
    const alignedTitles = coupleReport.alignedItems.slice(0, 3).map((item) => item.shortTitle);
    const conflictTitles = coupleReport.conflictItems.slice(0, 3).map((item) => item.shortTitle);
    const concessionTitles = coupleReport.concessionMatches.slice(0, 2).map((item) => item.shortTitle);

    const parts: string[] = [
      `우리 커플 웨딩코드는 [${myChar} × ${partnerChar}] 조합이야.`,
    ];
    if (alignedTitles.length > 0) {
      parts.push(`둘 다 생각이 통하는 항목은 '${alignedTitles.join("·")}'이고,`);
    }
    if (concessionTitles.length > 0) {
      parts.push(`서로 양보 가능한 항목은 '${concessionTitles.join("·")}'이야.`);
    }
    if (conflictTitles.length > 0) {
      parts.push(`반면 '${conflictTitles.join("·")}'에서는 의견이 달라서 조율이 필요해.`);
    }
    parts.push(
      "두 사람의 성향에 맞춰 감정 소모 없이 합의하는 대화법과 지금 먼저 시작할 결혼 준비 순서를 정리해줘.",
    );
    return parts.join(" ").slice(0, 560);
  }

  const charLabel = `${personalReport.character.characterName}(${personalReport.code} · ${personalReport.character.codeTag})`;
  const mustHaveTitles = personalReport.basket.mustHave5
    .slice(0, 3)
    .map((item) => (item.isTopPriority ? `${item.shortTitle}(타협 불가 1순위)` : item.shortTitle));
  const saveTitles = personalReport.basket.saveSimplify12.slice(0, 3).map((item) => item.shortTitle);
  const concessionTitles = personalReport.basket.concession3D.slice(0, 2).map((item) => item.shortTitle);

  const parts: string[] = [
    `방금 웨딩코드 테스트를 했는데 내 유형은 [${charLabel}]이야.`,
  ];
  if (mustHaveTitles.length > 0) {
    parts.push(`꼭 챙기고 싶은 1순위는 '${mustHaveTitles.join("·")}'이고,`);
  }
  if (saveTitles.length > 0) {
    parts.push(`힘을 빼고 아끼고 싶은 항목은 '${saveTitles.join("·")}'이야.`);
  }
  if (concessionTitles.length > 0) {
    parts.push(`파트너에게 맞춰줄 수 있는 항목은 '${concessionTitles.join("·")}'이야.`);
  }
  parts.push(
    "내 성향과 장바구니 기준에 맞춰서 예산 배분 포인트와 이번 주부터 시작할 결혼 준비 첫 순서를 추천해줘.",
  );
  return parts.join(" ").slice(0, 560);
}

