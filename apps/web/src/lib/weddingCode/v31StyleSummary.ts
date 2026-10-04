import {
  WEDDING_CODE_V31_OPTIONS,
  WEDDING_CODE_V31_QUESTIONS,
  WEDDING_CODE_V31_TOPICS,
  WEDDING_CODE_V31_VERSION,
  type V31Draft,
  type V31QuestionId,
  type V31Rating,
  type V31Response,
  type V31Topic,
} from "@/constants/weddingCodeV31";
import { v31ResponseLabel } from "@/lib/weddingCode/v31";

export const V31_STYLE_SUMMARY_VERSION = "response-summary-1" as const;
export type V31StyleKey = "budget" | "teamwork" | "family" | "support";
export type V31StyleLetter = "K" | "R" | "T" | "D" | "F" | "C" | "L" | "A" | "B" | "M" | "N" | "?";
type PositiveLetter = Exclude<V31StyleLetter, "B" | "M" | "N" | "?">;
type PositiveDefinition = { id: V31QuestionId; letter: PositiveLetter; englishLabel: string; label: string };
type DimensionDefinition = { key: V31StyleKey; title: string; topicName: string; first: PositiveDefinition; second: PositiveDefinition };

/** 서로 반대인 척도가 아니라, 같은 주제에서 함께 성립할 수 있는 두 응답이다. */
export const V31_STYLE_DIMENSIONS = [
  {
    key: "budget", title: "예산을 정할 때", topicName: "예산",
    first: { id: "B1", letter: "K", englishLabel: "Keep", label: "처음 정한 전체 예산 지키기" },
    second: { id: "B3", letter: "R", englishLabel: "Revisit", label: "전체 예산을 늘릴지 다시 의논하기" },
  },
  {
    key: "teamwork", title: "일을 나눌 때", topicName: "일 나누기",
    first: { id: "T1", letter: "T", englishLabel: "Together", label: "시간을 맞춰 함께 업체 찾아보기" },
    second: { id: "T2", letter: "D", englishLabel: "Delegate", label: "계약·추가 결제 없는 세부 선택은 맡은 사람이 정해도 괜찮아요" },
  },
  {
    key: "family", title: "가족과 상의할 때", topicName: "가족과 상의",
    first: { id: "F1", letter: "F", englishLabel: "Family", label: "가족의 바람을 준비 초반에 듣기" },
    second: { id: "F2", letter: "C", englishLabel: "Couple", label: "마지막 선택은 둘이 하기" },
  },
  {
    key: "support", title: "도움을 받고 싶을 때", topicName: "받고 싶은 도움",
    first: { id: "H1", letter: "L", englishLabel: "Listen", label: "해결책 전에 이야기 들어주기" },
    second: { id: "H2", letter: "A", englishLabel: "Assist", label: "몰린 일의 일부 맡아주기" },
  },
] as const satisfies readonly DimensionDefinition[];

