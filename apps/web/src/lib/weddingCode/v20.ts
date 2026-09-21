import {
  WEDDING_CODE_V20_AXES,
  WEDDING_CODE_V20_QUESTIONS,
  WEDDING_CODE_V20_TOTAL,
  WEDDING_CODE_V20_VERSION,
  WEDDING_CODE_V20_LIKERT_OPTIONS,
  type WeddingCodeV20Answers,
  type WeddingCodeV20AxisKey,
  type WeddingCodeV20Question,
  type WeddingCodeV20QuestionId,
  type WeddingCodeV20Rating,
} from "@/constants/weddingCodeV20";

export type WeddingCodeV20AxisState = "clear" | "mixed" | "unanswered";
export type WeddingCodeV20Response = {
  id: WeddingCodeV20QuestionId;
  prompt: string;
  statement: string;
  fullText: string;
  rating: WeddingCodeV20Rating;
  ratingLabel: string;
  interpretation: string;
  followUp: string;
};
export type WeddingCodeV20Reading = {
  axis: WeddingCodeV20AxisKey;
  title: string;
  question: string;
  summary: string;
  nextQuestion: string;
  state: WeddingCodeV20AxisState;
  answered: number;
  responses: WeddingCodeV20Response[];
};
export type WeddingCodeV20Profile = { answered: number; readings: WeddingCodeV20Reading[] };
export type WeddingCodeV20PairItem = {
  question: WeddingCodeV20Question;
  fullText: string;
  followUp: string;
  first: WeddingCodeV20Rating | null;
  second: WeddingCodeV20Rating | null;
  state: "same" | "different" | "missing" | "bothSkipped";
  stateLabel: string;
};

/** 0~1점 차이를 비슷하게 보여주는 표시 규칙이며 관계나 갈등을 측정하는 기준이 아니다. */
export const WEDDING_CODE_V20_COMPARISON_NOTE = "같은 응답이거나 한 단계 차이면 ‘비슷하게 답함’으로 묶었어요. 관계나 갈등을 판단하는 기준은 아니에요.";

