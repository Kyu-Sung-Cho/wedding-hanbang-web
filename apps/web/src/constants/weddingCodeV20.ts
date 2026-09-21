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
  { key: "criteria" as const, title: "결정할 때 중요하게 보는 기준", question: "예산·조건·분위기에서 내가 중요하게 보는 기준을 모아 봐요." },
  { key: "preparation" as const, title: "함께 보고 나누는 방식", question: "둘이 함께 볼 일과 맡길 일을 정할 때 참고해요." },
  { key: "family" as const, title: "가족과 어디까지 함께 정하는지", question: "부모님 의견을 듣고 결정하는 내 방식을 살펴봐요." },
  { key: "support" as const, title: "도움을 받을 때 먼저 필요한 것", question: "힘들거나 결정이 막힐 때 상대에게 먼저 받고 싶은 도움을 살펴봐요." },
] as const;

/** 주제가 몰려 보이지 않도록 네 주제를 번갈아 묻는다. */
export const WEDDING_CODE_V20_QUESTIONS = [
  { id: "C1", axis: "criteria", prompt: "견적을 받으면", statement: "추가 비용까지 포함한 전체 금액을 먼저 확인하는 편이다." },
  { id: "T1", axis: "preparation", prompt: "업체를 알아볼 때", statement: "각자 따로 찾기보다 처음부터 함께 정보를 보고 싶은 편이다." },
  { id: "U1", axis: "family", prompt: "부모님 의견을 들어도", statement: "마지막 선택은 우리 둘이 하고 싶은 편이다." },
  { id: "H1", axis: "support", prompt: "결혼 준비가 힘들 때", statement: "해결책보다 먼저 내 이야기를 들어주길 바라는 편이다." },
  { id: "C2", axis: "criteria", prompt: "예약하기 전에", statement: "취소·변경 조건을 먼저 확인하는 편이다." },
  { id: "T2", axis: "preparation", prompt: "후보를 고르기 전에", statement: "둘이 중요하게 보는 기준을 먼저 맞추고 싶은 편이다." },
  { id: "U2", axis: "family", prompt: "부모님과 이야기하기 전에", statement: "우리 둘의 기준부터 정하고 싶은 편이다." },
  { id: "H2", axis: "support", prompt: "준비하면서 의견이 부딪힌 뒤에는", statement: "내가 어떤 점에서 불편했는지 먼저 물어봐 주길 바라는 편이다." },
  { id: "C3", axis: "criteria", prompt: "예식장을 고를 때", statement: "전체적인 분위기가 마음에 드는지 먼저 보는 편이다." },
  { id: "O1", axis: "preparation", prompt: "한 사람이 맡은 준비는", statement: "그 사람이 세부 내용까지 결정해도 괜찮은 편이다." },
  { id: "F1", axis: "family", prompt: "양가 부모님이 중요하게 생각하는 조건은", statement: "준비 초반에 둘이 함께 확인하고 싶은 편이다." },
  { id: "A1", axis: "support", prompt: "준비할 일이 몰리면", statement: "상대가 내가 맡은 일의 일부를 맡아주길 바라는 편이다." },
  { id: "C4", axis: "criteria", prompt: "마음에 드는 항목이 예산을 넘으면", statement: "다른 항목의 비용을 줄여서라도 선택하고 싶은 편이다." },
  { id: "O2", axis: "preparation", prompt: "각자 맡은 일을 할 때", statement: "중간중간 알리기보다 마친 뒤에 공유하는 게 더 편하다." },
  { id: "F2", axis: "family", prompt: "양가 부모님과 관련된 결정은", statement: "미리 부모님과 상의하고 싶은 편이다." },
  { id: "A2", axis: "support", prompt: "준비 결정이 막히면", statement: "상대가 지금 먼저 할 일 하나를 골라주길 바라는 편이다." },
] as const satisfies readonly WeddingCodeV20Question[];

export type WeddingCodeV20Answers = Partial<Record<WeddingCodeV20QuestionId, WeddingCodeV20Rating>>;
export const WEDDING_CODE_V20_TOTAL = WEDDING_CODE_V20_QUESTIONS.length;
