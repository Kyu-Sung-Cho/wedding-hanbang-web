import type { Answers, Question, Response, Topic, Versions } from "./types";

export const VERSIONS = {
  questionnaireVersion: "preferences21-20261010-r1",
  interpretationVersion: "preferences21-reading-alpha.1",
  displayVersion: "preferences21-report-alpha.1",
} as const satisfies Versions;

export const INTRO = [
  "결혼 준비를 한다고 생각하고, 각 장면에서 내게 더 편할 것 같은 방식으로 답해 주세요. 경험이 없어도 괜찮아요.",
  "각 문장이 내가 원하는 방식에 얼마나 맞는지 골라 주세요.",
] as const;

export const SCALE_HELP = "‘반반’은 문장에 끌리는 정도가 중간일 때예요. 판단이 아직 서지 않으면 ‘아직 모르겠어요’를 골라 주세요.";

export const SCALE_OPTIONS = [
  { value: 1, label: "전혀 맞지 않아요" },
  { value: 2, label: "별로 맞지 않아요" },
  { value: 3, label: "반반이에요" },
  { value: 4, label: "대체로 맞아요" },
  { value: 5, label: "아주 잘 맞아요" },
] as const;

export const SPECIAL_OPTIONS = [
  { value: "unknown", label: "아직 모르겠어요" },
  { value: "not-applicable", label: "나에게 해당하지 않아요" },
  { value: "skipped", label: "지금 답하지 않을게요" },
] as const;

export const TOPICS = [
  {
    id: "A",
    title: "식의 모습과 예산을 생각할 때",
    context: "예산 문항은 아직 계약 전이고, 식의 기본 진행에 필요한 비용은 마련된 상황을 떠올려 주세요.",
    itemIds: ["Q01", "Q02", "Q03", "Q04"],
  },
  {
    id: "B",
    title: "둘이 후보를 찾고 고를 때",
    context: "두 사람 모두 준비할 시간이 있고, 상대도 맡은 일을 해낼 수 있다고 생각해 주세요. 급하게 결정할 일은 없는 상황이에요.",
    itemIds: ["Q05", "Q06", "Q07", "Q08", "Q09", "Q10", "Q11", "Q12"],
  },
  {
    id: "C",
    title: "가족과 준비 이야기를 나눌 때",
    context: "결혼 준비 이야기를 나눌 가족을 떠올려 주세요. 해당하는 가족이 없으면 ‘나에게 해당하지 않아요’를 골라도 괜찮아요.",
    itemIds: ["Q13", "Q14", "Q15", "Q16"],
  },
  {
    id: "D",
    title: "준비하다 지쳤을 때",
    context: "바로 처리해야 할 일은 없고, 상대에게도 도와줄 여유가 있다고 생각해 주세요.",
    itemIds: ["Q17", "Q18", "Q19", "Q20", "Q21"],
  },
] as const satisfies readonly Topic[];

