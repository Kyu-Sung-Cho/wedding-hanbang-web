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

export interface PersonalReport19 {
  code: WeddingCode19Code;
  character: CharacterProfile19;
  axes: {
    axis1: AxisScoreDetail<Axis1Letter, Axis1Letter>;
    axis2: AxisScoreDetail<Axis2Letter, Axis2Letter>;
    axis3: AxisScoreDetail<Axis3Letter, Axis3Letter>;
    axis4: AxisScoreDetail<Axis4Letter, Axis4Letter>;
  };
  topPriorityIds: QuestionId[];
  topPriorityItems: BasketItemEntry[];
  basket: {
    mustHave5: BasketItemEntry[];
    niceToHave4: BasketItemEntry[];
    saveSimplify12: BasketItemEntry[];
    concession3D: BasketItemEntry[];
    balancedC: BasketItemEntry[];
    undecidedUnknownE: BasketItemEntry[];
    hiddenQuestionIds: QuestionId[];
  };
  workstyleSections: WorkstyleManualSection[];
}

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
}

export interface CoupleComparisonReport19 {
  myReport: PersonalReport19;
  partnerReport: PersonalReport19;
  axisSynergies: AxisSynergyEntry[];
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
  let sScore = 0;
  let iScore = 0;
  const q1Dir = getPart1Direction(answers.Q1, "S", "I");
  const q2Dir = getPart1Direction(answers.Q2, "I", "S");
  const q4Dir = getPart1Direction(answers.Q4, "I", "S");
  for (const d of [q1Dir, q2Dir, q4Dir]) {
    if (d.letter === "S") sScore += d.points;
    if (d.letter === "I") iScore += d.points;
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

  // 축 2: D (Dream · 당일 로망파) vs P (Practical · 미래 실속파)
  // Q13: A(+4 D), B(+4 P)
  // Q5, Q8, Q9: 5(+2 D), 4(+1 D), 2(+1 P), 1(+2 P)
  let dScore = 0;
  let pScore = 0;
  if (answers.Q13 === "A") dScore += 4;
  if (answers.Q13 === "B") pScore += 4;
  for (const qId of ["Q5", "Q8", "Q9"] as const) {
    const dir = getPart1Direction(answers[qId], "D", "P");
    if (dir.letter === "D") dScore += dir.points;
    if (dir.letter === "P") pScore += dir.points;
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

  // 축 3: M (Manual · 직접 탐색·계획파) vs E (Easy · 압축·편의파)
  // Q11, Q12: 5(+2 M), 4(+1 M), 2(+1 E), 1(+2 E)
  // Q14: A(+2 M), B(+2 E)
  let mScore = 0;
  let eScore = 0;
  const q11Dir = getPart1Direction(answers.Q11, "M", "E");
  const q12Dir = getPart1Direction(answers.Q12, "M", "E");
  for (const d of [q11Dir, q12Dir]) {
    if (d.letter === "M") mScore += d.points;
    if (d.letter === "E") eScore += d.points;
  }
  if (answers.Q14 === "A") mScore += 2;
  if (answers.Q14 === "B") eScore += 2;

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
      },
    },
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
      concession3D,
      balancedC,
      undecidedUnknownE,
      hiddenQuestionIds,
    },
    workstyleSections,
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
        sharedInterpretation: getItemInterpretationText19(q.id, myAns),
      });
    } else if (isConcessionChoice(myAns) && isDefinitePreference(partnerAns)) {
      concessionMatches.push({
        questionId: q.id,
        questionNumber: q.number,
        category: q.category,
        shortTitle,
        yielder: "me",
        preferredBy: "partner",
        preferredAnswerBadge: formatAnswerBadge19(partnerAns),
        preferredInterpretation: getItemInterpretationText19(q.id, partnerAns),
      });
    } else if (isDefinitePreference(myAns) && isConcessionChoice(partnerAns)) {
      concessionMatches.push({
        questionId: q.id,
        questionNumber: q.number,
        category: q.category,
        shortTitle,
        yielder: "partner",
        preferredBy: "me",
        preferredAnswerBadge: formatAnswerBadge19(myAns),
        preferredInterpretation: getItemInterpretationText19(q.id, myAns),
      });
    } else if (isOppositeDirection(q.id, myAns, partnerAns)) {
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
      };
      conflictItems.push(conflictEntry);
      if (q.id === "Q17" || q.id === "Q18") {
        crisisWarnings.push(conflictEntry);
      }
    }
  }

  return {
    myReport,
    partnerReport,
    axisSynergies,
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

