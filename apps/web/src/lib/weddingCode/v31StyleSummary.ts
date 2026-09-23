import {
  WEDDING_CODE_V31_QUESTIONS,
  WEDDING_CODE_V31_TOPICS,
  WEDDING_CODE_V31_VERSION,
  type V31Draft,
  type V31QuestionId,
  type V31Response,
  type V31Topic,
} from "@/constants/weddingCodeV31";
import { v31ResponseLabel } from "@/lib/weddingCode/v31";

export const V31_STYLE_SUMMARY_VERSION = "response-summary-1" as const;
export type V31StyleKey = "budget" | "teamwork" | "family" | "support";
export type V31StyleLetter = "K" | "R" | "T" | "D" | "F" | "C" | "L" | "A" | "B" | "M" | "N" | "?";
type PositiveLetter = Exclude<V31StyleLetter, "B" | "M" | "N" | "?">;
type PositiveDefinition = { id: V31QuestionId; letter: PositiveLetter; englishLabel: string; label: string };
type DimensionDefinition = { key: V31StyleKey; title: string; first: PositiveDefinition; second: PositiveDefinition };

/** 서로 반대인 척도가 아니라, 같은 주제에서 함께 성립할 수 있는 두 응답이다. */
export const V31_STYLE_DIMENSIONS = [
  {
    key: "budget", title: "예산을 정할 때",
    first: { id: "B1", letter: "K", englishLabel: "Keep", label: "처음 정한 전체 예산 지키기" },
    second: { id: "B3", letter: "R", englishLabel: "Revisit", label: "전체 예산을 늘릴지 다시 의논하기" },
  },
  {
    key: "teamwork", title: "일을 나눌 때",
    first: { id: "T1", letter: "T", englishLabel: "Together", label: "시간을 맞춰 함께 업체 찾아보기" },
    second: { id: "T2", letter: "D", englishLabel: "Delegate", label: "계약·추가 결제 없는 세부 선택 맡기기" },
  },
  {
    key: "family", title: "가족과 상의할 때",
    first: { id: "F1", letter: "F", englishLabel: "Family", label: "가족의 바람을 준비 초반에 듣기" },
    second: { id: "F2", letter: "C", englishLabel: "Couple", label: "마지막 선택은 둘이 하기" },
  },
  {
    key: "support", title: "도움을 받고 싶을 때",
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
  percent: number | null;
};
export type V31StatementScaleGroup = { key: V31Topic; title: string; items: V31StatementScale[] };
export type V31StyleDimension = {
  key: V31StyleKey;
  title: string;
  letter: V31StyleLetter;
  englishLabel: string;
  label: string;
  basis: string;
  ratedCount: number;
  items: [V31StatementScale, V31StatementScale];
};
export type V31StyleSummary = {
  version: typeof V31_STYLE_SUMMARY_VERSION;
  code: string;
  name: string;
  headline: string;
  hasIncomplete: boolean;
  dimensions: V31StyleDimension[];
};

const BOTH_LABELS: Record<V31StyleKey, string> = {
  budget: "총액은 지키고 싶고, 늘릴지도 다시 의논하고 싶어요",
  teamwork: "함께 찾고, 계약·추가 결제 없는 세부 선택은 맡겨도 괜찮아요",
  family: "가족의 바람은 초반에 듣고, 마지막 선택은 둘이 하고 싶어요",
  support: "이야기를 먼저 들어주고, 몰린 일 일부도 맡아주길 바라요",
};

/** 다섯 응답 보기의 표시 눈금이며, 선호 확률이나 심리검사 신뢰도가 아니다. */
export function getV31StatementPercent(response: V31Response | undefined): number | null {
  return typeof response === "number" && Number.isInteger(response) && response >= 1 && response <= 5
    ? (response - 1) * 25
    : null;
}

function assertVersion(draft: V31Draft): void {
  if (draft.version !== WEDDING_CODE_V31_VERSION) throw new Error("이 응답 요약은 웨딩코드 v3.1의 답에만 사용할 수 있어요.");
}
function statementScale(draft: V31Draft, id: V31QuestionId): V31StatementScale {
  const question = WEDDING_CODE_V31_QUESTIONS.find(item => item.id === id)!;
  const response = draft.answers[id];
  return { id, topic: question.topic, statement: question.statement, shortLabel: question.shortLabel, response, responseLabel: v31ResponseLabel(response), percent: getV31StatementPercent(response) };
}

function dimension(draft: V31Draft, definition: DimensionDefinition): V31StyleDimension {
  const items: V31StyleDimension["items"] = [statementScale(draft, definition.first.id), statementScale(draft, definition.second.id)];
  const ratedCount = items.filter(item => item.percent !== null).length;
  const base = { key: definition.key, title: definition.title, ratedCount, items };
  const [first, second] = items;
  if (first.percent === null || second.percent === null) return {
    ...base, letter: "?", englishLabel: "Unassigned", label: "요약 보류",
    basis: `${ratedCount}/2개 문장에 동의 정도를 골랐어요. 두 문장 모두 동의 정도를 골라야 글자를 정할 수 있어요. 다른 답의 상태는 그대로 남겼어요.`,
  };
  const firstHigh = first.percent >= 75;
  const secondHigh = second.percent >= 75;
  if (firstHigh && secondHigh) return {
    ...base, letter: "B", englishLabel: "Both", label: BOTH_LABELS[definition.key],
    basis: "2/2개 문장 모두 ‘그런 편’ 이상으로 답했어요. 두 답을 함께 요약했어요.",
  };
  if (firstHigh || secondHigh) {
    const selected = firstHigh ? definition.first : definition.second;
    const other = firstHigh ? second : first;
    return {
      ...base, letter: selected.letter, englishLabel: selected.englishLabel, label: selected.label,
      basis: `2/2개 문장에 동의 정도를 골랐어요. 한 문장에만 ‘그런 편’ 이상으로 답했고, 다른 문장은 ${other.percent === 50 ? "중간으로" : "낮게"} 답했어요.`,
    };
  }
  if (first.percent <= 25 && second.percent <= 25) return {
    ...base, letter: "N", englishLabel: "Neither", label: "두 문장 모두 낮게 답했어요",
    basis: "2/2개 문장 모두 ‘그렇지 않은 편’ 이하로 답했어요. 반대 방식을 원한다는 뜻은 아니에요.",
  };
  return {
    ...base, letter: "M", englishLabel: "Middle", label: "중간 답이 포함돼요",
    basis: "2/2개 문장에 동의 정도를 골랐어요. ‘그런 편’ 이상인 답 없이 중간 응답이 포함돼요. 아직 모른다는 답과는 달라요.",
  };
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
function summaryCopy(dimensions: V31StyleDimension[]): { name: string; headline: string } {
  // 제목의 편집 순서일 뿐 중요도 순위나 대표 성격을 계산하지 않는다.
  const order: readonly V31StyleKey[] = ["teamwork", "budget", "family", "support"];
  for (const key of order) {
    const current = dimensions.find(item => item.key === key)!;
    const definition = V31_STYLE_DIMENSIONS.find(item => item.key === key)!;
    const pattern = current.letter === "B" ? "both" : current.letter === definition.first.letter ? "first" : current.letter === definition.second.letter ? "second" : null;
    if (pattern) return { name: NAMES[key][pattern], headline: HEADLINES[key][pattern] };
  }
  return { name: "문장별로 살펴볼 준비 방식", headline: "이번 답을 문장별로 살펴봐요" };
}

export function buildV31StyleSummary(draft: V31Draft): V31StyleSummary {
  assertVersion(draft);
  const dimensions = V31_STYLE_DIMENSIONS.map(definition => dimension(draft, definition));
  return {
    version: V31_STYLE_SUMMARY_VERSION,
    code: dimensions.map(item => item.letter).join(""),
    ...summaryCopy(dimensions),
    hasIncomplete: dimensions.some(item => item.letter === "?"),
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
