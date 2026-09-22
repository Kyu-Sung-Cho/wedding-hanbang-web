import { getWeddingTasteDomainQuestion, TASTE_DOMAIN_OPTIONS, WEDDING_TASTE_VERSION } from "@/lib/weddingCode/taste/constants";

/** 문항과 해석 계약을 함께 고정한다. 구판 링크의 응답을 새 문장으로 읽지 않는다. */
export const WEDDING_CODE_V30_VERSION = "v3.0-preferences" as const;
export type V30QuestionId = "V1" | "V2" | "V3" | "V4" | "G1" | "G2" | "G3" | "G4" | "R1" | "R2" | "R3" | "R4" | "B1" | "B2" | "B3" | "B4" | "D1" | "D2" | "D3" | "D4" | "T1" | "T2" | "T3" | "T4" | "F1" | "F2" | "F3" | "F4" | "H1" | "H2" | "H3" | "H4";
export type V30Topic = "vision" | "guests" | "records" | "budget" | "decision" | "teamwork" | "family" | "support";
export type V30Rating = 1 | 2 | 3 | 4 | 5;
export type V30Response = V30Rating | "undecided" | "not_applicable" | "skipped";
export type V30TasteKey = "venue" | "photo" | "attire" | "meal" | "guests" | "ceremony";
export type V30Choice = { status: "answered"; values: string[] } | { status: "undecided" | "not_applicable" | "skipped" | "no_preference" | "no_match" };
export type V30Draft = {
  version: typeof WEDDING_CODE_V30_VERSION;
  answers: Partial<Record<V30QuestionId, V30Response>>;
  tastes: Partial<Record<V30TasteKey, V30Choice>>;
  priorities?: V30Choice;
  spending?: V30Choice;
};
export type V30Question = { id: V30QuestionId; topic: V30Topic; statement: string; shortLabel: string; followUp: string };
export type V30Option = { value: string; label: string };

export const WEDDING_CODE_V30_OPTIONS = [
  { value: 1, label: "전혀 그렇지 않아요" },
  { value: 2, label: "그렇지 않은 편이에요" },
  { value: 3, label: "어느 쪽도 아니에요" },
  { value: 4, label: "그런 편이에요" },
  { value: 5, label: "매우 그래요" },
] as const satisfies readonly { value: V30Rating; label: string }[];

export const WEDDING_CODE_V30_STATUS_OPTIONS = [
  { value: "undecided", label: "아직 모르겠어요" },
  { value: "not_applicable", label: "이번 계획에는 없어요" },
  { value: "skipped", label: "지금 답하지 않을게요" },
] as const;

export const WEDDING_CODE_V30_TOPICS = [
  { key: "vision", title: "공간과 예식", description: "식을 올릴 공간과 예식 순서를 떠올려 봐요." },
  { key: "guests", title: "함께할 사람과 식사", description: "초대하고 싶은 사람과 그날의 식사를 생각해 봐요." },
  { key: "records", title: "사진과 입을 옷", description: "남기고 싶은 장면과 입고 싶은 옷을 떠올려 봐요." },
  { key: "budget", title: "돈을 쓰는 기준", description: "금액을 정할 때 어떤 방식이 편한지 살펴봐요." },
  { key: "decision", title: "고르고 결정하는 방식", description: "후보를 알아보고 선택하는 과정을 생각해 봐요." },
  { key: "teamwork", title: "둘이 나누는 방식", description: "함께 볼 일과 나눠 맡을 일을 떠올려 봐요." },
  { key: "family", title: "가족과 상의하는 범위", description: "가족의 의견을 듣고 결정하는 순서를 생각해 봐요." },
  { key: "support", title: "힘들 때 받고 싶은 도움", description: "준비가 버거울 때 상대에게 바라는 도움을 살펴봐요." },
] as const satisfies readonly { key: V30Topic; title: string; description: string }[];