export type V31StatementScale = {
  id: V31QuestionId;
  topic: V31Topic;
  statement: string;
  shortLabel: string;
  response: V31Response | undefined;
  responseLabel: string;
  /** 다섯 보기 중 고른 칸(1~5). 아직 모름·이번 계획에 없음·지금 답하지 않음·안 본 문장은 칸으로 바꾸지 않는다. */
  rating: V31Rating | null;
};
export type V31StatementScaleGroup = { key: V31Topic; title: string; items: V31StatementScale[] };
/** ‘?’ 자리의 이유. 계획에 없다는 답은 끝난 답이라 다시 보라고 안내하지 않는다. */
export type V31StylePending = "not_in_plan" | "open" | null;
export type V31StyleDimension = {
  key: V31StyleKey;
  title: string;
  topicName: string;
  letter: V31StyleLetter;
  /** 영문 머리글자의 원래 낱말. 한 문장에서 나온 글자에만 있고 화면에서는 보조로만 쓴다. */
  englishLabel: string | null;
  /**
   * 한 문장에서 나온 글자(K·R·T·D·F·C·L·A)의 출처 문장. 화면은 글자 뜻을 따로 한 줄 더 쓰지 않고
   * 이 문장의 답 줄에 영문 낱말을 붙인다(뜻 줄과 답 줄이 같은 말을 되풀이하지 않게). 그 밖에는 null.
   */
  letterFrom: V31QuestionId | null;
  label: string;
  /**
   * 글자가 왜 그렇게 정해졌는지 답 줄만으로 알 수 없을 때만 쓰는 한 줄. 한 문장·두 문장 모두에서 나온 글자는
   * 왜 다른 글자가 아닌지를 알려 주므로 남기고, ‘?’·M·N 자리는 라벨과 답 줄이 이미 말하므로 null 이다.
   */
  basis: string | null;
  ratedCount: number;
  /** 한 문장만 ‘그런 편’ 이상인 한쪽 글자이고, 두 문장의 답이 정확히 한 칸 차이(4 대 3, 3 대 4)인 자리. */
  borderline: boolean;
  pending: V31StylePending;
  items: [V31StatementScale, V31StatementScale];
};
/**
 * 네 글자 요약. 2026-09-27 파운더 결정으로 ‘~스타일’ 이름·이름 출처 줄·이름에 딸린 헤드라인은 두지 않는다.
 * 코드 옆에는 코드와 주제별 줄(글자, 글자 뜻 한 줄, 두 문장의 실제 답)이 있다. 한 문장에서 나온 글자(K·R·T·D·F·C·L·A)는
 * 뜻 줄을 따로 두지 않고 그 문장의 답 줄에 영문 낱말을 붙이며, 글자가 정해진 자리(이 여덟 글자와 B)에는 근거 한 줄이 붙는다.
 */
export type V31StyleSummary = {
  version: typeof V31_STYLE_SUMMARY_VERSION;
  code: string;
  hasIncomplete: boolean;
  borderlineCount: number;
  /** 코드보다 먼저, 아슬한 글자를 주제 이름과 실제로 고른 두 보기 이름으로 알리는 한 줄. 그런 글자가 없으면 null. */
  borderlineNotice: string | null;
  /** 모든 코드에 한 번 붙는 한 줄(V31_STYLE_CHANGE_NOTICE). 정해진 글자가 하나도 없으면 null. */
  changeNotice: string | null;
  /** ‘?’ 자리를 설명하는 한 줄. ‘?’가 없으면 null. */
  pendingNotice: string | null;
  dimensions: V31StyleDimension[];
};

/**
 * 아슬한 글자가 있든 없든 참인 한 줄. 아슬한 글자가 0개여도 다시 답하면 글자가 바뀔 수 있다(PRINCIPLES.md 5절).
 * 예전 0개일 때의 「지금 글자는 답 하나를 한 칸 옮겨도 그대로예요」는 새 기준에서 거짓이라 쓰지 않는다
 * (예: 4 대 4 의 B 는 아슬하지 않지만 4를 한 칸 내리면 글자가 바뀐다).
 */
export const V31_STYLE_CHANGE_NOTICE = "아래 글자는 다시 답하면 달라질 수 있어요." as const;

const BOTH_LABELS: Record<V31StyleKey, string> = {
  budget: "전체 예산은 지키고 싶고, 늘릴지도 다시 의논하고 싶어요",
  teamwork: "함께 찾고, 계약·추가 결제 없는 세부 선택은 맡겨도 괜찮아요",
  family: "가족의 바람은 초반에 듣고, 마지막 선택은 둘이 하고 싶어요",
  support: "이야기를 먼저 들어주고, 몰린 일 일부도 맡아주길 바라요",
};

/** ‘그런 편이에요’(4) 이상이면 그 문장 쪽으로 기운 답이다. */
const AGREE_FROM: V31Rating = 4;
/** ‘그렇지 않은 편이에요’(2) 이하면 낮게 답한 것이다. */
const DISAGREE_UNTIL: V31Rating = 2;
/**
 * 아슬한 칸(4 대 3, 3 대 4)에서 사용자가 실제로 누른 두 보기 이름. 안내가 보기 이름을 인용하므로 문자열을 따로 적지 않고
 * 질문 화면의 보기에서 가져온다(보기 이름이 바뀌면 안내도 같이 바뀐다).
 */