export const ITEMS21 = [
  { id: "Q01", number: 1, topicId: "A", statement: "식에 우리 둘이 처음 만난 이야기를 하객에게 들려주는 시간을 넣고 싶다." },
  { id: "Q02", number: 2, topicId: "A", statement: "식의 다른 부분이 간단해져도, 내가 가장 원하는 한두 부분에 예산을 더 쓰고 싶다." },
  { id: "Q03", number: 3, topicId: "A", statement: "꼭 넣고 싶은 항목이 생기면, 전체 예산은 늘리지 않고 다른 항목에 쓰기로 한 돈을 줄이고 싶다." },
  { id: "Q04", number: 4, topicId: "A", statement: "하객에게 인사를 마친 뒤 여유가 생기면, 하객과 더 이야기하기보다 우리 둘만의 시간으로 쓰고 싶다." },
  { id: "Q05", number: 5, topicId: "B", statement: "예식장을 찾기 시작할 때부터, 상대와 후보를 함께 보며 이야기하고 싶다." },
  { id: "Q06", number: 6, topicId: "B", statement: "예식장을 찾을 때, 내 마음에 드는 후보를 먼저 몇 곳 찾아본 뒤 상대와 이야기하고 싶다." },
  { id: "Q07", number: 7, topicId: "B", statement: "둘이 원하는 조건을 정했다면, 예식장 첫 후보는 상대가 추려 와도 편하다." },
  { id: "Q08", number: 8, topicId: "B", statement: "우리 둘 모두 마음에 드는 청첩장 후보 두 개가 남았다면, 마지막 선택은 상대에게 맡겨도 편하다." },
  { id: "Q09", number: 9, topicId: "B", statement: "예산과 날짜에 맞는 예식장 두 곳이 마음에 들면, 더 찾기보다 그 두 곳을 자세히 비교하고 싶다." },
  { id: "Q10", number: 10, topicId: "B", statement: "각자 고른 예식장이 다르면, 그 두 곳 중 하나를 고르기보다 둘 다 새 후보를 찾아보고 싶다." },
  { id: "Q11", number: 11, topicId: "B", statement: "의견이 잘 안 맞는 날에는, 그날 결론을 내기보다 각자 생각한 뒤 다음 날 다시 이야기하고 싶다." },
  { id: "Q12", number: 12, topicId: "B", statement: "둘이 조건을 정하고 내가 업체 후보를 찾기로 했다면, 중간부터 함께 보기보다 후보를 추린 뒤 상대와 이야기하고 싶다." },
  { id: "Q13", number: 13, topicId: "C", statement: "예식 분위기를 생각하기 시작할 때, 가족이 바라는 분위기도 들어보고 싶다." },
  { id: "Q14", number: 14, topicId: "C", statement: "우리 둘이 원하는 예식 모습을 대략 정했다면, 확정하기 전에 가족 의견도 듣고 싶다." },
  { id: "Q15", number: 15, topicId: "C", statement: "우리 둘 모두 괜찮다고 느끼는 식순 두 가지가 있다면, 가족이 더 좋아하는 쪽을 고르고 싶다." },
  { id: "Q16", number: 16, topicId: "C", statement: "가족과 우리 둘이 원하는 식순이 다를 때, 가족 의견을 들은 뒤 마지막 선택은 우리 둘이 하고 싶다." },
  { id: "Q17", number: 17, topicId: "D", statement: "예식장 답변 때문에 속상한 날, 상대가 해결책을 찾기 전에 내 이야기를 먼저 들어주면 좋겠다." },
  { id: "Q18", number: 18, topicId: "D", statement: "내가 맡은 업체 연락이 버거울 때, 물어볼 내용을 같이 정리해 주기보다 연락을 대신 맡아 주면 좋겠다." },
  { id: "Q19", number: 19, topicId: "D", statement: "내가 맡은 준비가 밀린 날, 상대가 일부를 대신 끝내 주기보다 나와 같이 하나씩 하는 게 편하다." },
  { id: "Q20", number: 20, topicId: "D", statement: "예식장을 둘러보고 지쳤을 때, 처음 쉬는 시간은 상대와 함께 보내고 싶다." },
  { id: "Q21", number: 21, topicId: "D", statement: "예식장을 둘러보고 지쳤을 때, 처음 쉬는 시간은 혼자 보내고 싶다." },
] as const satisfies readonly Question[];

export function createEmptyAnswers(): Answers {
  return {
    Q01: null, Q02: null, Q03: null, Q04: null, Q05: null, Q06: null, Q07: null,
    Q08: null, Q09: null, Q10: null, Q11: null, Q12: null, Q13: null, Q14: null,
    Q15: null, Q16: null, Q17: null, Q18: null, Q19: null, Q20: null, Q21: null,
  };
}

export function isResponse(value: unknown): value is Response {
  return value === null || value === 1 || value === 2 || value === 3 || value === 4 || value === 5
    || value === "unknown" || value === "not-applicable" || value === "skipped";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

// 새 판의 ID 전체를 확인한다. 구판 배열이나 알 수 없는 키를 새 문항으로 옮기지 않는다.
export function parseAnswers(value: unknown): Answers | null {
  try {
    if (!isRecord(value) || Reflect.ownKeys(value).length !== ITEMS21.length) return null;
    const answers = createEmptyAnswers();
    for (const item of ITEMS21) {
      const descriptor = Object.getOwnPropertyDescriptor(value, item.id);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      const response: unknown = descriptor.value;
      if (!isResponse(response)) return null;
      answers[item.id] = response;
    }
    return answers;
  } catch {
    return null;
  }
}

export function responseLabel(response: Response): string {
  if (response === null) return "아직 답하지 않았어요";
  return [...SCALE_OPTIONS, ...SPECIAL_OPTIONS].find((option) => option.value === response)?.label
    ?? "아직 답하지 않았어요";
}