export const WEDDING_CODE_V30_QUESTIONS = [
  { id: "V1", topic: "vision", statement: "꽃 장식이 풍성한 공간에서 식을 올리고 싶다.", shortLabel: "풍성한 꽃 장식", followUp: "꽃 장식을 꼭 두고 싶은 곳은 어디인가요?" },
  { id: "V2", topic: "vision", statement: "야외에서 식을 올리고 싶다.", shortLabel: "야외에서 올리는 식", followUp: "마음에 드는 야외 공간과 비가 올 때 쓸 공간을 함께 살펴볼까요?" },
  { id: "V3", topic: "vision", statement: "예식 순서에 우리 둘의 이야기를 넣고 싶다.", shortLabel: "예식에 담는 둘의 이야기", followUp: "예식에 꼭 담고 싶은 두 사람의 이야기는 무엇인가요?" },
  { id: "V4", topic: "vision", statement: "예식은 꼭 필요한 순서만 짧게 하고 싶다.", shortLabel: "짧고 간결한 예식", followUp: "꼭 넣을 순서와 빼도 되는 순서를 각각 골라볼까요?" },
  { id: "G1", topic: "guests", statement: "초대할 사람은 평소 가깝게 지내는 사람 위주로 정하고 싶다.", shortLabel: "가까운 사람 위주의 초대", followUp: "각자 꼭 초대하고 싶은 사람을 먼저 적어볼까요?" },
  { id: "G2", topic: "guests", statement: "자주 만나지 못했던 지인들도 결혼식에 초대하고 싶다.", shortLabel: "뜸했던 지인도 초대하기", followUp: "자주 만나지는 못해도 초대하고 싶은 사람이 있나요?" },
  { id: "G3", topic: "guests", statement: "장소를 고를 때 하객이 오가는 이동 시간을 먼저 살펴보고 싶다.", shortLabel: "하객의 이동 시간", followUp: "하객이 주로 어디에서 오는지부터 함께 확인해 볼까요?" },
  { id: "G4", topic: "guests", statement: "식사는 하객이 메뉴를 직접 골라 먹는 방식이면 좋겠다.", shortLabel: "각자 골라 먹는 식사", followUp: "고를 수 있는 메뉴와 음식을 받는 동선을 함께 살펴볼까요?" },
  { id: "R1", topic: "records", statement: "사진에는 미리 포즈를 정하지 않은 순간들도 남기고 싶다.", shortLabel: "자연스러운 순간의 사진", followUp: "자유롭게 담아주면 좋을 순간은 언제인가요?" },
  { id: "R2", topic: "records", statement: "미리 정한 포즈로 찍는 사진도 남기고 싶다.", shortLabel: "미리 준비한 포즈의 사진", followUp: "꼭 찍고 싶은 포즈나 장면을 각각 골라볼까요?" },
  { id: "R3", topic: "records", statement: "예식에서는 평소보다 눈에 띄는 옷을 입고 싶다.", shortLabel: "평소보다 눈에 띄는 옷", followUp: "마음에 드는 옷 사진을 보며 어떤 부분이 좋은지 이야기해 볼까요?" },
  { id: "R4", topic: "records", statement: "예식에 입을 옷을 고를 때 움직이기 편한지를 먼저 보고 싶다.", shortLabel: "움직이기 편한 예식 옷", followUp: "후보 옷을 입고 앉거나 걸어보며 편한지 확인해 볼까요?" },
  { id: "B1", topic: "budget", statement: "마음에 드는 것이 생겨도 처음 정한 전체 예산 안에서 준비하고 싶다.", shortLabel: "처음 정한 전체 예산 지키기", followUp: "둘이 지키고 싶은 전체 예산의 범위부터 정해 볼까요?" },
  { id: "B2", topic: "budget", statement: "꼭 하고 싶은 항목에는 다른 항목의 비용을 줄여서라도 더 쓰고 싶다.", shortLabel: "원하는 곳에 비용 더 나누기", followUp: "더 쓰고 싶은 곳과 줄여도 되는 곳을 하나씩 골라볼까요?" },
  { id: "B3", topic: "budget", statement: "새로 하고 싶은 것이 생기면 전체 예산을 늘릴지도 다시 의논하고 싶다.", shortLabel: "필요하면 예산 증액도 의논하기", followUp: "어떤 경우에만 전체 예산을 다시 의논하면 좋을까요?" },
  { id: "B4", topic: "budget", statement: "준비를 시작할 때 항목별로 쓸 금액을 미리 나눠 정하고 싶다.", shortLabel: "항목별 금액 미리 정하기", followUp: "항목별 금액은 언제 정하고, 바꿀 때는 어떻게 상의할까요?" },
  { id: "D1", topic: "decision", statement: "마음에 드는 후보가 있어도 다른 후보를 더 비교해 보고 싶다.", shortLabel: "다른 후보까지 비교하기", followUp: "어떤 항목을 몇 곳까지 비교해 보면 좋을까요?" },
  { id: "D2", topic: "decision", statement: "미리 정한 조건을 충족한 후보가 있으면 그때 선택하고 싶다.", shortLabel: "조건에 맞으면 선택하기", followUp: "후보를 선택하기 전에 꼭 맞아야 할 조건은 무엇인가요?" },
  { id: "D3", topic: "decision", statement: "예식장은 직접 둘러본 뒤 고르고 싶다.", shortLabel: "예식장 직접 둘러보기", followUp: "방문해서 확인하고 싶은 곳과 시간을 함께 정해 볼까요?" },
  { id: "D4", topic: "decision", statement: "예약하기 전이라면 한 번 고른 곳도 더 마음에 드는 후보와 다시 비교하고 싶다.", shortLabel: "예약 전 후보 다시 비교하기", followUp: "예약 전 새 후보를 다시 볼 때 기준을 어떻게 정하면 좋을까요?" },
  { id: "T1", topic: "teamwork", statement: "업체를 알아볼 때는 시간을 맞춰 둘이 같이 찾아보고 싶다.", shortLabel: "시간을 맞춰 함께 찾아보기", followUp: "이번 주에 둘이 함께 알아볼 시간과 항목을 정해 볼까요?" },
  { id: "T2", topic: "teamwork", statement: "계약이나 추가 결제가 없는 세부 선택은 그 일을 맡은 사람이 정해도 괜찮다.", shortLabel: "계약·추가 결제 없는 세부 선택 맡기기", followUp: "맡아서 정할 세부 내용과 반드시 함께 결정할 내용을 나눠볼까요?" },
  { id: "T3", topic: "teamwork", statement: "각자 맡은 일도 진행 중에 어디까지 했는지 서로 알려주면 좋겠다.", shortLabel: "진행 상황 중간에 알려주기", followUp: "진행 상황을 언제, 어떤 방식으로 알려주면 편할까요?" },
  { id: "T4", topic: "teamwork", statement: "준비할 일을 시작하기 전에 누가 맡을지 정해 두고 싶다.", shortLabel: "시작 전에 담당 정하기", followUp: "다음에 할 일을 누가 맡고, 어려우면 어떻게 바꿀까요?" },
  { id: "F1", topic: "family", statement: "가족이 바라는 점은 준비 초반에 들어보고 싶다.", shortLabel: "가족의 바람 초반에 듣기", followUp: "준비 초반에 가족에게 먼저 여쭤볼 것은 무엇인가요?" },
  { id: "F2", topic: "family", statement: "가족과 생각이 달라도 마지막 선택은 우리 둘이 하고 싶다.", shortLabel: "마지막 선택은 둘이 하기", followUp: "가족에게 의견을 듣되 둘이 마지막에 정할 내용은 무엇인가요?" },
  { id: "F3", topic: "family", statement: "가족에게 의견을 묻기 전에 우리 둘의 생각부터 맞춰보고 싶다.", shortLabel: "가족과 상의 전 둘의 생각 맞추기", followUp: "가족과 이야기하기 전에 둘이 먼저 정리할 기준은 무엇인가요?" },
  { id: "F4", topic: "family", statement: "가족과 상의할 일은 각자 자기 쪽 가족에게 먼저 이야기하면 좋겠다.", shortLabel: "각자 자기 쪽 가족에게 먼저 이야기하기", followUp: "가족과 대화를 시작할 사람과 함께 이야기할 때를 정해 볼까요?" },
  { id: "H1", topic: "support", statement: "준비가 힘들다고 말할 때는 해결책보다 내 이야기를 먼저 들어주면 좋겠다.", shortLabel: "해결책 전에 이야기 들어주기", followUp: "힘들다고 말할 때, 처음에 어떻게 반응해 주면 좋겠나요?" },
  { id: "H2", topic: "support", statement: "할 일이 몰리면 상대가 내가 맡은 일의 일부를 맡아주면 좋겠다.", shortLabel: "몰린 일 일부 나눠 맡아주기", followUp: "도움이 필요한 일과 상대가 맡을 수 있는 일을 함께 확인해 볼까요?" },
  { id: "H3", topic: "support", statement: "무엇부터 할지 막히면 상대가 다음에 할 일 하나를 함께 정해주면 좋겠다.", shortLabel: "다음에 할 일 함께 정해주기", followUp: "지금 막힌 일에서 다음에 할 일 하나를 함께 정해 볼까요?" },
  { id: "H4", topic: "support", statement: "의견이 부딪힌 직후에는 잠깐 쉬었다가 다시 이야기하고 싶다.", shortLabel: "잠깐 쉬고 다시 이야기하기", followUp: "쉬고 싶을 때 어떻게 알리고, 언제 다시 이야기하면 좋을까요?" },
] as const satisfies readonly V30Question[];

export const WEDDING_CODE_V30_TASTES = TASTE_DOMAIN_OPTIONS.map(({ value, label }) => ({
  key: value,
  title: label,
  ...getWeddingTasteDomainQuestion(WEDDING_TASTE_VERSION, value),
})) satisfies readonly { key: V30TasteKey; title: string; question: string; max: number; options: readonly V30Option[] }[];

export const WEDDING_CODE_V30_SPENDING = [
  { value: "venue", label: "예식 장소·꾸미기" },
  { value: "photo", label: "사진·영상" },
  { value: "attire", label: "입을 옷" },
  { value: "meal", label: "식사" },
  { value: "ceremony", label: "예식 순서·연출" },
] as const satisfies readonly V30Option[];