const BORDERLINE_AGREE_LABEL = WEDDING_CODE_V31_OPTIONS.find(option => option.value === AGREE_FROM)!.label;
const BORDERLINE_NEUTRAL_LABEL = WEDDING_CODE_V31_OPTIONS.find(option => option.value === AGREE_FROM - 1)!.label;

/**
 * 아슬한 글자 줄에 다는 글로 된 표시. 「한 칸 차이」만 적으면 표시가 없는 줄 가운데 두 답이 한 칸 차이인 곳
 * (5 대 4 의 B, 2 대 3 의 M, 1 대 2 의 N)도 칠한 칸으로 보이는 같은 성질이라, 표시 없는 줄은 한 칸 차이가 아니라고 읽힌다.
 * 그래서 아슬한 칸에서만 참인 사실(두 답이 ‘그런 편이에요’와 ‘어느 쪽도 아니에요’)을 줄여 적는다.
 */
export const V31_STYLE_BORDERLINE_TAG = "‘그런 편’과 ‘어느 쪽도’로 갈렸어요" as const;

export function getV31Rating(response: V31Response | undefined): V31Rating | null {
  return typeof response === "number" && Number.isInteger(response) && response >= 1 && response <= 5
    ? response as V31Rating
    : null;
}

/** 다섯 칸 중 고른 칸까지 칠한다. 선호 확률이나 비율이 아니라 고른 보기의 자리다. */
export function formatV31RatingDots(rating: V31Rating): string {
  return "●".repeat(rating) + "○".repeat(5 - rating);
}

function definitionOf(key: V31StyleKey): DimensionDefinition {
  return V31_STYLE_DIMENSIONS.find(item => item.key === key)!;
}

/** 한 자리 글자를 두 문장의 답(1~5)으로 정한다. 둘 중 하나라도 칸으로 고른 답이 아니면 ‘?’다. */
export function getV31StyleLetter(key: V31StyleKey, first: V31Response | undefined, second: V31Response | undefined): V31StyleLetter {
  const definition = definitionOf(key);
  const a = getV31Rating(first);
  const b = getV31Rating(second);
  if (a === null || b === null) return "?";
  if (a >= AGREE_FROM && b >= AGREE_FROM) return "B";
  if (a >= AGREE_FROM) return definition.first.letter;
  if (b >= AGREE_FROM) return definition.second.letter;
  if (a <= DISAGREE_UNTIL && b <= DISAGREE_UNTIL) return "N";
  return "M";
}

/**
 * 아슬한 글자(2026-09-27 파운더 결정 「아슬한 글자 기준도 바꿔줘」): 한 문장만 ‘그런 편’ 이상인 한쪽 글자
 * (K·R·T·D·F·C·L·A)이고, 두 문장의 답이 정확히 한 칸 차이일 때만이다. 글자 규칙상 4 대 3 과 3 대 4 두 칸뿐이다.
 * 두 방향 중 한쪽으로 한 칸 차이로만 기운 글자라는 뜻이다. B·M·N·‘?’는 아슬하다고 하지 않는다.
 * 예전 기준(두 답 중 하나를 ±1 옮겨 글자가 바뀌면 아슬)은 25칸 중 19칸이었다. 답이 25칸에 고르게, 주제끼리 따로
 * 흩어진다고 치면 네 주제 중 하나라도 걸릴 확률이 약 99.7%다(계산값이며 실제 사용자 비율은 재지 않았다).
 */
export function isV31StyleLetterBorderline(key: V31StyleKey, first: V31Response | undefined, second: V31Response | undefined): boolean {
  const definition = definitionOf(key);
  const letter = getV31StyleLetter(key, first, second);
  const a = getV31Rating(first);
  const b = getV31Rating(second);
  if (a === null || b === null) return false;
  if (letter !== definition.first.letter && letter !== definition.second.letter) return false;
  return Math.abs(a - b) === 1;
}

function assertVersion(draft: V31Draft): void {
  if (draft.version !== WEDDING_CODE_V31_VERSION) throw new Error("이 응답 요약은 웨딩코드 v3.1의 답에만 사용할 수 있어요.");
}
function statementScale(draft: V31Draft, id: V31QuestionId): V31StatementScale {
  const question = WEDDING_CODE_V31_QUESTIONS.find(item => item.id === id)!;
  const response = draft.answers[id];
  return { id, topic: question.topic, statement: question.statement, shortLabel: question.shortLabel, response, responseLabel: v31ResponseLabel(response), rating: getV31Rating(response) };
}

