import {
  WEDDING_CODE_V06_AXES,
  WEDDING_CODE_V06_QUESTIONS,
  weddingCodeV06Question,
  type WeddingCodeV06AxisKey,
  type WeddingCodeV06OptionValue,
  type WeddingCodeV06Question,
  type WeddingCodeV06QuestionKey,
} from "@/constants/weddingCodeV06";

/**
 * 웨딩코드 v0.6 — **차이 지도**.
 *
 * ## v0.5의 커플 리포트가 왜 조합이 아니었나
 *
 * 두 사람 답을 비교하는 로직이 `firstAnswer === secondAnswer ? "same" : "different"` 한 줄이
 * 전부였다. 즉 문항당 분기가 2개뿐이고, 그 뒤에 나오는 조언 본문은 **상대가 뭘 골랐든
 * 똑같은 고정 상수**였다. 「너희 둘이라서 이런 얘기」가 아니라 「이 축이 낮으면 나오는
 * 얘기」였다. 게다가 유일한 커플 payoff가 75/55 3구간 완곡어(「먼저 이야기할 주제가
 * 뚜렷해요」)였는데, 이건 숨긴 등급이라 판정 금지를 어기면서 재미도 없었다.
 *
 * ## v0.6가 대신 하는 것
 *
 * **판정하지 않는다.** 점수·유형·궁합·등급을 만들지 않는다. 대신 두 사람이 실제로 고른
 * 문장을 그대로 붙여 보여주고, 그 차이가 앞으로 **어느 장면에서 또 나오는지**만 말한다.
 * 「너는 "삼백이면 신혼여행 한 번인데", 나는 "여기 아니면 두고두고 아쉬울 것 같았다"」는
 * 성격 주장이 아니라 두 사람이 방금 남긴 **사실**이다. 그래서 타당도 근거가 필요 없다.
 *
 * 구성개념 가중치는 사용자에게 노출되지 않는다 — **어느 차이를 먼저 보여줄지 고르는
 * 내부 정렬**에만 쓴다.
 */

export type WeddingCodeV06Answers = Partial<
  Record<WeddingCodeV06QuestionKey, WeddingCodeV06OptionValue>
>;

/** 한 문항에서 두 사람이 갈린(또는 겹친) 지점. */
export type WeddingCodeV06Gap = Readonly<{
  key: WeddingCodeV06QuestionKey;
  axis: WeddingCodeV06AxisKey;
  scene: string;
  question: string;
  /** 먼저 응답한 쪽이 고른 문장. 그대로 인용된다. */
  firstLabel: string;
  /** 나중에 응답한 쪽이 고른 문장. */
  secondLabel: string;
  /** 같은 선택지를 골랐는가. */
  same: boolean;
  /** 축의 같은 편인가(문장은 달라도 방향이 같은 경우). */
  sameSide: boolean;
  /** 정렬용 내부 점수. 사용자에게 노출하지 않는다. */
  weight: number;
}>;

export type WeddingCodeV06GapMap = Readonly<{
  /** 방향까지 갈린 지점. 많은 순으로 정렬돼 있다. */
  splits: readonly WeddingCodeV06Gap[];
  /** 방향이 같았던 지점. */
  shared: readonly WeddingCodeV06Gap[];
  /** 두 사람이 **같은 문장**을 고른 지점. 안심 재료다. */
  identical: readonly WeddingCodeV06Gap[];
  /** 둘 중 하나라도 답을 안 한 문항 수. */
  missing: number;
}>;

function sideOf(
  question: WeddingCodeV06Question,
  value: WeddingCodeV06OptionValue,
): "left" | "right" {
  const axis = WEDDING_CODE_V06_AXES.find((item) => item.key === question.axis)!;
  const left = axis.left.constructs as readonly string[];
  const option = question.options.find((item) => item.value === value)!;
  return option.weights.some((weight) => left.includes(weight.construct)) ? "left" : "right";
}

function optionLabel(
  question: WeddingCodeV06Question,
  value: WeddingCodeV06OptionValue,
): string {
  return question.options.find((item) => item.value === value)!.label;
}

