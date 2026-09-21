/** 웨딩코드 v2.0: 한 문장에 같은 5점 척도로 답하는 공개 대화 도구. */
export const WEDDING_CODE_V20_VERSION = "v2.0-agreement" as const;
export type WeddingCodeV20Rating = 1 | 2 | 3 | 4 | 5;
export type WeddingCodeV20QuestionId = "C1" | "C2" | "C3" | "C4" | "T1" | "T2" | "O1" | "O2" | "U1" | "U2" | "F1" | "F2" | "H1" | "H2" | "A1" | "A2";
export type WeddingCodeV20AxisKey = "criteria" | "preparation" | "family" | "support";
export type WeddingCodeV20Question = { readonly id: WeddingCodeV20QuestionId; readonly axis: WeddingCodeV20AxisKey; readonly prompt: string; readonly statement: string };

export const WEDDING_CODE_V20_LIKERT_OPTIONS = [
  { value: 1 as const, label: "전혀 그렇지 않아요" },
  { value: 2 as const, label: "그렇지 않은 편이에요" },
  { value: 3 as const, label: "어느 쪽도 아니에요" },
  { value: 4 as const, label: "그런 편이에요" },
  { value: 5 as const, label: "매우 그래요" },
] as const;

export const WEDDING_CODE_V20_AXES = [
  { key: "criteria" as const, title: "무엇을 먼저 살펴보는지", question: "예산·조건·분위기에 대한 내 답을 그대로 모아 봐요." },
  { key: "preparation" as const, title: "준비를 어떻게 나누는지", question: "둘이 함께 볼 일과 맡길 일을 정할 때 참고해요." },
  { key: "family" as const, title: "가족과 어디까지 함께 정하는지", question: "부모님 의견을 듣고 결정하는 내 방식을 살펴봐요." },
  { key: "support" as const, title: "도움을 받을 때 먼저 필요한 것", question: "힘들거나 결정이 막힐 때 상대에게 먼저 받고 싶은 도움을 살펴봐요." },
] as const;

/** 주제가 몰려 보이지 않도록 네 주제를 번갈아 묻는다. */
export const WEDDING_CODE_V20_QUESTIONS = [
  { id: "C1", axis: "criteria", prompt: "견적을 받으면", statement: "전체 비용이 얼마인지 먼저 확인하는 편이다." },
  { id: "T1", axis: "preparation", prompt: "새로운 업체를 알아볼 때", statement: "처음부터 둘이 함께 정보를 확인하고 싶은 편이다." },
  { id: "U1", axis: "family", prompt: "부모님 의견을 들어도", statement: "마지막 선택은 우리 둘이 하고 싶은 편이다." },
  { id: "H1", axis: "support", prompt: "힘들 때", statement: "해결책보다 먼저 내 이야기를 들어주길 바라는 편이다." },
  { id: "C2", axis: "criteria", prompt: "예약하기 전에", statement: "취소·변경 조건을 먼저 확인하는 편이다." },
  { id: "T2", axis: "preparation", prompt: "후보를 고를 때", statement: "둘이 중요하게 생각하는 기준을 먼저 맞추고 싶은 편이다." },
  { id: "U2", axis: "family", prompt: "부모님께 설명하기 전에", statement: "우리 둘이 원하는 기준부터 정하고 싶은 편이다." },
  { id: "H2", axis: "support", prompt: "의견이 부딪힌 뒤에는", statement: "내가 왜 그렇게 생각했는지 먼저 물어봐 주길 바라는 편이다." },
  { id: "C3", axis: "criteria", prompt: "사진이나 공간을 볼 때", statement: "예식 분위기가 마음에 드는지 먼저 보는 편이다." },
  { id: "O1", axis: "preparation", prompt: "한 사람이 맡은 준비는", statement: "그 사람이 세부 내용까지 정해도 괜찮은 편이다." },
  { id: "F1", axis: "family", prompt: "부모님이 중요하게 생각하는 조건은", statement: "준비 초반에 둘이 함께 확인하고 싶은 편이다." },
  { id: "A1", axis: "support", prompt: "일이 많아지면", statement: "상대가 내 할 일을 덜어주길 바라는 편이다." },
  { id: "C4", axis: "criteria", prompt: "마음에 드는 항목에는", statement: "정해둔 예산을 넘겨도 괜찮다고 생각하는 편이다." },
  { id: "O2", axis: "preparation", prompt: "각자 맡은 일을 할 때", statement: "끝낸 뒤 결과를 공유하는 방식이 편한 편이다." },
  { id: "F2", axis: "family", prompt: "양가 부모님과 관련된 비용이나 일정은", statement: "결정하기 전에 먼저 상의하고 싶은 편이다." },
  { id: "A2", axis: "support", prompt: "결정이 막히면", statement: "상대가 다음에 할 일을 하나로 좁혀주길 바라는 편이다." },
] as const satisfies readonly WeddingCodeV20Question[];

export type WeddingCodeV20Answers = Partial<Record<WeddingCodeV20QuestionId, WeddingCodeV20Rating>>;
export const WEDDING_CODE_V20_TOTAL = WEDDING_CODE_V20_QUESTIONS.length;