function pendingOf(items: readonly V31StatementScale[]): V31StylePending {
  if (items.every(item => item.rating !== null)) return null;
  return items.some(item => item.response === "not_applicable") ? "not_in_plan" : "open";
}

/**
 * ‘?’·M·N 자리는 라벨 한 줄만 둔다. 바로 아래 답 줄이 고른 답을 그대로 보여주므로, 같은 사정을
 * 근거 줄에서 한 번 더 말하지 않는다. ‘?’가 왜 생겼고 어떻게 하면 글자가 생기는지는 카드 위 안내가 한 번 말한다.
 */
function dimension(draft: V31Draft, definition: DimensionDefinition): V31StyleDimension {
  const items: V31StyleDimension["items"] = [statementScale(draft, definition.first.id), statementScale(draft, definition.second.id)];
  const [first, second] = items;
  const letter = getV31StyleLetter(definition.key, first.response, second.response);
  const pending = pendingOf(items);
  const base = {
    key: definition.key, title: definition.title, topicName: definition.topicName, letter,
    ratedCount: items.filter(item => item.rating !== null).length,
    borderline: isV31StyleLetterBorderline(definition.key, first.response, second.response),
    pending, items,
  };
  if (pending === "not_in_plan") {
    const both = items.every(item => item.response === "not_applicable");
    return {
      ...base, englishLabel: null, letterFrom: null,
      label: both ? "두 문장 모두 이번 계획에 없어요" : "한 문장이 이번 계획에 없어요",
      basis: null,
    };
  }
  if (pending === "open") return { ...base, englishLabel: null, letterFrom: null, label: "아직 글자가 없어요", basis: null };
  if (letter === "B") return {
    ...base, englishLabel: null, letterFrom: null, label: BOTH_LABELS[definition.key],
    basis: "두 문장 모두 ‘그런 편이에요’나 ‘매우 그래요’로 답했어요. 어느 쪽이 더 와닿는지는 칠한 칸 수로 견줘 볼 수 있어요.",
  };
  if (letter === definition.first.letter || letter === definition.second.letter) {
    const selected = letter === definition.first.letter ? definition.first : definition.second;
    return {
      ...base, englishLabel: selected.englishLabel, letterFrom: selected.id, label: selected.label,
      basis: "한 문장만 ‘그런 편이에요’나 ‘매우 그래요’로 답했어요.",
    };
  }
  if (letter === "N") return { ...base, englishLabel: null, letterFrom: null, label: "두 문장 모두 ‘그렇지 않은 편이에요’나 ‘전혀 그렇지 않아요’로 답했어요", basis: null };
  return { ...base, englishLabel: null, letterFrom: null, label: "‘어느 쪽도 아니에요’로 답한 문장이 있어요", basis: null };
}

function quotedTopics(dimensions: V31StyleDimension[]): string {
  return dimensions.map(item => `‘${item.topicName}’`).join(", ");
}

/**
 * 코드보다 먼저 보여주는 한 줄. 아슬한 글자를 주제 이름으로 적고(밑줄 같은 눈으로만 보이는 표시를 가리키지 않아야
 * 화면 읽기 프로그램으로도 어느 글자인지 안다), 두 답으로 실제로 고른 보기 이름을 ‘’ 안에 인용한다.
 * 「한 칸 차이」만 적으면 두 답이 한 칸 차이인 B·M·N 자리도 같은 말에 들어맞는다. 보기 이름까지 적으면 4 대 3·3 대 4
 * 에서만 참이고, 어느 문장에 어느 보기를 골랐는지는 말하지 않으므로 두 칸 모두에서 참이다. 그런 글자가 없으면 쓰지 않는다.
 * 보기 이름은 반드시 ‘’ 안에 둔다(‘어느 쪽도 아니에요’를 밖에 두면 판정 고지처럼 읽힌다).
 * 다시 답하면 바뀔 수 있다는 말은 이 줄이 아니라 changeNotice 가 모든 코드에 한 번 한다.
 */