/**
 * 방향이 갈린 지점을 **먼저** 보여주기 위한 내부 가중치.
 *
 * 같은 축에서 갈린 문항이 많을수록 그 축의 차이가 반복해서 나타난다는 뜻이므로
 * 위로 올린다. 사용자에게는 숫자가 아니라 순서로만 드러난다.
 */
function splitWeight(
  question: WeddingCodeV06Question,
  first: WeddingCodeV06OptionValue,
  second: WeddingCodeV06OptionValue,
  axisSplitCount: number,
): number {
  const paceRisk = [first, second].filter((value) =>
    question.options
      .find((item) => item.value === value)!
      .weights.some((weight) => weight.construct === "decisionPaceRisk"),
  ).length;
  return axisSplitCount * 10 + paceRisk;
}

/**
 * 두 사람 답에서 차이 지도를 만든다.
 *
 * 순서(`first`/`second`)는 **누가 먼저 제출했는지**일 뿐 우열이 아니다. 어느 쪽도
 * 「맞은 답」이 되지 않으며, 이 함수는 어떤 종류의 점수도 계산하지 않는다.
 */
export function buildWeddingCodeV06GapMap(
  first: WeddingCodeV06Answers,
  second: WeddingCodeV06Answers,
): WeddingCodeV06GapMap {
  const answered = WEDDING_CODE_V06_QUESTIONS.filter(
    (question) => first[question.key] && second[question.key],
  );
  const missing = WEDDING_CODE_V06_QUESTIONS.length - answered.length;

  // 축별로 몇 개나 갈렸는지 먼저 센다 — 반복되는 차이를 위로 올리기 위해서다.
  const axisSplits = new Map<WeddingCodeV06AxisKey, number>();
  for (const question of answered) {
    const a = first[question.key]!;
    const b = second[question.key]!;
    if (sideOf(question, a) !== sideOf(question, b)) {
      axisSplits.set(question.axis, (axisSplits.get(question.axis) ?? 0) + 1);
    }
  }

  const splits: WeddingCodeV06Gap[] = [];
  const shared: WeddingCodeV06Gap[] = [];
  const identical: WeddingCodeV06Gap[] = [];

  for (const question of answered) {
    const a = first[question.key]!;
    const b = second[question.key]!;
    const same = a === b;
    const sameSide = sideOf(question, a) === sideOf(question, b);
    const gap: WeddingCodeV06Gap = {
      key: question.key,
      axis: question.axis,
      scene: question.scene,
      question: question.question,
      firstLabel: optionLabel(question, a),
      secondLabel: optionLabel(question, b),
      same,
      sameSide,
      weight: sameSide ? 0 : splitWeight(question, a, b, axisSplits.get(question.axis) ?? 1),
    };
    if (same) identical.push(gap);
    else if (sameSide) shared.push(gap);
    else splits.push(gap);
  }

  // 정렬은 결정적이어야 한다 — 같은 응답 쌍이면 언제 열어도 같은 순서로 보여야 한다.
  const byWeightThenKey = (x: WeddingCodeV06Gap, y: WeddingCodeV06Gap) =>
    y.weight - x.weight || x.key.localeCompare(y.key);

  return {
    splits: [...splits].sort(byWeightThenKey),
    shared: [...shared].sort((x, y) => x.key.localeCompare(y.key)),
    identical: [...identical].sort((x, y) => x.key.localeCompare(y.key)),
    missing,
  };
}

/**
 * 결과 화면에 실제로 띄울 갈림들.
 *
 * 단순히 상위 N개를 자르면 **전부 같은 축**이 나온다 — 가장 많이 갈린 축이 정렬 맨 위를
 * 독차지하기 때문이다. 그러면 제목도 마무리 문장도 똑같은 게 세 번 반복돼서, 공들여 만든
 * 결과가 복사·붙여넣기처럼 읽힌다(실측: 10곳이 갈린 커플에게 「준비를 어떻게 나누나」가
 * 세 번 연달아 나왔다).
 *
 * 그래서 **축마다 가장 무거운 갈림 하나씩**을 축 순서대로 집는다. 축이 모자라면 남은
 * 갈림에서 채운다.
 */
