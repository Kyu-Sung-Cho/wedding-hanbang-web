import {
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
    second: { id: "T2", letter: "D", englishLabel: "Delegate", label: "계약·추가 결제 없는 세부 선택 맡기기" },
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
  /** 두 답 중 하나만 한 칸 달라져도 글자가 바뀌는 자리. */
  borderline: boolean;
  pending: V31StylePending;
  items: [V31StatementScale, V31StatementScale];
};
export type V31StyleSummary = {
  version: typeof V31_STYLE_SUMMARY_VERSION;
  code: string;
  name: string;
  /** 이름을 따온 주제. 이름을 붙이지 않았으면 null. */
  nameFrom: V31StyleKey | null;
  /** 이름 위에 붙는 출처 한 줄. */
  nameSource: string;
  headline: string;
  hasIncomplete: boolean;
  borderlineCount: number;
  /** 코드보다 먼저 보여주는 한 줄. 글자가 하나도 정해지지 않았으면 null. */
  borderlineNotice: string | null;
  /** ‘?’ 자리를 설명하는 한 줄. ‘?’가 없으면 null. */
  pendingNotice: string | null;
  dimensions: V31StyleDimension[];
};

const BOTH_LABELS: Record<V31StyleKey, string> = {
  budget: "총액은 지키고 싶고, 늘릴지도 다시 의논하고 싶어요",
  teamwork: "함께 찾고, 계약·추가 결제 없는 세부 선택은 맡겨도 괜찮아요",
  family: "가족의 바람은 초반에 듣고, 마지막 선택은 둘이 하고 싶어요",
  support: "이야기를 먼저 들어주고, 몰린 일 일부도 맡아주길 바라요",
};

/** ‘그런 편이에요’(4) 이상이면 그 문장 쪽으로 기운 답이다. */
const AGREE_FROM: V31Rating = 4;
/** ‘그렇지 않은 편이에요’(2) 이하면 낮게 답한 것이다. */
const DISAGREE_UNTIL: V31Rating = 2;

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
 * 두 답 중 하나를 한 칸(1~5 안에서 ±1) 옮겼을 때 글자가 바뀌면 아슬한 글자다.
 * 경계를 표로 적지 않고 글자 함수를 그대로 다시 돌려서 판정한다. ‘?’ 자리는 대상이 아니다.
 */
export function isV31StyleLetterBorderline(key: V31StyleKey, first: V31Response | undefined, second: V31Response | undefined): boolean {
  const current = getV31StyleLetter(key, first, second);
  const a = getV31Rating(first);
  const b = getV31Rating(second);
  if (current === "?" || a === null || b === null) return false;
  const neighbors: [number, number][] = [[a - 1, b], [a + 1, b], [a, b - 1], [a, b + 1]];
  return neighbors
    .filter(([x, y]) => x >= 1 && x <= 5 && y >= 1 && y <= 5)
    .some(([x, y]) => getV31StyleLetter(key, x as V31Rating, y as V31Rating) !== current);
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
      label: both ? "이번 계획에 없어서 글자 대신 ‘?’를 뒀어요" : "한 문장이 이번 계획에 없어서 ‘?’를 뒀어요",
      basis: null,
    };
  }
  if (pending === "open") return { ...base, englishLabel: null, letterFrom: null, label: "아직 글자가 없어요", basis: null };
  if (letter === "B") return {
    ...base, englishLabel: null, letterFrom: null, label: BOTH_LABELS[definition.key],
    basis: "두 문장 모두 ‘그런 편’ 이상으로 답했어요.",
  };
  if (letter === definition.first.letter || letter === definition.second.letter) {
    const selected = letter === definition.first.letter ? definition.first : definition.second;
    return {
      ...base, englishLabel: selected.englishLabel, letterFrom: selected.id, label: selected.label,
      basis: "한 문장에만 ‘그런 편’ 이상으로 답했어요.",
    };
  }
  if (letter === "N") return { ...base, englishLabel: null, letterFrom: null, label: "두 문장 모두 낮게 답했어요", basis: null };
  return { ...base, englishLabel: null, letterFrom: null, label: "중간으로 답한 문장이 있어요", basis: null };
}

