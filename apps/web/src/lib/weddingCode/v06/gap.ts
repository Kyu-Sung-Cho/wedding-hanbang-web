import {
  WEDDING_CODE_V06_AXES,
  WEDDING_CODE_V06_QUESTIONS,
  weddingCodeV06Question,
  type WeddingCodeV06Axis,
  type WeddingCodeV06AxisKey,
  type WeddingCodeV06OptionValue,
  type WeddingCodeV06Question,
  type WeddingCodeQuestionKey,
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
 * 문장을 그대로 붙여 보여주고, 그 차이를 두 사람이 **어떻게 확인할지**만 말한다.
 * 「너는 "삼백이면 신혼여행 한 번인데", 나는 "여기 아니면 두고두고 아쉬울 것 같았다"」는
 * 성격 주장이 아니라 두 사람이 방금 남긴 **사실**이다. 심리검사 타당도는 주장하지 않지만,
 * 문항 이해도와 다음 대화의 유용성은 사람 검증이 필요하다.
 *
 * 구성개념 가중치는 사용자에게 노출되지 않는다 — **어느 차이를 먼저 보여줄지 고르는
 * 내부 정렬**에만 쓴다.
 */

export type WeddingCodeV06Answers = Partial<
  Record<WeddingCodeQuestionKey, WeddingCodeV06OptionValue>
>;

/** 한 문항에서 두 사람이 갈린(또는 겹친) 지점. */
export type WeddingCodeV06Gap = Readonly<{
  key: WeddingCodeQuestionKey;
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

export type WeddingCodeSceneGapOptions = Readonly<{
  questions?: readonly WeddingCodeV06Question[];
  axes?: readonly WeddingCodeV06Axis[];
}>;

function sideOf(
  question: WeddingCodeV06Question,
  value: WeddingCodeV06OptionValue,
  axes: readonly WeddingCodeV06Axis[],
): "left" | "right" {
  const axis = axes.find((item) => item.key === question.axis)!;
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
  options: WeddingCodeSceneGapOptions = {},
): WeddingCodeV06GapMap {
  const questions = options.questions ?? WEDDING_CODE_V06_QUESTIONS;
  const axes = options.axes ?? WEDDING_CODE_V06_AXES;
  const answered = questions.filter(
    (question) => first[question.key] && second[question.key],
  );
  const missing = questions.length - answered.length;

  // 축별로 몇 개나 갈렸는지 먼저 센다 — 반복되는 차이를 위로 올리기 위해서다.
  const axisSplits = new Map<WeddingCodeV06AxisKey, number>();
  for (const question of answered) {
    const a = first[question.key]!;
    const b = second[question.key]!;
    if (sideOf(question, a, axes) !== sideOf(question, b, axes)) {
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
    const sameSide = sideOf(question, a, axes) === sideOf(question, b, axes);
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
 * 대신 말해주지 않는다. 두 문장을 붙여놓고 **다음 결정 전에 무엇을 확인할지**만 말한다.
 */
export function describeGap(
  gap: WeddingCodeV06Gap,
  names: { first: string; second: string } = { first: "한 사람", second: "다른 한 사람" },
  options: Readonly<{
    axes?: readonly WeddingCodeV06Axis[];
    nextSteps?: Readonly<Partial<Record<WeddingCodeQuestionKey, string>>>;
  }> = {},
): { headline: string; quotes: [string, string]; nextScene: string } {
  const axes = options.axes ?? WEDDING_CODE_V06_AXES;
  const axis = axes.find((item) => item.key === gap.axis)!;
  return {
    headline: `${axis.labelKo}: 여기서 갈렸어요`,
    quotes: [`${names.first}: “${gap.firstLabel}”`, `${names.second}: “${gap.secondLabel}”`],
    nextScene: options.nextSteps?.[gap.key] ?? AXIS_NEXT_STEP[gap.axis],
  };
}

/**
 * 축마다 두 사람이 바로 써볼 수 있는 다음 확인 방법.
 * 미래 행동이나 갈등을 예측하지 않고, 선택 가능한 대화 절차만 제안한다.
 */
const AXIS_NEXT_STEP: Record<WeddingCodeV06AxisKey, string> = {
  decisionCriteria:
    "다음 계약 전에는 각자 먼저 보는 기준을 하나씩 말하고, 총액·포함 항목·취소 조건을 같은 순서로 확인해 보세요.",
  preparationMode:
    "다음 업체 비교 전에는 누가 조사하고, 몇 개로 줄이고, 누가 최종 확인할지 먼저 나눠 보세요.",
  coordinationScope:
    "가족 관련 결정을 시작하기 전에 둘이 정할 범위와 양가에 먼저 물을 범위를 나눠 적어 보세요.",
  supportOrder:
    "힘들다는 말이 나오면 바로 해결하기 전에, 지금은 공감과 해결 중 무엇이 필요한지 먼저 물어보세요.",
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
  questions: readonly WeddingCodeV06Question[] = WEDDING_CODE_V06_QUESTIONS,
): readonly { scene: string; label: string }[] {
  const quotes: { scene: string; label: string }[] = [];
  const usedAxes = new Set<WeddingCodeV06AxisKey>();

  for (const question of questions) {
    const value = answers[question.key];
    if (!value || usedAxes.has(question.axis)) continue;
    usedAxes.add(question.axis);
    quotes.push({ scene: question.scene, label: optionLabel(question, value) });
  }

  for (const question of questions) {
    if (quotes.length >= limit) break;
    const value = answers[question.key];
    if (!value || quotes.some((quote) => quote.scene === question.scene)) continue;
    quotes.push({ scene: question.scene, label: optionLabel(question, value) });
  }
  return quotes.slice(0, limit);
}

export function answeredCount(
  answers: WeddingCodeV06Answers,
  questions: readonly WeddingCodeV06Question[] = WEDDING_CODE_V06_QUESTIONS,
): number {
  return questions.filter((question) => answers[question.key]).length;
}

export { weddingCodeV06Question };