export function topGapsForDisplay(
  map: WeddingCodeV06GapMap,
  limit = 3,
): readonly WeddingCodeV06Gap[] {
  const picked: WeddingCodeV06Gap[] = [];
  const usedAxes = new Set<WeddingCodeV06AxisKey>();
  for (const gap of map.splits) {
    if (picked.length >= limit) break;
    if (usedAxes.has(gap.axis)) continue;
    usedAxes.add(gap.axis);
    picked.push(gap);
  }
  for (const gap of map.splits) {
    if (picked.length >= limit) break;
    if (picked.includes(gap)) continue;
    picked.push(gap);
  }
  return picked;
}

/**
 * 갈린 지점 하나를 읽을 수 있는 한 문단으로.
 *
 * 판정하지 않는다 — 어느 쪽이 옳다고 말하지 않고, 상대를 평가하지 않으며,
 * 대신 말해주지 않는다. 두 문장을 붙여놓고 **그 차이가 다음에 어디서 또 나오는지**만 말한다.
 */
export function describeGap(
  gap: WeddingCodeV06Gap,
  names: { first: string; second: string } = { first: "한 사람", second: "다른 한 사람" },
): { headline: string; quotes: [string, string]; nextScene: string } {
  const axis = WEDDING_CODE_V06_AXES.find((item) => item.key === gap.axis)!;
  return {
    headline: `${axis.labelKo} — 여기서 갈렸어요`,
    quotes: [`${names.first}: “${gap.firstLabel}”`, `${names.second}: “${gap.secondLabel}”`],
    nextScene: AXIS_NEXT_SCENE[gap.axis],
  };
}

/**
 * 축마다 「이 차이가 다음에 또 나오는 자리」.
 *
 * 예언이 아니라 **일정표의 사실**이다 — 결혼 준비에서 실제로 그 결정이 다시 오는 지점을
 * 적었다. 그래서 근거가 필요 없고, 틀릴 수도 없다.
 */
const AXIS_NEXT_SCENE: Record<WeddingCodeV06AxisKey, string> = {
  decisionCriteria:
    "이 차이는 계약서에 서명하기 전에 최소 세 번 더 나와요 — 예식장, 스드메, 그리고 추가금 항목을 정할 때.",
  preparationMode:
    "이 차이는 투어 일정을 잡을 때마다 나와요. 누가 알아보고 누가 정할지를 매번 다시 정하게 돼요.",
  coordinationScope:
    "이 차이는 상견례, 하객 명단, 예식 절차를 정할 때 세 번 더 나와요.",
  supportOrder:
    "이 차이는 준비가 몰리는 달마다 나와요. 한쪽이 지쳤을 때 상대가 뭘 해줘야 하는지가 매번 갈려요.",
};

/**
 * 한 사람 몫 요약 — **자기가 고른 문장을 그대로 돌려준다.**
 *
 * v0.5의 개인 결과는 하드코딩 12문장 중 1개 + 축 이름 1개가 개인화의 전부였고,
 * **사용자가 실제로 고른 문구를 단 한 번도 인용하지 않았다.** 재료를 손에 쥐고 안 썼다.
 */
export function ownAnswerQuotes(
  answers: WeddingCodeV06Answers,
  limit = 3,
): readonly { scene: string; label: string }[] {
  const quotes: { scene: string; label: string }[] = [];
  for (const question of WEDDING_CODE_V06_QUESTIONS) {
    const value = answers[question.key];
    if (!value) continue;
    quotes.push({ scene: question.scene, label: optionLabel(question, value) });
  }
  return quotes.slice(0, limit);
}

export function answeredCount(answers: WeddingCodeV06Answers): number {
  return WEDDING_CODE_V06_QUESTIONS.filter((question) => answers[question.key]).length;
}

export { weddingCodeV06Question };