function borderlineNotice(dimensions: V31StyleDimension[]): string | null {
  const borderline = dimensions.filter(item => item.borderline);
  if (!borderline.length) return null;
  const split = `두 문장의 답이 ‘${BORDERLINE_AGREE_LABEL}’와 ‘${BORDERLINE_NEUTRAL_LABEL}’로 한 칸 차이예요.`;
  if (borderline.length === dimensions.length) return `네 글자 모두 ${split}`;
  return `${quotedTopics(borderline)} 글자는 ${split}`;
}

/** 정해진 글자가 하나라도 있으면 붙인다. 모두 ‘?’면 카드 위 ‘?’ 안내가 글자가 생기는 길을 따로 말한다. */
function changeNotice(dimensions: V31StyleDimension[]): string | null {
  return dimensions.some(item => item.letter !== "?") ? V31_STYLE_CHANGE_NOTICE : null;
}

/**
 * ‘?’ 자리를 카드 위에서 한 번 설명한다.
 * - 아직 모름·지금 답하지 않음·안 본 문장이 있는 주제: 그 문장의 동의 정도를 고르면 글자가 생긴다고 알린다
 *   (그 주제에는 계획에 없다는 답이 없으므로 남은 문장만 고르면 글자가 생긴다).
 * - 두 문장 모두 이번 계획에 없는 주제와, 한 문장만 그런 주제는 나눠 적는다. 한 문장만 계획에 없다고 답했는데
 *   주제 전체를 계획에 없다고 답했다고 적지 않는다. 남은 문장만 다시 답해도 글자는 생기지 않으므로 다시 보라고 하지 않는다.
 */
function pendingNotice(dimensions: V31StyleDimension[]): string | null {
  const open = dimensions.filter(item => item.pending === "open");
  const notInPlan = dimensions.filter(item => item.pending === "not_in_plan");
  const allNa = notInPlan.filter(item => item.items.every(entry => entry.response === "not_applicable"));
  const oneNa = notInPlan.filter(item => !allNa.includes(item));
  const oneNaPart = `${quotedTopics(oneNa)} 주제는 한 문장에 ‘이번 계획에는 없어요’로 답해서 ‘?’로 적었어요.`;
  const sentences = [
    open.length ? `${quotedTopics(open)} 주제는 아직 모르거나 답하지 않은 문장이 있어서 ‘?’로 남겼어요. 그대로 둬도 괜찮고, 동의하는 정도를 고르면 그때 글자가 생겨요.` : null,
    allNa.length && oneNa.length ? `${quotedTopics(allNa)} 주제는 이번 계획에 없다고 답했고, ${oneNaPart}`
      : allNa.length ? `${quotedTopics(allNa)} 주제는 이번 계획에 없다고 답해서 ‘?’로 적었어요.`
        : oneNa.length ? oneNaPart : null,
  ].filter(Boolean);
  return sentences.length ? sentences.join(" ") : null;
}

export function buildV31StyleSummary(draft: V31Draft): V31StyleSummary {
  assertVersion(draft);
  const dimensions = V31_STYLE_DIMENSIONS.map(definition => dimension(draft, definition));
  return {
    version: V31_STYLE_SUMMARY_VERSION,
    code: dimensions.map(item => item.letter).join(""),
    hasIncomplete: dimensions.some(item => item.letter === "?"),
    borderlineCount: dimensions.filter(item => item.borderline).length,
    borderlineNotice: borderlineNotice(dimensions),
    changeNotice: changeNotice(dimensions),
    pendingNotice: pendingNotice(dimensions),
    dimensions,
  };
}

export function buildV31StatementScales(draft: V31Draft): V31StatementScaleGroup[] {
  assertVersion(draft);
  return WEDDING_CODE_V31_TOPICS.map(topic => ({
    key: topic.key, title: topic.title,
    items: WEDDING_CODE_V31_QUESTIONS.filter(question => question.topic === topic.key && draft.answers[question.id] !== undefined)
      .map(question => statementScale(draft, question.id)),
  })).filter(group => group.items.length > 0);
}