type QuestionReadingCopy = { close: string; middle: string; distant: string; followUp: string };
const QUESTION_READING_COPY: Record<WeddingCodeV20QuestionId, QuestionReadingCopy> = {
  C1: { close: "견적을 받으면 전체 비용부터 확인하는 편이라고 답했어요.", middle: "전체 비용을 먼저 확인하는지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "다음 견적에서 각자 가장 먼저 확인하고 싶은 것은 무엇인가요?" },
  C2: { close: "예약 전에 취소·변경 조건부터 확인하는 편이라고 답했어요.", middle: "취소·변경 조건을 먼저 확인하는지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "예약 전에 함께 확인해 두고 싶은 취소·변경 조건이 있나요?" },
  C3: { close: "사진이나 공간을 볼 때 예식 분위기가 마음에 드는지 먼저 본다고 답했어요.", middle: "예식 분위기가 마음에 드는지 먼저 보는지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "마음에 드는 예식 사진을 한 장씩 골라, 어떤 점이 좋은지 이야기해 볼까요?" },
  C4: { close: "마음에 드는 항목에는 정해둔 예산을 넘겨도 괜찮다고 생각하는 편이라고 답했어요.", middle: "마음에 드는 항목에 예산을 넘겨도 괜찮다고 생각하는지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "마음에 드는 항목이 예산을 넘으면, 어디까지 쓸 수 있을지 먼저 정해 볼까요?" },
  T1: { close: "업체를 알아보는 처음부터 둘이 함께 정보를 확인하고 싶다고 답했어요.", middle: "처음부터 둘이 함께 정보를 확인하고 싶은지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "다음 업체를 알아볼 때 처음부터 같이 볼지, 한 사람이 찾아 공유할지 정해 볼까요?" },
  T2: { close: "후보를 고르기 전에 서로 중요하게 보는 기준부터 맞추고 싶다고 답했어요.", middle: "후보를 고르기 전에 둘의 기준부터 맞추고 싶은지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "후보를 추리기 전에 각자 꼭 필요한 조건 하나씩 말해 볼까요?" },
  O1: { close: "한 사람이 맡은 준비는 세부 내용까지 그 사람이 정해도 괜찮다고 답했어요.", middle: "맡은 사람이 세부 내용까지 정해도 괜찮은지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "각자 맡은 일에서 혼자 정해도 되는 것과 함께 정할 것은 무엇인가요?" },
  O2: { close: "각자 맡은 일을 끝낸 뒤 결과를 공유하는 방식이 편하다고 답했어요.", middle: "맡은 일을 끝낸 뒤 결과를 공유하는 방식이 편한지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "맡은 일을 진행하는 동안 언제 서로 알려주면 편할까요?" },
  U1: { close: "부모님 의견을 듣더라도 마지막 선택은 둘이 하고 싶다고 답했어요.", middle: "부모님 의견을 들은 뒤 마지막 선택을 둘이 하고 싶은지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "부모님 의견과 둘의 생각이 다르면 마지막 결정은 어떻게 할까요?" },
  U2: { close: "부모님께 설명하기 전에 둘이 원하는 기준부터 정하고 싶다고 답했어요.", middle: "부모님께 설명하기 전에 둘의 기준부터 정하고 싶은지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "부모님께 말씀드리기 전에 둘이 먼저 정해두고 싶은 것은 무엇인가요?" },
  F1: { close: "준비 초반에 부모님이 중요하게 생각하는 조건을 둘이 함께 확인하고 싶다고 답했어요.", middle: "부모님이 중요하게 생각하는 조건을 초반에 함께 확인하고 싶은지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "준비 초반에 부모님이 중요하게 보시는 조건 중 무엇을 함께 확인할까요?" },
  F2: { close: "양가 부모님과 관련된 비용이나 일정은 결정 전에 상의하고 싶다고 답했어요.", middle: "양가와 관련된 비용이나 일정을 결정 전에 상의하고 싶은지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "양가와 관련된 비용이나 일정은 누구에게, 언제 상의하면 좋을까요?" },
  H1: { close: "힘들 때는 해결책보다 먼저 이야기를 들어주길 바란다고 답했어요.", middle: "힘들 때 해결책보다 먼저 이야기를 들어주길 바라는지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "힘들다고 말할 때, 상대가 처음에 어떻게 반응해 주면 좋겠나요?" },
  H2: { close: "의견이 부딪힌 뒤에는 왜 그렇게 생각했는지 먼저 물어봐 주길 바란다고 답했어요.", middle: "의견이 부딪힌 뒤 내 생각의 이유를 먼저 물어봐 주길 바라는지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "다시 이야기를 시작할 때, 상대가 무엇부터 물어봐 주면 좋겠나요?" },
  A1: { close: "일이 많아지면 상대가 내 할 일을 덜어주길 바란다고 답했어요.", middle: "일이 많아질 때 상대가 내 할 일을 덜어주길 바라는지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "할 일이 몰렸을 때, 상대에게 맡기고 싶은 일이 있나요?" },
  A2: { close: "결정이 막히면 상대가 다음에 할 일을 하나로 좁혀주길 바란다고 답했어요.", middle: "결정이 막혔을 때 상대가 다음 할 일을 하나로 좁혀주길 바라는지는 중간으로 답했어요.", distant: "이 문장에는 가까운 편이 아니라고 답했어요.", followUp: "결정이 막혔을 때, 상대가 어떤 식으로 도와주면 다음으로 넘어갈 수 있을까요?" },
};

const UNANSWERED_QUESTION: Record<WeddingCodeV20AxisKey, string> = {
  criteria: "지금 고르는 항목에서 가장 먼저 확인하고 싶은 것은 무엇인가요?",
  preparation: "다음 준비는 어디까지 함께 보고, 무엇을 각자 맡을까요?",
  family: "다음 결정에서 부모님께 여쭤볼 것과 둘이 정할 것은 무엇인가요?",
  support: "지금 상대에게 부탁하고 싶은 도움이 있나요?",
};

export function getWeddingCodeV20FollowUp(id: WeddingCodeV20QuestionId): string {
  return QUESTION_READING_COPY[id].followUp;
}

const VALID_RATINGS = new Set<number>([1, 2, 3, 4, 5]);
const VALID_CHARS = new Set<string>(["-", "1", "2", "3", "4", "5"]);
const ratingLabel = (rating: WeddingCodeV20Rating) => WEDDING_CODE_V20_LIKERT_OPTIONS[rating - 1].label;

export function isWeddingCodeV20Rating(value: unknown): value is WeddingCodeV20Rating {
  return typeof value === "number" && VALID_RATINGS.has(value);
}
export function answeredCountV20(answers: WeddingCodeV20Answers): number {
  return WEDDING_CODE_V20_QUESTIONS.reduce((count, question) => count + (isWeddingCodeV20Rating(answers[question.id]) ? 1 : 0), 0);
}
export function encodeWeddingCodeV20(answers: WeddingCodeV20Answers): string {
  return WEDDING_CODE_V20_QUESTIONS.map((question) => isWeddingCodeV20Rating(answers[question.id]) ? String(answers[question.id]) : "-").join("");
}
export function decodeWeddingCodeV20(code: string | null | undefined): WeddingCodeV20Answers | null {
  if (typeof code !== "string" || code.length !== WEDDING_CODE_V20_TOTAL || !code.split("").every((char) => VALID_CHARS.has(char))) return null;
  const answers: WeddingCodeV20Answers = {};
  code.split("").forEach((char, index) => { if (char !== "-") answers[WEDDING_CODE_V20_QUESTIONS[index].id] = Number(char) as WeddingCodeV20Rating; });
  return answeredCountV20(answers) > 0 ? answers : null;
}
export function buildWeddingCodeV20ShareUrl({ origin, first, second }: { origin: string; first: WeddingCodeV20Answers; second?: WeddingCodeV20Answers | null }): string {
  const params = new URLSearchParams(); params.set("v", WEDDING_CODE_V20_VERSION); params.set("a", encodeWeddingCodeV20(first));
  if (second && answeredCountV20(second) > 0) params.set("b", encodeWeddingCodeV20(second));
  return `${origin.replace(/\/$/, "")}/wedding-code#${params.toString()}`;
}

function axisReading(axis: typeof WEDDING_CODE_V20_AXES[number], answers: WeddingCodeV20Answers): WeddingCodeV20Reading {
  const questions = WEDDING_CODE_V20_QUESTIONS.filter((question) => question.axis === axis.key);
  const responses = questions.filter((question) => isWeddingCodeV20Rating(answers[question.id])).map((question) => {
    const rating = answers[question.id] as WeddingCodeV20Rating;
    const copy = QUESTION_READING_COPY[question.id];
    return {
      id: question.id,
      prompt: question.prompt,
      statement: question.statement,
      fullText: `${question.prompt} ${question.statement}`,
      rating,
      ratingLabel: ratingLabel(rating),
      interpretation: rating >= 4 ? copy.close : rating <= 2 ? copy.distant : copy.middle,
      followUp: copy.followUp,
    };
  });
  const high = responses.filter((response) => response.rating >= 4).length;
  const low = responses.filter((response) => response.rating <= 2).length;
  const skipped = questions.length - responses.length;
  const startingResponse = responses.reduce<WeddingCodeV20Response | null>((selected, response) => !selected || Math.abs(response.rating - 3) > Math.abs(selected.rating - 3) ? response : selected, null);
  const summary = responses.length === 0
    ? "이 주제의 문장은 모두 건너뛰었어요. 아직 어떤 방식이 편한지 정리하지 않았어요."
    : `${responses.map((response) => response.interpretation).join(" ")}${skipped > 0 ? ` 건너뛴 ${skipped}문장은 정리에 넣지 않았어요.` : ""}`;
  return {
    axis: axis.key,
    title: axis.title,
    question: axis.question,
    summary,
    nextQuestion: startingResponse?.followUp ?? UNANSWERED_QUESTION[axis.key],
    state: responses.length === 0 ? "unanswered" : high > 0 || low > 0 ? "clear" : "mixed",
    answered: responses.length,
    responses,
  };
}
export function buildWeddingCodeV20Profile(answers: WeddingCodeV20Answers): WeddingCodeV20Profile {
  return { answered: answeredCountV20(answers), readings: WEDDING_CODE_V20_AXES.map((axis) => axisReading(axis, answers)) };
}
export function compareWeddingCodeV20Answers(first: WeddingCodeV20Answers, second: WeddingCodeV20Answers): WeddingCodeV20PairItem[] {
  return WEDDING_CODE_V20_QUESTIONS.map((question) => {
    const firstValue = isWeddingCodeV20Rating(first[question.id]) ? first[question.id] as WeddingCodeV20Rating : null;
    const secondValue = isWeddingCodeV20Rating(second[question.id]) ? second[question.id] as WeddingCodeV20Rating : null;
    const state = firstValue === null && secondValue === null
      ? "bothSkipped"
      : firstValue === null || secondValue === null
        ? "missing"
        : Math.abs(firstValue - secondValue) <= 1 ? "same" : "different";
    const stateLabel = state === "bothSkipped"
      ? "둘 다 건너뛴 문장이에요."
      : state === "missing"
        ? "한 사람만 답했어요."
        : state === "same" ? "비슷하게 답했어요." : "답한 정도가 달랐어요.";
    return {
      question,
      fullText: `${question.prompt} ${question.statement}`,
      followUp: getWeddingCodeV20FollowUp(question.id),
      first: firstValue,
      second: secondValue,
      state,
      stateLabel,
    };
  });
}