const HEADLINES: Record<V31StyleKey, { first: string; second: string; both: string }> = {
  teamwork: {
    first: "업체는 시간을 맞춰 함께 찾아보고 싶어요",
    second: "계약·추가 결제 없는 세부 선택은 맡겨도 괜찮아요",
    both: "업체는 함께 찾고, 계약·추가 결제 없는 세부 선택은 맡겨도 괜찮아요",
  },
  budget: {
    first: "처음 정한 전체 예산 안에서 준비하고 싶어요",
    second: "전체 예산을 늘릴지도 다시 의논하고 싶어요",
    both: "전체 예산을 지키고 싶고, 늘릴지도 다시 의논하고 싶어요",
  },
  family: {
    first: "가족의 바람을 준비 초반에 들어보고 싶어요",
    second: "마지막 선택은 우리 둘이 하고 싶어요",
    both: "가족의 바람을 초반에 듣고, 마지막 선택은 둘이 하고 싶어요",
  },
  support: {
    first: "힘들 때 해결책보다 이야기를 먼저 들어주면 좋겠어요",
    second: "일이 몰리면 일부를 맡아주는 도움이 있으면 좋겠어요",
    both: "이야기를 먼저 들어주고, 몰린 일의 일부도 맡아주면 좋겠어요",
  },
};
const NAMES: Record<V31StyleKey, { first: string; second: string; both: string }> = {
  teamwork: {
    first: "함께 찾는 스타일",
    second: "세부 선택은 맡겨도 되는 스타일",
    both: "함께 찾고, 세부는 맡겨도 되는 스타일",
  },
  budget: {
    first: "예산을 지키는 스타일",
    second: "예산을 다시 의논하는 스타일",
    both: "예산 유지와 재논의를 함께 생각하는 스타일",
  },
  family: {
    first: "가족의 바람을 초반에 듣는 스타일",
    second: "둘이 마지막에 정하는 스타일",
    both: "가족에게 듣고, 선택은 둘이 하는 스타일",
  },
  support: {
    first: "이야기를 먼저 들어주길 바라는 스타일",
    second: "몰린 일을 일부 맡아주길 바라는 스타일",
    both: "이야기를 듣고, 일도 일부 맡아주길 바라는 스타일",
  },
};
/**
 * 이름을 붙이지 못했을 때의 출처 줄은 이름이 나오는 조건을 그대로 적는다. 글자 규칙과 같게, 두 문장 모두
 * 다섯 칸 중 하나를 골라야 한다(‘아직 모르겠어요’나 ‘이번 계획에는 없어요’도 고른 답이라 「답하고」로 쓰지 않는다).
 */
export const V31_STYLE_NAME_FALLBACK = {
  name: "이번 답에는 이름을 붙이지 않았어요",
  nameSource: "이름은 두 문장 모두 동의하는 정도를 고르고, 그중 ‘그런 편’ 이상이 있는 주제에서 따와요",
  headline: "고른 답은 아래에서 하나씩 볼 수 있어요",
} as const;

function summaryCopy(dimensions: V31StyleDimension[]): Pick<V31StyleSummary, "name" | "nameFrom" | "nameSource" | "headline"> {
  // 제목의 편집 순서일 뿐 중요도 순위나 대표 성격을 계산하지 않는다. 그래서 이름 위에 출처 주제를 함께 적는다.
  // 이름을 따온 글자가 한 칸 차이로 바뀌는 글자면 이름도 함께 바뀐다는 것을 출처 줄에서 먼저 말한다.
  // 순서를 바꿔 아슬하지 않은 글자를 먼저 고르면, 그 글자도 한 칸 옮기면 아슬해져 이름이 다른 주제로
  // 넘어가므로 오히려 이름이 흔들리는 답이 늘어난다(2026-09-27 전수 계산). 그래서 순서는 그대로 둔다.
  const order: readonly V31StyleKey[] = ["teamwork", "budget", "family", "support"];
  for (const key of order) {
    const current = dimensions.find(item => item.key === key)!;
    const definition = definitionOf(key);
    const pattern = current.letter === "B" ? "both" : current.letter === definition.first.letter ? "first" : current.letter === definition.second.letter ? "second" : null;
    if (pattern) return {
      name: NAMES[key][pattern], nameFrom: key, headline: HEADLINES[key][pattern],
      nameSource: current.borderline
        ? `이름은 ‘${definition.topicName}’ 답에서 따와서, 이 글자가 바뀌면 이름도 바뀌어요`
        : `이름은 ‘${definition.topicName}’ 답에서 따왔어요`,
    };
  }
  return { ...V31_STYLE_NAME_FALLBACK, nameFrom: null };
}

function quotedTopics(dimensions: V31StyleDimension[]): string {
  return dimensions.map(item => `‘${item.topicName}’`).join(", ");
}

/**
 * 코드보다 먼저 보여주는 한 줄. 어느 글자가 한 칸 차이로 바뀌는지 주제 이름으로 적는다(밑줄 같은 눈으로만 보이는
 * 표시를 가리키지 않아야 화면 읽기 프로그램으로도 어느 글자인지 안다). 아슬하지 않은 글자도 다시 답하면 바뀔 수
 * 있으므로 그 말은 늘 함께 둔다(PRINCIPLES.md 5절).
 */
function borderlineNotice(dimensions: V31StyleDimension[]): string | null {
  const decided = dimensions.filter(item => item.letter !== "?").length;
  const borderline = dimensions.filter(item => item.borderline);
  if (!decided) return null;
  if (!borderline.length) return "지금 글자는 답 하나를 한 칸 옮겨도 그대로예요. 다시 답하면 달라질 수 있어요.";
  if (borderline.length === dimensions.length) return "네 글자 모두 답 하나만 한 칸 달라져도 바뀌어요.";
  return `${quotedTopics(borderline)} 글자는 답 하나만 한 칸 달라져도 바뀌어요. 다른 글자도 다시 답하면 달라질 수 있어요.`;
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
    open.length ? `${quotedTopics(open)} 주제는 아직 모르거나 답하지 않은 문장이 있어서 ‘?’로 남겼어요. 그 문장에 동의하는 정도를 고르면 글자가 생겨요.` : null,
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
    ...summaryCopy(dimensions),
    hasIncomplete: dimensions.some(item => item.letter === "?"),
    borderlineCount: dimensions.filter(item => item.borderline).length,
    borderlineNotice: borderlineNotice(dimensions),
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
