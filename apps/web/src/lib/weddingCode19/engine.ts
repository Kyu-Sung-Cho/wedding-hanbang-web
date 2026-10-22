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

export type SubPersonaArchetypeKey19 =
  | "visual_artist"
  | "hospitality_host"
  | "family_dignity"
  | "festival_director"
  | "intimate_curator"
  | "future_strategist"
  | "harmonious_supporter"
  | "all_round_balancer";

export interface SubPersonaProfile19 {
  archetypeKey: SubPersonaArchetypeKey19;
  focusBadge: string;
  subTitle: string;
  differentiationSummary: string;
}

export interface DecisionStyleProfile19 {
  styleKey:
    | "decisive_polarized"
    | "romantic_maximalist"
    | "minimalist_pruner"
    | "peaceful_open"
    | "careful_balancer"
    | "open_explorer"
    | "strategic_selector";
  badgeLabel: string;
  statsSummary: string;
  description: string;
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

export interface CoupleChemistrySummary19 {
  matchedAxisCount: number;
  chemistryTitle: string;
  matchStatsBadge: string;
  chemistryNarrative: string;
}

export interface PersonalReport19 {
  code: WeddingCode19Code;
  character: CharacterProfile19;
  subPersona: SubPersonaProfile19;
  decisionStyle: DecisionStyleProfile19;
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
  coupleChemistrySummary: CoupleChemistrySummary19;
  axisSynergies: AxisSynergyEntry[];
  empathyBridge: CoupleEmpathyBridge19;
  crisisWarnings: CoupleConflictItem[];
  alignedItems: CoupleAlignedItem[];
  concessionMatches: CoupleConcessionMatch[];
  conflictItems: CoupleConflictItem[];
}

export const SPEND_FEATURE_QUESTION_IDS: ReadonlySet<QuestionId> = new Set<QuestionId>([
  "Q1",
  "Q3",
  "Q4",
  "Q5",
  "Q7",
  "Q8",
  "Q9",
  "Q10",
]);

export function computeAxisPercentages(
  leftScore: number,
  rightScore: number,
  neutralPadding = 1.5,
): {
  leftPercent: number;
  rightPercent: number;
} {
  if (leftScore === rightScore) {
    return { leftPercent: 50, rightPercent: 50 };
  }
  const maxRaw = Math.max(leftScore, rightScore);
  const effectivePadding =
    maxRaw >= 5 ? Math.min(neutralPadding, 0.8) : neutralPadding;
  const paddedLeft = leftScore + effectivePadding;
  const paddedRight = rightScore + effectivePadding;
  const total = paddedLeft + paddedRight;
  if (total <= 0) {
    return { leftPercent: 50, rightPercent: 50 };
  }
  const rawLeftPercent = Math.round((paddedLeft / total) * 100);
  const minBound = maxRaw >= 5 ? 8 : 12;
  const maxBound = maxRaw >= 5 ? 92 : 88;
  const leftPercent = Math.max(minBound, Math.min(maxBound, rawLeftPercent));
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
  // Q13: A(+2 D), B(+2 P)
  // Q5, Q8, Q9: 5(+2 D), 4(+1 D), 2(+1 P), 1(+2 P)
  // [보정]: Q6·Q7을 모두 5점으로 챙긴 순수 하객 실속파가 로망 중립일 때 P 점수가 반영되도록 보정.
  let dScore = 0;
  let pScore = 0;
  if (answers.Q13 === "A") dScore += 2;
  if (answers.Q13 === "B") pScore += 2;
  for (const qId of ["Q5", "Q8", "Q9"] as const) {
    const dir = getPart1Direction(answers[qId], "D", "P");
    if (dir.letter === "D") dScore += dir.points;
    if (dir.letter === "P") pScore += dir.points;
  }
  if (
    answers.Q13 === "B" &&
    answers.Q6 === 5 &&
    dScore <= 4
  ) {
    pScore += 2;
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
      ? "✨ 평소엔 효율적인 분담과 감정적 유대감을 조화롭게 병행하는 외유내강형"
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

function getItemPriorityWeight(
  qId: QuestionId,
  answers: WeddingCode19Answers,
  topPrioritySet: ReadonlySet<QuestionId>,
): number {
  const ans = answers[qId];
  if (ans === 5) return topPrioritySet.has(qId) ? 7 : 4;
  if (ans === 4) return 2;
  if (ans === 3) return 0;
  if (ans === 2) return -1;
  if (ans === 1) return -2;
  return 0;
}

function buildSubPersona19(
  code: WeddingCode19Code,
  character: CharacterProfile19,
  answers: WeddingCode19Answers,
  topPrioritySet: ReadonlySet<QuestionId>,
  mustHave5: readonly BasketItemEntry[],
  niceToHave4: readonly BasketItemEntry[],
  saveSimplify12: readonly BasketItemEntry[],
  relativeSaveSuggestions: readonly BasketItemEntry[],
  concession3D: readonly BasketItemEntry[],
  balancedC: readonly BasketItemEntry[],
): SubPersonaProfile19 {
  const w = (qId: QuestionId) => getItemPriorityWeight(qId, answers, topPrioritySet);

  const visualScore = (w("Q5") + w("Q8") + w("Q9")) / 3;
  const hospitalityScore = (w("Q6") + w("Q7")) / 2 + (answers.Q6 === 5 && answers.Q7 === 5 ? 1.5 : 0);
  const familyScore =
    w("Q10") * 0.65 +
    (answers.Q16 === "A" ? 2.5 : answers.Q16 === "C" ? 0.8 : -1) +
    w("Q7") * 0.35;
  const festivalScore = (w("Q1") + w("Q3")) / 2 + (answers.Q3 === 5 ? 1 : 0);
  const intimateScore = (w("Q2") + w("Q4")) / 2 + (answers.Q2 === 5 && answers.Q4 === 5 ? 1 : 0);

  const part1FocusItems = [...mustHave5, ...niceToHave4].filter(
    (item) => item.questionNumber <= 10,
  );
  const topFocusTitles = (
    part1FocusItems.length > 0 ? part1FocusItems : [...mustHave5, ...niceToHave4]
  )
    .slice(0, 3)
    .map((item) => `‘${item.shortTitle}’`);
  const spendSaveItems = (
    saveSimplify12.length > 0 ? saveSimplify12 : relativeSaveSuggestions
  ).filter((item) => SPEND_FEATURE_QUESTION_IDS.has(item.questionId));
  const saveTitles = spendSaveItems
    .slice(0, 2)
    .map((item) => `‘${item.shortTitle}’`);

  const topFocusLabel =
    topFocusTitles.length > 0 ? topFocusTitles.join("·") : "핵심 본질 항목";
  const saveFocusLabel =
    saveTitles.length > 0
      ? `${saveTitles.join("·")}에서는 과감히 힘을 빼고`
      : "주변 부가 옵션에서는 거품을 덜어내고";

  // 1) 신혼 미래·실속 전략가 (Q13=B 이면서 절약 항목이 많고 비주얼/격식 점수가 낮을 때)
  if (
    answers.Q13 === "B" &&
    spendSaveItems.length >= 3 &&
    visualScore <= 1.2 &&
    hospitalityScore < 3.5
  ) {
    return {
      archetypeKey: "future_strategist",
      focusBadge: "💎 세부 결: 실속·미래설계 전략가",
      subTitle: `결혼 이후의 현실 자산을 단단하게 설계하는 전략가 · ${character.characterName}`,
      differentiationSummary: `같은 [${character.characterName}(${code})] 유형 중에서도 보여주기식 당일 연출보다 결혼식 다음 날부터 시작될 신혼집·신혼여행·미래 자산의 여유를 최우선으로 지키는 실속파입니다. ${saveFocusLabel}, 꼭 필요한 ${topFocusLabel}에만 예산을 스마트하게 집중합니다.`,
    };
  }

  // 2) 핵심 가치 클러스터 최고점 판별
  const candidates: Array<{ key: SubPersonaArchetypeKey19; score: number }> = [
    { key: "visual_artist", score: visualScore },
    { key: "hospitality_host", score: hospitalityScore },
    { key: "family_dignity", score: familyScore },
    { key: "festival_director", score: festivalScore },
    { key: "intimate_curator", score: intimateScore },
  ];

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const second = candidates[1];

  // Q1~Q10에 양수 선호(4·5점)가 전혀 없거나 클러스터 최고점이 0 이하인 경우 -> 실속·미래설계 전략가 반환
  if (part1FocusItems.length === 0 || best.score <= 0) {
    return {
      archetypeKey: "future_strategist",
      focusBadge: "💎 세부 결: 실속·미래설계 전략가",
      subTitle: `결혼 이후의 현실 자산을 단단하게 설계하는 전략가 · ${character.characterName}`,
      differentiationSummary: `같은 [${character.characterName}(${code})] 유형 중에서도 보여주기식 당일 연출보다 결혼식 다음 날부터 시작될 신혼집·신혼여행·미래 자산의 여유를 최우선으로 지키는 실속파입니다. ${saveFocusLabel}, 꼭 필요한 ${topFocusLabel}에만 예산을 스마트하게 집중합니다.`,
    };
  }

  // 3) 다정한 파트너 맞춤 조율가 (양보/절충 선택지가 6개 이상이고 5점이 1개 이하일 때)
  if (concession3D.length + balancedC.length >= 6 && mustHave5.length <= 1) {
    return {
      archetypeKey: "harmonious_supporter",
      focusBadge: "🤝 세부 결: 파트너 맞춤형 평화 조율가",
      subTitle: `파트너의 로망까지 다정하게 보듬는 조율가 · ${character.characterName}`,
      differentiationSummary: `같은 [${character.characterName}(${code})] 유형 중에서도 내 고집을 앞세우기보다 파트너가 가장 행복해하는 선택을 기꺼이 지지해주는 평화주의 조율가입니다. 양보 찬스 카드(${concession3D.length}개)와 균형 절충안(${balancedC.length}개)이 풍부해 커플 갈등을 녹이는 일등 공신입니다.`,
    };
  }

  // 최고점과 차점 차이가 아주 작고 전반적으로 고른 경우 -> 육각형 밸런스 기획자
  if (best.score >= 1.5 && best.score - second.score < 0.35 && mustHave5.length >= 3) {
    return {
      archetypeKey: "all_round_balancer",
      focusBadge: "🧭 세부 결: 육각형 올라운드 디렉터",
      subTitle: `감성 로망과 현실 배려를 고르게 챙기는 올라운더 · ${character.characterName}`,
      differentiationSummary: `같은 [${character.characterName}(${code})] 유형 중에서도 어느 한쪽에만 치우치지 않고 ${topFocusLabel}을(를) 고르게 챙기는 올라운드 기획자입니다. ${saveFocusLabel} 두 사람의 로망과 하객의 만족도를 동시에 완성합니다.`,
    };
  }

  switch (best.key) {
    case "visual_artist":
      return {
        archetypeKey: "visual_artist",
        focusBadge: "🎨 세부 결: 공간·화보 비주얼 아티스트",
        subTitle: `공간의 미장센과 화보 완성도에 설레는 디렉터 · ${character.characterName}`,
        differentiationSummary: `같은 [${character.characterName}(${code})] 유형 안에서도 예식 공간의 분위기·스타일링·평생 남을 사진/영상의 심미적 완성도에 가장 가슴이 뛰는 비주얼 디렉터입니다. ${saveFocusLabel}, ${topFocusLabel}만큼은 타협 없이 우리만의 작품으로 남기고 싶어 합니다.`,
      };
    case "hospitality_host":
      return {
        archetypeKey: "hospitality_host",
        focusBadge: "🍽️ 세부 결: 미식·하객 감동 호스트",
        subTitle: `하객의 편안한 동선과 미식 대접을 최우선하는 호스트 · ${character.characterName}`,
        differentiationSummary: `같은 [${character.characterName}(${code})] 유형 중에서도 내 화려함보다 먼 길 찾아와 준 손님들의 발걸음과 식사 만족도를 가장 먼저 챙기는 다정한 호스트입니다. ${saveFocusLabel}, ${topFocusLabel}에 투자를 아끼지 않아 “정말 대접 잘 받고 간다”는 찬사를 이끌어냅니다.`,
      };
    case "family_dignity":
      return {
        archetypeKey: "family_dignity",
        focusBadge: "🏛️ 세부 결: 양가 예우·클래식 품격파",
        subTitle: `양가 어른의 미소와 단정한 격식을 지키는 품격파 · ${character.characterName}`,
        differentiationSummary: `같은 [${character.characterName}(${code})] 유형 중에서도 결혼을 두 가족의 품격 있는 결합으로 존중하며, 어른들의 입장과 예물·예단·하객 접대의 예를 세심히 살피는 타입입니다. ${topFocusLabel}을(를) 중심으로 양가 모두가 흐뭇해하는 안정감 있는 예식을 완성합니다.`,
      };
    case "festival_director":
      return {
        archetypeKey: "festival_director",
        focusBadge: "🎉 세부 결: 서사·이벤트 축제 연출가",
        subTitle: `결혼식을 모두가 즐기는 축제로 만드는 연출가 · ${character.characterName}`,
        differentiationSummary: `같은 [${character.characterName}(${code})] 유형 중에서도 천편일률적인 기계식 예식을 거부하고, 우리 두 사람만의 드라마틱한 순간과 색다른 식순(${topFocusLabel})으로 하객 모두가 함께 웃고 즐기는 무대를 연출하는 디렉터입니다.`,
      };
    case "intimate_curator":
    default:
      return {
        archetypeKey: "intimate_curator",
        focusBadge: "🕯️ 세부 결: 프라이빗 감성·교류 큐레이터",
        subTitle: `소중한 사람들과의 깊은 눈맞춤을 아끼는 큐레이터 · ${character.characterName}`,
        differentiationSummary: `같은 [${character.characterName}(${code})] 유형 중에서도 북적이는 인파나 겉치레보다, 우리를 진심으로 축복해주는 소중한 사람들과 눈을 맞추고 대화 나누는 밀도 높은 시간(${topFocusLabel})을 가장 소중히 여기는 감성 큐레이터입니다.`,
      };
  }
}

function buildDecisionStyleProfile19(
  mustHave5: readonly BasketItemEntry[],
  niceToHave4: readonly BasketItemEntry[],
  saveSimplify12: readonly BasketItemEntry[],
  concession3D: readonly BasketItemEntry[],
  balancedC: readonly BasketItemEntry[],
  undecidedUnknownE: readonly BasketItemEntry[],
): DecisionStyleProfile19 {
  const c5 = mustHave5.length;
  const c4 = niceToHave4.length;
  const c12 = saveSimplify12.length;
  const c3D = concession3D.length;
  const cC = balancedC.length;
  const cU = undecidedUnknownE.length;

  const statsSummary = `1순위 확신(⑤) ${c5}개 · 관심(④) ${c4}개 · 절약(①·②) ${c12}개 · 양보(③·D) ${c3D}개 · 절충(C) ${cC}개${cU > 0 ? ` · 미정(⚪·E) ${cU}개` : ""}`;

  if (cU >= 3) {
    return {
      styleKey: "open_explorer",
      badgeLabel: "🔍 가능성 열린 백지 탐색형",
      statsSummary,
      description:
        "아직 고정관념이나 선입견을 두지 않고 가능성을 열어둔 상태입니다. 처음부터 세세한 결정을 서두르기보다, 파트너나 AI 비서와 함께 대표 샘플 2~3가지를 구경하며 내 취향의 윤곽을 발견해 갈 때 가장 즐겁게 준비할 수 있습니다.",
    };
  }

  if (c5 >= 2 && c12 >= 3 && c3D <= 3) {
    return {
      styleKey: "decisive_polarized",
      badgeLabel: "🔥 호불호 칼각·확신 결단형",
      statsSummary,
      description:
        "무엇에 힘을 주고 무엇을 과감히 덜어낼지 내면의 우선순위 기준선이 면도날처럼 선명합니다. 애매하게 시간 끌지 않고 빠르게 견적을 정리하는 강점이 있으며, 파트너의 1순위만 존중해주면 최고의 추진력을 발휘합니다.",
    };
  }

  if (c5 + c4 >= 8 && c12 <= 1) {
    return {
      styleKey: "romantic_maximalist",
      badgeLabel: "🌟 로망 다다익선·애정 몰입형",
      statsSummary,
      description:
        "결혼식의 공간·미식·스타일링·하객 배려까지 어느 하나 소홀히 하고 싶지 않은 애정 충만 타입입니다. 준비 과정의 설렘이 누구보다 크지만 추가금이 눈덩이처럼 불어날 수 있으니, 딱 2가지 최우선 순위 외에는 상한선을 먼저 못 박아두는 것이 핵심입니다.",
    };
  }

  if (c12 >= 5 && c5 <= 2) {
    return {
      styleKey: "minimalist_pruner",
      badgeLabel: "✂️ 미니멀 가지치기·실속 집중형",
      statsSummary,
      description:
        "보여주기식 관행이나 불필요한 옵션에 흔들리지 않고 꼭 필요한 본질만 깔끔하게 남기는 미니멀리스트입니다. 플래너나 업체의 화려한 영업 멘트에도 흔들리지 않는 단단한 예산 방어력을 가지고 있습니다.",
    };
  }

  if (c3D >= 5) {
    return {
      styleKey: "peaceful_open",
      badgeLabel: "🌿 평화주의 오픈마인드·배려형",
      statsSummary,
      description:
        "내 주장을 관철하기보다 ‘두 사람이 기분 좋게 합의하는 과정’ 자체를 훨씬 중요하게 여깁니다. 파트너에게 맞춰줄 수 있는 양보 폭이 넓어 갈등이 적지만, 내가 진짜 원하는 한두 가지까지 참지 않도록 내 1순위만큼은 분명히 표현해 주세요.",
    };
  }

  if (cC >= 3 || (c4 >= 5 && c5 <= 1)) {
    return {
      styleKey: "careful_balancer",
      badgeLabel: "⚖️ 신중한 황금비율·중립 조율형",
      statsSummary,
      description:
        "어느 한쪽으로 극단적인 몰빵을 하기보다, 로망과 현실·탐색과 편의 사이에서 가장 안전한 중도 타협점을 찾아내는 신중한 조율가입니다. 급하게 양자택일을 강요받기보다 반반 절충안을 설계할 때 가장 마음이 편안합니다.",
    };
  }

  return {
    styleKey: "strategic_selector",
    badgeLabel: "🎯 선택과 집중·스마트 밸런스형",
    statsSummary,
    description:
      "절대 양보할 수 없는 핵심 가치와 힘 뺄 곳, 그리고 파트너에게 맞춰줄 여지를 이상적인 비율로 배분하는 전략가입니다. 감정 소모와 예산 낭비를 동시에 줄이는 가장 안정적인 의사결정 패턴을 보여줍니다.",
  };
}

function buildHiddenPsychologyInsight19(
  answers: WeddingCode19Answers,
  axes: PersonalReport19["axes"],
  subPersona: SubPersonaProfile19,
  mustHave5: readonly BasketItemEntry[],
  saveSimplify12: readonly BasketItemEntry[],
): HiddenPsychologyInsight19 {
  const isS = axes.axis1.winner === "S";
  const isD = axes.axis2.winner === "D";
  const isM = axes.axis3.winner === "M";
  const isH = axes.axis4.winner === "H";

  const spendMustHave = mustHave5.filter((i) =>
    SPEND_FEATURE_QUESTION_IDS.has(i.questionId),
  );
  const topNames = spendMustHave
    .slice(0, 2)
    .map((i) => `‘${i.shortTitle}’`)
    .join("·");
  const principleNames = mustHave5
    .filter((i) => !SPEND_FEATURE_QUESTION_IDS.has(i.questionId))
    .slice(0, 2)
    .map((i) => `‘${i.shortTitle}’`)
    .join("·");
  const spendSaves = saveSimplify12.filter((i) =>
    SPEND_FEATURE_QUESTION_IDS.has(i.questionId),
  );
  const saveNames = spendSaves
    .slice(0, 2)
    .map((i) => `‘${i.shortTitle}’`)
    .join("·");

  let unconsciousTitle = "";
  let unconsciousInsight = "";

  switch (subPersona.archetypeKey) {
    case "visual_artist":
      unconsciousTitle = isS
        ? "평생 남을 ‘결정적 한 장면’을 통해 사랑과 축복을 온전히 각인하고 싶은 마음"
        : "보여주기식 격식보다 ‘우리다운 미적 감도와 취향의 밀도’를 지키고 싶은 마음";
      unconsciousInsight = `겉으로는 화려한 공간이나 스타일링(${topNames || "홀·드레스·스냅"})을 중시하는 것처럼 보이지만, 내면 깊은 곳에는 ‘인생의 가장 큰 전환점을 흐릿하거나 평범하게 흘려보내고 싶지 않다’는 열망이 있습니다. 나에게 결혼식은 단순한 주말 행사가 아니라 두 사람의 서사를 시각적으로 증명하는 작품이기 때문에, ${saveNames ? `${saveNames} 같은 부차적 요소는 줄이더라도 ` : ""}내가 꼽은 핵심 장면만큼은 온전히 지켜질 때 깊은 심리적 충족감을 느낍니다.`;
      break;
    case "hospitality_host":
      unconsciousTitle =
        "초대한 사람들에게 ‘불편이나 아쉬움을 빚지고 싶지 않은’ 다정한 책임감과 자부심";
      unconsciousInsight = `스스로를 ‘그냥 현실적이거나 무난한 사람’이라고 생각하기 쉽지만, 실제로는 귀한 시간을 내어 찾아와 준 손님들이 식사나 교통(${topNames || "식사·접근성"}) 때문에 작은 불편이라도 겪을까 봐 마음 쓰는 배려심이 매우 깊습니다. 주인공인 내가 빛나는 것 이상으로 “오늘 초대받아 와서 정말 대접 잘 받았다”는 하객들의 편안한 표정이 내 마음을 가장 든든하게 만듭니다.`;
      break;
    case "family_dignity":
      unconsciousTitle =
        "두 사람의 결합을 넘어 ‘양가 어른과 가족 모두에게 축복받는 안정감’을 원하는 마음";
      unconsciousInsight = `결혼을 단 하루의 파티가 아니라 두 가문이 만나는 첫 단추로 진중하게 바라봅니다. 어른들의 의견이나 예물·예단·접대의 격식(${topNames || "예우·격식"})을 챙기는 이유는 남의 눈치를 봐서가 아니라, 양가 부모님이 자부심을 느끼고 뒷말 없이 평온하게 출발하는 것이 결국 두 사람의 미래를 가장 든든하게 지켜준다는 사실을 본능적으로 알고 있기 때문입니다.`;
      break;
    case "festival_director":
      unconsciousTitle =
        "기계처럼 찍어내는 예식 대신 ‘모두의 기억에 살아 숨 쉬는 축제’를 만들고 싶은 열망";
      unconsciousInsight = `하객들이 도장만 찍고 밥만 먹고 돌아가는 형식적인 절차에 내면의 아쉬움을 느낍니다. ${topNames || "주인공 연출·특별한 식순"}에 마음이 기우는 이유는 과시욕이 아니라, 우리 두 사람의 에너지와 이야기가 하객들에게도 생생한 즐거움으로 전해져 ‘진짜 축하받는 살아있는 순간’을 경험하고 싶기 때문입니다.`;
      break;
    case "intimate_curator":
      unconsciousTitle =
        "넓은 인맥의 박수보다 ‘진짜 내 사람들과 나누는 따뜻한 눈맞춤’에서 안도감을 얻는 마음";
      unconsciousInsight = `수백 명의 낯선 시선 속에서 긴장한 채 서 있기보다, 우리를 깊이 아끼는 사람들과 여유롭게 온기를 나누는 환경(${topNames || "소규모 예식·여유로운 인사"})에서 비로소 진짜 행복을 느낍니다. 보여주기식 겉치레(${saveNames || "형식적 절차"})를 덜어낼수록 내 마음이 훨씬 가벼워지고 결혼식 본연의 진심에 집중할 수 있습니다.`;
      break;
    case "future_strategist":
      unconsciousTitle =
        "하루의 이벤트보다 ‘결혼식 다음 날부터 시작될 일상의 자유와 여유’를 지키는 보호 본능";
      unconsciousInsight = `결혼식 당일의 짧은 몇 시간 때문에 두 사람의 체력이나 신혼 자금이 무리하게 소진되는 것을 본능적으로 경계합니다. 설렘이 부족해서가 아니라, ‘진짜 행복은 식장 문을 나선 뒤의 신혼 생활에 있다’는 확고한 내면의 기준이 있기 때문에 ${saveNames || "불필요한 거품 옵션"}을 걷어낼 때 오히려 큰 심리적 해방감과 안정감을 느낍니다.`;
      break;
    case "harmonious_supporter":
      unconsciousTitle =
        "화려한 선택지보다 ‘준비 과정 내내 두 사람이 다투지 않는 평온함’을 최우선으로 여기는 마음";
      unconsciousInsight = `어떤 홀이나 드레스를 고르느냐보다, 그 결정을 내리는 과정에서 두 사람의 관계가 상처받지 않고 다정함을 유지하는 것이 내게는 100배 더 중요합니다. 그래서 많은 항목에서 기꺼이 파트너에게 맞출 수 있지만, 내면에서는 ‘나의 이 배려와 양보를 파트너가 당연하게 여기지 않고 따뜻하게 알아주길 바라는 마음’이 함께 자리하고 있습니다.`;
      break;
    case "all_round_balancer":
    default:
      unconsciousTitle = isD
        ? "로망의 감도와 현실적 완성도 사이에서 ‘단 하나의 후회도 남기고 싶지 않은’ 완벽주의"
        : "감정 소모와 예산 낭비 없이 ‘가장 검증된 정석’으로 안전하게 완주하고 싶은 마음";
      unconsciousInsight = `감성적인 만족(${topNames || "핵심 선호 항목"})과 현실적인 조건 어느 한쪽도 허투루 놓치고 싶지 않은 균형 감각이 뛰어납니다. 내면 깊은 곳에는 ‘나중에 돌아봤을 때 그때 왜 그랬을까 하고 후회하는 일만큼은 만들고 싶지 않다’는 책임감이 자리하고 있어, 기준이 명확히 정리될 때 가장 큰 평온을 얻습니다.`;
      break;
  }

  let blindSpotTitle = "";
  let blindSpotInsight = "";

  if (isM && answers.Q17 === "A") {
    blindSpotTitle = "불안할수록 ‘빨리 검색해서 당장 확정 지어야 안심되는’ 과속 결정 모드";
    blindSpotInsight =
      answers.Q14 === "A"
        ? "내 눈으로 직접 후기와 현장을 확인해야 직성이 풀리고, 알아볼 것이 쌓이면 머릿속 불확실성을 견디기 힘들어 당장 결론을 내리려 합니다. 이때 나만큼 빠르게 움직이지 않거나 ‘좀 쉬었다 하자’고 하는 파트너를 보면 나도 모르게 ‘나만 이 결혼에 진심인가?’라는 서운함으로 번질 수 있으니 의식적인 속도 조절이 필요합니다."
        : "일정과 예산을 체계적으로 통제하고 싶어 지칠수록 오히려 빨리 결정을 끝내버리려 합니다. 하지만 피로가 쌓인 상태에서의 속도전은 파트너에게 압박감을 줄 수 있으니, 결론을 내리기 전 10분만 숨을 고르는 여유가 나를 지켜줍니다.";
  } else if (isM && answers.Q17 === "B") {
    blindSpotTitle = "후회하기 싫어 완벽한 정답을 찾다가 스스로 방전되는 ‘탐색 과부하’";
    blindSpotInsight =
      "꼼꼼히 비교하고 계획해야 마음이 놓이지만(M), 동시에 지친 상태에서 성급히 결정하는 것도 싫어해(Q17=B) ‘더 나은 후보가 있지 않을까?’ 하며 선택지를 계속 열어두기 쉽습니다. 정보가 쌓일수록 결정 피로가 한꺼번에 몰려올 수 있으니 ‘상위 3개 후보만 남기면 검색창을 닫는다’는 마감 규칙이 꼭 필요합니다.";
  } else if (isM && (answers.Q17 === "C" || answers.Q17 === "D" || answers.Q17 === "E")) {
    blindSpotTitle = "머리는 계속 비교표를 돌리는데 몸은 지쳐가는 ‘내적 줄다리기 모드’";
    blindSpotInsight =
      "꼼꼼하게 알아보고 싶은 책임감은 큰데, 체력이 떨어질 때 밀어붙일지 쉴지 사이에서 갈팡질팡하다가 에너지를 이중으로 소모하기 쉽습니다. 일정이 급한 계약 1건만 매듭짓고 나머지는 과감히 다음 주로 넘기는 분리 전략이 효과적입니다.";
  } else if (!isM && answers.Q17 === "B") {
    blindSpotTitle = "복잡한 비교 압박이 몰려오면 무의식적으로 스위치를 끄는 ‘동굴 속 일시정지 모드’";
    blindSpotInsight =
      "수십 개의 세부 조건 비교나 일정 압박이 쏟아지면, 후회하거나 다투는 상황을 피하려고 무의식적으로 결정을 미루고 한발 물러섭니다. 내 안에서는 에너지를 회복하려는 자연스러운 방어 반응이지만, 파트너 눈에는 ‘관심이 없거나 책임을 미루는 모습’으로 오해받기 쉬우니 “내일 맑은 정신으로 꼭 같이 고르자”는 한마디를 먼저 건네주세요.";
  } else if (!isM && answers.Q17 === "A") {
    blindSpotTitle = "복잡한 탐색 과정은 건너뛰고 ‘단숨에 결론부터 찍으려는’ 초고속 생략 본능";
    blindSpotInsight =
      "긴 발품과 피곤한 비교 과정을 아끼고, 지칠수록 빨리 결론을 내려 털어버리는 결단력이 탁월합니다. 다만 과정 자체를 함께 고민하며 설렘을 느끼는 파트너와 함께할 때는, 나의 시원시원한 속도감이 상대에게는 ‘충분히 상의하지 않고 숙제처럼 해치워버리는 느낌’을 줄 수 있다는 점을 기억하면 좋습니다.";
  } else {
    blindSpotTitle = "편안한 흐름을 선호하다가 ‘마감 직전 선택지 축소’를 겪기 쉬운 유연 모드";
    blindSpotInsight =
      "과도한 스트레스 없이 전문가 추천이나 상황에 맞춰 유연하게 흘러가는 장점이 있습니다. 다만 인기 웨딩홀 골든타임이나 스드메 핵심 옵션처럼 일찍 마감되는 항목에서는 막판에 원치 않는 추가금을 내게 될 수 있으니, 내 1순위 항목 딱 2가지만큼은 초기에 먼저 선점해 두세요.";
  }

  let selfDiscoveryQuestion = "";
  if (isH && answers.Q18 === "A") {
    selfDiscoveryQuestion =
      "“나는 결혼식 결과물 그 자체보다, 준비하는 매 순간 ‘우리가 같은 온도에서 숨김없이 마음을 나누며 함께 설레고 있는가’를 확인받고 싶어 하지 않나요?”";
  } else if (isH && answers.Q18 === "B") {
    selfDiscoveryQuestion =
      "“나는 모든 과정을 다정하게 함께하고 싶어 하면서도, 정작 서운한 순간에는 상대가 먼저 내 표정과 침묵 속의 마음을 헤아려주길 조용히 기다리고 있지 않나요?”";
  } else if (isH) {
    selfDiscoveryQuestion =
      "“나는 결정이 어려워서 묻는 게 아니라, ‘너와 취향을 나누며 우리만의 결혼을 함께 빚어가는 연결감’ 자체를 가장 소중히 여기고 있지 않나요?”";
  } else if (!isH && answers.Q19 === "B") {
    selfDiscoveryQuestion =
      "“나는 사랑과 배려를 ‘감정적인 말’보다 ‘예산과 역할을 깔끔하게 정리해 두 사람의 시행착오와 피로를 줄여주는 것’으로 증명하고 있지 않나요?”";
  } else if (!isH && answers.Q18 === "A") {
    selfDiscoveryQuestion =
      "“나는 실무는 효율적으로 나누되, 의견이나 감정의 이견만큼은 뒤끝 없이 그 자리에서 투명하게 정리되어야 마음이 놓이는 타입이 아닌가요?”";
  } else {
    selfDiscoveryQuestion =
      "“나는 무심해서가 아니라, 각자의 영역과 에너지를 존중하며 ‘결혼 준비 때문에 두 사람의 일상이 지치지 않게 지키는 것’을 최고의 사랑이라 믿고 있지 않나요?”";
  }

  const partnerTranslations: PartnerTranslationItem19[] = [];
  if (isH) {
    partnerTranslations.push({
      whenISay:
        answers.Q15 === "A"
          ? "“이것도 같이 가보고 같이 골라주면 안 돼? 넌 어떤 게 더 좋아?”"
          : "“내가 먼저 추려왔는데, 최종 결정은 꼭 우리 같이 보면서 얘기하자!”",
      whatIReallyMean:
        "혼자 결정을 못 해서가 아니라, 너와 취향을 나누며 함께 결혼을 만들어가는 ‘우리의 추억과 정서적 연결감’을 느끼고 싶다는 뜻이에요.",
    });
  } else {
    partnerTranslations.push({
      whenISay:
        answers.Q15 === "B"
          ? "“이건 각자 잘하는 분야로 맡아서 후보 2~3개만 추려오자.”"
          : "“예산이랑 핵심 조건표부터 먼저 깔끔하게 정리해 보자.”",
      whatIReallyMean:
        "설렘이 없거나 차가워서가 아니라, 두 사람이 주말마다 지치거나 불필요하게 다투지 않도록 ‘현실적인 안전망’을 먼저 만들어주고 싶다는 뜻이에요.",
    });
  }

  if (answers.Q18 === "A") {
    partnerTranslations.push({
      whenISay: "“나 방금 이 부분은 좀 서운했어. 지금 바로 얘기해 줄 수 있어?”",
      whatIReallyMean:
        answers.Q19 === "B"
          ? "당신을 탓하려는 게 아니라, 마음이 상한 채로 두지 않고 빨리 오해를 풀어야 현실적인 다음 대안도 기분 좋게 함께 찾을 수 있다는 신호예요."
          : "당신을 공격하려는 게 아니라, 내 마음속에 앙금이 커지기 전에 빨리 털어내고 다시 다정한 우리로 돌아가고 싶다는 신호예요.",
    });
  } else if (answers.Q18 === "B") {
    partnerTranslations.push({
      whenISay: "“지금은 좀 지치니까 나중에 생각 정리하고 다시 얘기하자.”",
      whatIReallyMean:
        "대화를 회피하거나 무시하는 게 아니라, 감정이 앞선 말로 당신에게 상처 주지 않기 위해 내 마음을 정돈할 시간이 잠시 필요하다는 뜻이에요.",
    });
  } else {
    partnerTranslations.push({
      whenISay: "“가벼운 건 바로 맞추고, 큰 문제는 오늘 푹 자고 내일 얘기하자.”",
      whatIReallyMean:
        "피곤한 상태에서 괜히 큰 결론을 내렸다가 서로 후회하지 않도록, 대화의 온도와 타이밍을 안전하게 조절하고 싶다는 뜻이에요.",
    });
  }

  // 3번째 번역 카드: 내 예산 철학(Q13) + 실제 1순위/절약 항목 + 양가 소통(Q16) 반영
  if (answers.Q13 === "A" || isD) {
    partnerTranslations.push({
      whenISay: topNames
        ? `“다른 건 기본으로 줄여도 좋으니까, ${topNames}만큼은 우리 후회 없이 제대로 챙기자.”`
        : principleNames
          ? `“다른 건 무난하게 맞춰도 좋으니까, ${principleNames} 기준만큼은 우리 꼭 지켜서 준비하자.”`
          : "“평생 한 번뿐인 날인데 이 포인트만큼은 아끼지 말고 제대로 하고 싶어.”",
      whatIReallyMean:
        "예산 감각이 없어서가 아니라, 먼 훗날 우리 결혼식을 떠올렸을 때 ‘그때 진짜 행복했지’ 하고 평생 미소 지을 핵심 장면 하나를 지키고 싶다는 뜻이에요.",
    });
  } else {
    partnerTranslations.push({
      whenISay: saveNames
        ? `“${saveNames} 같은 건 과감히 줄이고, 그 돈으로 신혼집이나 신혼여행에 보태자.”`
        : "“불필요한 겉치레나 보여주기식 옵션 같은 건 과감히 줄이고, 그 돈으로 신혼집이나 신혼여행에 보태자.”",
      whatIReallyMean:
        "결혼식이 안 중요해서가 아니라, 식장 문을 나선 뒤 시작될 ‘우리 두 사람의 매일매일의 일상’을 더 풍요롭고 여유롭게 만들어주고 싶다는 뜻이에요.",
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

function buildCoupleChemistrySummary19(
  myReport: PersonalReport19,
  partnerReport: PersonalReport19,
  alignedCount: number,
  concessionCount: number,
  conflictCount: number,
  myAnswers: WeddingCode19Answers,
  partnerAnswers: WeddingCode19Answers,
): CoupleChemistrySummary19 {
  let matchedAxisCount = 0;
  if (myReport.axes.axis1.winner === partnerReport.axes.axis1.winner) matchedAxisCount += 1;
  if (myReport.axes.axis2.winner === partnerReport.axes.axis2.winner) matchedAxisCount += 1;
  if (myReport.axes.axis3.winner === partnerReport.axes.axis3.winner) matchedAxisCount += 1;
  if (myReport.axes.axis4.winner === partnerReport.axes.axis4.winner) matchedAxisCount += 1;

  const matchStatsBadge = `4대 축 중 ${matchedAxisCount}개 일치 · 완벽 통함 ${alignedCount}건 / 양보·리드 찬스 ${concessionCount}건 / 맞춤 조율 ${conflictCount}건`;

  let chemistryTitle = "";
  let baseDesc = "";

  if (matchedAxisCount === 4) {
    chemistryTitle = "🌟 4개 축이 모두 통하는 ‘데칼코마니 소울메이트’";
    baseDesc = `두 분은 예식 무대부터 가치관·탐색 방식·소통 온도까지 4대 핵심 축이 모두 일치하는 천생연분 조합입니다(통하는 기준 ${alignedCount}건, 찬스 카드 ${concessionCount}건).`;
  } else if (matchedAxisCount === 3) {
    chemistryTitle = "🧩 3개 축은 통하고 1개 축이 보완하는 ‘황금 밸런스 콤비’";
    baseDesc = `큰 방향성(3개 축)은 기분 좋게 통하면서도, 단 1개 축에서 서로의 사각지대를 메워주는 이상적인 커플입니다(통하는 기준 ${alignedCount}건, 찬스 카드 ${concessionCount}건).`;
  } else if (matchedAxisCount === 2) {
    chemistryTitle = "⚖️ 닮은 점과 다른 점이 2:2로 어우러진 ‘상호보완 시너지 커플’";
    baseDesc = `두 축은 든든한 공감대를 형성하고, 나머지 두 축은 서로 다른 강점으로 균형을 잡아주는 조화로운 조합입니다(통하는 기준 ${alignedCount}건, 찬스 카드 ${concessionCount}건, 조율 포인트 ${conflictCount}건).`;
  } else if (matchedAxisCount === 1) {
    chemistryTitle = "🎯 서로 다른 강점으로 빈틈을 채우는 ‘입체적 파트너십’";
    baseDesc = `공통된 1개 축을 구심점 삼아, 내가 놓치기 쉬운 영역을 파트너가 정확히 커버해주는 입체적인 팀워크 조합입니다(찬스 카드 ${concessionCount}건, 맞춤 조율 ${conflictCount}건).`;
  } else {
    chemistryTitle = "🧲 정반대 매력으로 완성되는 ‘극과 극 퍼즐 커플’";
    baseDesc = `4개 축의 방향이 모두 달라 처음엔 신기할 수 있지만, 역할 분담과 예산 균형 면에서는 오히려 한쪽으로 폭주하지 않는 가장 완벽한 퍼즐 조합입니다(찬스 카드 ${concessionCount}건, 맞춤 조율 ${conflictCount}건).`;
  }

  const subPersonaComparison =
    myReport.subPersona.archetypeKey === partnerReport.subPersona.archetypeKey
      ? `더구나 두 분 모두 ‘${myReport.subPersona.focusBadge.replace(/^[^\s]+\s세부 결:\s/, "")}’ 결을 공유하고 있어 핵심 가치에서 깊은 공감을 나눕니다.`
      : `나는 ‘${myReport.subPersona.focusBadge.replace(/^[^\s]+\s세부 결:\s/, "")}’, 파트너는 ‘${partnerReport.subPersona.focusBadge.replace(/^[^\s]+\s세부 결:\s/, "")}’에 초점이 맞춰져 있어 각자의 1순위 구역만 존중해주면 만족도가 배가됩니다.`;

  const familyNote =
    myAnswers.Q16 && partnerAnswers.Q16 && myAnswers.Q16 !== partnerAnswers.Q16
      ? " 특히 양가 어른과 상의하는 순서(Q16)는 각자 집안 분위기에 맞춰 유연하게 조율해 보세요."
      : "";

  return {
    matchedAxisCount,
    chemistryTitle,
    matchStatsBadge,
    chemistryNarrative: `${baseDesc} ${subPersonaComparison}${familyNote}`,
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

  if (myAxes.axis1.winner !== pAxes.axis1.winner) {
    const meIsS = myAxes.axis1.winner === "S";
    translations.push({
      triggerSituation: "웅장한 무대·폭넓은 하객 초대(S) vs 소규모 오붓한 교류(I)를 두고 이야기할 때",
      myInnerThought: meIsS
        ? "‘인생에 한 번뿐인 큰 잔치인데, 너무 조용하게만 치르면 나중에 허전하거나 어른들께 아쉽지 않을까?’"
        : "‘잘 모르는 하객들까지 잔뜩 불러 인사만 바쁘게 하다가 정작 소중한 사람들과 눈도 못 맞추면 어떡하지?’",
      partnerInnerThought: meIsS
        ? "‘축하받는 게 싫은 게 아니라, 낯선 시선에 긴장하기보다 진짜 우리 편인 사람들과 깊이 교감하고 싶은 거야.’"
        : "‘허세를 부리려는 게 아니라, 그동안 고마웠던 분들과 양가 어른들께 제대로 인사드리고 축복받고 싶은 거야.’",
      bridgePrescription:
        "본식 홀과 하객 규모는 양가 입장을 고려해 적정선을 갖추되(S 충족), 식순을 간소화해 테이블 인사 시간을 늘리거나 친한 지인들과의 2부 애프터 티타임을 별도로 마련해 보세요(I 충족).",
    });
  }

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

  if (
    (myAnswers.Q16 === "A" && partnerAnswers.Q16 === "B") ||
    (myAnswers.Q16 === "B" && partnerAnswers.Q16 === "A")
  ) {
    const meIsParentFirst = myAnswers.Q16 === "A";
    translations.push({
      triggerSituation: "양가 부모님께 먼저 여쭙기(A) vs 우리 둘이 먼저 확정하기(B)로 의견이 다를 때",
      myInnerThought: meIsParentFirst
        ? "‘어른들께 미리 여쭙지 않고 우리끼리 다 정했다가 나중에 서운해하시거나 처음부터 다시 뒤집히면 어떡하지?’"
        : "‘우리 기준도 안 세운 채 양가 의견부터 다 듣기 시작하면 배가 산으로 가고 우리 결혼식이 아니게 되지 않을까?’",
      partnerInnerThought: meIsParentFirst
        ? "‘부모님을 무시하려는 게 아니라, 우리 두 사람의 중심을 먼저 세워야 양가 조율도 흔들리지 않고 할 수 있다는 뜻이야.’"
        : "‘마마보이/마마걸이어서가 아니라, 우리 부모님의 성향을 잘 알기에 미리 여쭙는 모양새를 취해야 오히려 우리 뜻대로 평화롭게 진행할 수 있어서 그래.’",
      bridgePrescription:
        "두 사람의 핵심 기준(총예산·지역)은 먼저 맞추되, 각자 자기 본가 부모님께는 그 집안 성향에 맞는 타이밍과 화법(‘의견 여쭙기’ vs ‘정리된 후보 공유’)으로 소통 창구를 일원화하세요.",
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
      if (SPEND_FEATURE_QUESTION_IDS.has(q.id)) {
        saveSimplify12.push(entry);
      }
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
  // 당일 지출·연출 항목(SPEND_FEATURE_QUESTION_IDS) 중 상대적으로 낮은 점수(③ 또는 ⑤ 대비 ④)를 준 항목을 찾아
  // '내가 미처 몰랐던 상대적 힘 빼기 후보'로 안내한다.
  const relativeSaveSuggestions: BasketItemEntry[] = [];
  if (saveSimplify12.length === 0) {
    const candidateIds: readonly QuestionId[] = [
      "Q5",
      "Q7",
      "Q8",
      "Q9",
      "Q10",
      "Q3",
      "Q4",
      "Q1",
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

  const trimmedRelativeSaves = relativeSaveSuggestions.slice(0, 3);
  const subPersona = buildSubPersona19(
    code,
    character,
    answers,
    topPrioritySet,
    mustHave5,
    niceToHave4,
    saveSimplify12,
    trimmedRelativeSaves,
    concession3D,
    balancedC,
  );
  const decisionStyle = buildDecisionStyleProfile19(
    mustHave5,
    niceToHave4,
    saveSimplify12,
    concession3D,
    balancedC,
    undecidedUnknownE,
  );
  const hiddenPsychology = buildHiddenPsychologyInsight19(
    answers,
    axes,
    subPersona,
    mustHave5,
    saveSimplify12,
  );

  return {
    code,
    character,
    subPersona,
    decisionStyle,
    axes,
    topPriorityIds: topPriorityItems.map((i) => i.questionId),
    topPriorityItems,
    basket: {
      mustHave5,
      niceToHave4,
      saveSimplify12,
      relativeSaveSuggestions: trimmedRelativeSaves,
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

  const coupleChemistrySummary = buildCoupleChemistrySummary19(
    myReport,
    partnerReport,
    alignedItems.length,
    concessionMatches.length,
    conflictItems.length,
    myAnswers,
    partnerAnswers,
  );

  const empathyBridge = buildCoupleEmpathyBridge19(
    myReport,
    partnerReport,
    myAnswers,
    partnerAnswers,
  );

  return {
    myReport,
    partnerReport,
    coupleChemistrySummary,
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

  const topPriorityIds: QuestionId[] = (
    isD ? (["Q5", "Q8"] as const) : (["Q6", "Q7"] as const)
  ).filter((qId) => answers[qId] === 5);
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
  const spendMustHave = personalReport.basket.mustHave5.filter((item) =>
    SPEND_FEATURE_QUESTION_IDS.has(item.questionId),
  );
  const principleMustHave = personalReport.basket.mustHave5.filter(
    (item) => !SPEND_FEATURE_QUESTION_IDS.has(item.questionId),
  );
  const mustHaveTitles = (
    spendMustHave.length > 0 ? spendMustHave : principleMustHave
  )
    .slice(0, 3)
    .map((item) => (item.isTopPriority ? `${item.shortTitle}(타협 불가 1순위)` : item.shortTitle));
  const saveTitles = personalReport.basket.saveSimplify12
    .filter((item) => SPEND_FEATURE_QUESTION_IDS.has(item.questionId))
    .slice(0, 3)
    .map((item) => item.shortTitle);
  const concessionTitles = personalReport.basket.concession3D
    .filter((item) => item.questionNumber <= 10)
    .slice(0, 2)
    .map((item) => item.shortTitle);

  const parts: string[] = [
    `방금 웨딩코드 테스트를 했는데 내 유형은 [${charLabel}]이야.`,
  ];
  if (mustHaveTitles.length > 0) {
    parts.push(
      spendMustHave.length > 0
        ? `꼭 챙기고 싶은 1순위는 '${mustHaveTitles.join("·")}'이고,`
        : `중요하게 지키고 싶은 준비 기준은 '${mustHaveTitles.join("·")}'이고,`,
    );
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

export interface WeddingCode19AmoraPersonalizationPayload {
  decisionStart: "recommend_first" | "compare_first" | "ask_each_time";
  answerDetail: "brief" | "detailed" | "adaptive";
  supportOrder: "listen_first" | "action_first" | "ask_each_time";
  workMode: "together" | "owner_led" | "hybrid" | "ask_each_time";
  familyOrder: "couple_first" | "family_input_first" | "case_by_case" | "ask_each_time";
  toneStyle: "adaptive" | "warm" | "calm_clear" | "friendly_honest";
}

export function buildWeddingCode19AmoraPersonalization(
  answers: WeddingCode19Answers,
): WeddingCode19AmoraPersonalizationPayload {
  const decisionStart: WeddingCode19AmoraPersonalizationPayload["decisionStart"] =
    answers.Q14 === "A" ||
    (answers.Q14 !== "B" && (answers.Q11 === 4 || answers.Q11 === 5))
      ? "compare_first"
      : answers.Q14 === "B" ||
          (answers.Q11 === 1 || answers.Q11 === 2)
        ? "recommend_first"
        : "ask_each_time";

  const answerDetail: WeddingCode19AmoraPersonalizationPayload["answerDetail"] =
    answers.Q11 === 4 || answers.Q11 === 5
      ? "detailed"
      : answers.Q11 === 1 || answers.Q11 === 2
        ? "brief"
        : "adaptive";

  const workMode: WeddingCode19AmoraPersonalizationPayload["workMode"] =
    answers.Q15 === "A"
      ? "together"
      : answers.Q15 === "B"
        ? "owner_led"
        : answers.Q15 === "C"
          ? "hybrid"
          : "ask_each_time";

  const familyOrder: WeddingCode19AmoraPersonalizationPayload["familyOrder"] =
    answers.Q16 === "A"
      ? "family_input_first"
      : answers.Q16 === "B"
        ? "couple_first"
        : answers.Q16 === "C"
          ? "case_by_case"
          : "ask_each_time";

  const supportOrder: WeddingCode19AmoraPersonalizationPayload["supportOrder"] =
    answers.Q19 === "A"
      ? "listen_first"
      : answers.Q19 === "B"
        ? "action_first"
        : "ask_each_time";

  const toneStyle: WeddingCode19AmoraPersonalizationPayload["toneStyle"] =
    answers.Q19 === "A"
      ? "warm"
      : answers.Q19 === "B"
        ? "calm_clear"
        : "adaptive";

  return {
    decisionStart,
    answerDetail,
    supportOrder,
    workMode,
    familyOrder,
    toneStyle,
  };
}

