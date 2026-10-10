import { ITEMS21, TOPICS, VERSIONS, parseAnswers, responseLabel } from "./bank";
import type {
  Answers, CombinationNote, ItemId, NonFamilyItemId, NumericReading, NumericResponse,
  PreferenceInsight, PreferenceReport, Response, ResponseCounts, ResponseEvidence,
  SafeSummary, TopicReport, UnknownNote,
} from "./types";

export const AGREEMENT_COPY = {
  Q01: "식에 둘의 첫 만남 이야기를 넣고 싶다고 답했어요.",
  Q02: "다른 부분이 간단해져도 가장 원하는 한두 부분에 예산을 더 쓰고 싶다고 답했어요.",
  Q03: "꼭 넣을 항목이 생기면 전체 예산을 늘리지 않고 다른 항목의 돈을 줄이고 싶다고 답했어요.",
  Q04: "하객 인사를 마친 뒤 생긴 여유는 둘만의 시간으로 쓰고 싶다고 답했어요.",
  Q05: "예식장을 찾기 시작할 때부터 후보를 함께 보며 이야기하고 싶다고 답했어요.",
  Q06: "마음에 드는 예식장 후보를 먼저 몇 곳 찾아본 뒤 상대와 이야기하고 싶다고 답했어요.",
  Q07: "둘이 조건을 정한 뒤라면 첫 예식장 후보를 상대가 추려 와도 편하다고 답했어요.",
  Q08: "둘 다 마음에 드는 청첩장 두 개가 남았을 때 마지막 선택을 상대에게 맡겨도 편하다고 답했어요.",
  Q09: "예산과 날짜에 맞고 마음에 드는 예식장 두 곳을 더 찾기보다 자세히 비교하고 싶다고 답했어요.",
  Q10: "각자 고른 예식장이 다르면 둘 다 새 후보를 찾아보고 싶다고 답했어요.",
  Q11: "의견이 안 맞는 날에는 각자 생각한 뒤 다음 날 다시 이야기하고 싶다고 답했어요.",
  Q12: "조건을 정하고 내가 후보 찾기를 맡았다면 후보를 추린 뒤 상대와 이야기하고 싶다고 답했어요.",
  Q13: "예식 분위기를 생각하기 시작할 때 가족이 바라는 분위기도 들어보고 싶다고 답했어요.",
  Q14: "둘이 원하는 식을 대략 정한 뒤 확정하기 전에 가족 의견도 듣고 싶다고 답했어요.",
  Q15: "둘 다 괜찮은 식순 두 가지가 있다면 가족이 더 좋아하는 쪽을 고르고 싶다고 답했어요.",
  Q16: "원하는 식순이 다를 때 가족 의견을 들은 뒤 마지막 선택은 둘이 하고 싶다고 답했어요.",
  Q17: "예식장 답변 때문에 속상한 날 해결책보다 내 이야기를 먼저 들어주길 바란다고 답했어요.",
  Q18: "맡은 업체 연락이 버거울 때 물어볼 내용을 같이 정리하기보다 연락을 대신 맡아주길 바란다고 답했어요.",
  Q19: "맡은 준비가 밀린 날 일부를 대신 끝내주기보다 함께 하나씩 하는 게 편하다고 답했어요.",
  Q20: "예식장을 둘러보고 지쳤을 때 처음 쉬는 시간은 상대와 함께 보내고 싶다고 답했어요.",
  Q21: "예식장을 둘러보고 지쳤을 때 처음 쉬는 시간은 혼자 보내고 싶다고 답했어요.",
} as const satisfies Record<ItemId, string>;

interface ReadingCopy {
  readonly subject: string;
  readonly contextCaveat: string;
  readonly partnerQuestion: string;
  readonly action: string;
  readonly openQuestion: string;
  readonly openAction: string;
}

// 문항별 허용 해석과 제안이다. 제안은 실행이나 두 사람의 합의가 아니다.
export const READING_COPY = {
  Q01: {
    subject: "식에 둘의 첫 만남 이야기를 넣는 방식",
    contextCaveat: "공개하고 싶은 이야기의 범위나 식에 쓸 수 있는 시간에 따라 답이 달라질 수 있어요.",
    partnerQuestion: "처음 만난 이야기 중 하객에게 들려줘도 괜찮은 부분은 어디까지일까?",
    action: "“식에서 나누고 싶은 이야기와 둘만 간직할 이야기를 먼저 정해보자.”",
    openQuestion: "첫 만남 이야기를 넣는다면 어떤 부분이 편하거나 불편할까?",
    openAction: "이야기의 내용·공개 범위·시간 중 이 문장을 고르기 어려웠던 부분을 하나 짚어보세요.",
  },
  Q02: {
    subject: "다른 부분을 간단히 하고 원하는 한두 부분에 예산을 더 쓰는 방식",
    contextCaveat: "계약 전이고 기본 진행 비용이 마련된 상황의 답이에요. 실제 여유 금액이나 줄일 수 있는 항목에 따라 달라질 수 있어요.",
    partnerQuestion: "더 쓰고 싶은 한두 부분은 무엇이고, 간단해져도 괜찮은 부분은 어디일까?",
    action: "각자 더 쓰고 싶은 항목과 간단히 해도 되는 항목을 적어 함께 살펴보세요.",
    openQuestion: "한두 부분에 돈을 모으는 방식에서 무엇이 마음에 걸릴까?",
    openAction: "원하는 항목을 정하기 전에, 다른 부분이 얼마나 간단해져도 괜찮은지 먼저 확인해보세요.",
  },
  Q03: {
    subject: "새 항목을 넣기 위해 전체 예산을 늘리지 않고 다른 항목의 돈을 줄이는 방식",
    contextCaveat: "계약 전이라는 조건의 답이에요. 이미 낸 돈이나 변경 비용은 이 문항에서 확인하지 않았어요.",
    partnerQuestion: "새로 넣고 싶은 항목이 생기면 어느 항목의 돈을 줄일 수 있을까?",
    action: "“추가할 항목을 정하기 전에 같은 금액을 어디에서 줄일지 같이 적어보자.”",
    openQuestion: "전체 예산을 유지하는 것과 다른 항목을 줄이는 것 중 무엇을 더 확인해야 할까?",
    openAction: "이 문장에 덜 끌린 이유를 먼저 확인하고, 예산을 늘리거나 줄이는 결정을 따로 하세요.",
  },
  Q04: {
    subject: "하객 인사 뒤 남은 여유를 둘만의 시간으로 쓰는 방식",
    contextCaveat: "하객 인사를 이미 마친 뒤의 여유 시간에 관한 답이에요. 하객을 대하는 마음이나 식 전체의 우선순위를 뜻하지 않아요.",
    partnerQuestion: "인사를 마친 뒤 여유가 생기면 둘이 무엇을 하며 보내고 싶을까?",
    action: "“인사를 마친 뒤 잠깐 둘이 앉아 있을 시간을 남겨두면 좋겠어.”",
    openQuestion: "인사를 마친 뒤 남은 시간에는 어떤 선택이 더 편할까?",
    openAction: "둘만의 시간·하객과의 추가 대화·다른 할 일 중 직접 원하는 것을 이야기해보세요.",
  },
  Q05: {
    subject: "예식장 탐색을 시작할 때부터 후보를 함께 보는 방식",
    contextCaveat: "둘 다 시간이 있고 급하지 않은 상황의 답이에요. 마음에 드는 후보를 먼저 찾아본 뒤 이야기하는 Q06에도 함께 동의할 수 있어요.",
    partnerQuestion: "처음부터 함께 볼 때에는 언제, 어느 정도의 후보를 같이 보면 좋을까?",
    action: "“예식장을 찾기 시작하는 날에 같이 볼 시간을 먼저 정하자.”",
    openQuestion: "예식장을 찾기 시작할 때 어떤 시점에 서로 이야기를 나누면 편할까?",
    openAction: "처음부터 함께 보기의 어떤 부분이 맞지 않거나 반반인지 확인한 뒤 탐색 순서를 정하세요.",
  },
  Q06: {
    subject: "내가 좋아하는 예식장 후보를 먼저 몇 곳 찾아본 뒤 이야기하는 방식",
    contextCaveat: "먼저 찾아보고 싶다는 답은 마지막 결정을 혼자 하고 싶다는 뜻이 아니에요. Q05의 함께 탐색하기와 모두 맞을 수 있어요.",
    partnerQuestion: "내가 먼저 찾아본 후보를 언제, 어떤 내용과 함께 보여주면 좋을까?",
    action: "“마음에 드는 후보를 몇 곳 찾아보고, 좋은 점과 궁금한 점을 같이 이야기하고 싶어.”",
    openQuestion: "후보를 먼저 찾아본 뒤 이야기하는 과정에서 무엇이 더 필요할까?",
    openAction: "먼저 찾아볼 범위와 서로 이야기할 시점을 각각 정해보세요.",
  },
  Q07: {
    subject: "조건을 정한 뒤 첫 예식장 후보를 상대가 추려 오는 방식",
    contextCaveat: "둘이 조건을 정했고 상대가 맡은 일을 해낼 수 있다는 상황의 답이에요. 실제 분담이나 상대의 능력을 확인한 답이 아니에요.",
    partnerQuestion: "첫 후보를 맡기기 전에 함께 정해둘 조건은 무엇일까?",
    action: "“예산과 날짜처럼 꼭 지킬 조건을 정하면, 첫 후보는 네가 골라 와도 편해.”",
    openQuestion: "첫 후보를 상대가 추릴 때 내가 함께 확인하고 싶은 것은 무엇일까?",
    openAction: "첫 후보를 함께 볼지 상대가 먼저 추릴지 정하기 전에, 필요한 조건을 적어보세요.",
  },
  Q08: {
    subject: "둘 다 마음에 드는 청첩장 두 개 중 마지막 선택을 상대에게 맡기는 방식",
    contextCaveat: "둘 다 두 후보를 좋아한다는 조건의 답이에요. 예식장·계약·예산 등 다른 결정의 위임까지 확인하지 않았어요.",
    partnerQuestion: "두 후보가 모두 괜찮다고 확인한 뒤 어느 부분을 마지막으로 확인하면 좋을까?",
    action: "“이 청첩장 두 개는 나도 모두 좋아. 마지막 선택은 네가 해도 편해.”",
    openQuestion: "둘 다 좋아하는 청첩장 두 개가 남아도 마지막에 내가 확인하고 싶은 것은 무엇일까?",
    openAction: "두 청첩장에서 나에게 중요한 부분을 하나씩 적고 마지막 선택 순서를 이야기해보세요.",
  },
  Q09: {
    subject: "조건에 맞고 마음에 드는 예식장 두 곳을 더 찾기보다 자세히 비교하는 방식",
    contextCaveat: "예산과 날짜에 맞는 두 곳이 모두 마음에 든다는 조건이에요. 다른 조건이 빠져 있거나 계약 기한이 생기면 달라질 수 있어요.",
    partnerQuestion: "두 예식장을 더 자세히 비교하려면 어떤 정보를 확인하면 좋을까?",
    action: "두 후보의 확인된 조건과 아직 물어볼 내용을 같은 표에 적어보세요.",
    openQuestion: "마음에 드는 두 예식장 외에 더 살펴보고 싶은 조건이 있을까?",
    openAction: "더 찾을지 정하기 전에 두 후보에서 아직 확인하지 못한 조건을 한 가지 적어보세요.",
  },
  Q10: {
    subject: "각자 고른 예식장이 다를 때 둘 다 새 후보를 찾는 방식",
    contextCaveat: "각자 고른 장소가 다를 때의 답이에요. 모든 의견 차이에서 새 대안을 찾는다고 일반화할 수 없어요.",
    partnerQuestion: "새 후보에서는 각자가 고른 예식장의 어떤 장점을 함께 찾고 싶을까?",
    action: "각자의 후보에서 마음에 든 조건을 하나씩 적은 뒤 새 후보의 기준으로 써보세요.",
    openQuestion: "고른 예식장이 다르면 기존 후보에서 무엇부터 비교하고 싶을까?",
    openAction: "새 후보를 찾는 방식의 어떤 부분이 편하지 않은지 말한 뒤 다음 탐색 범위를 정하세요.",
  },
  Q11: {
    subject: "의견이 안 맞는 날 각자 생각한 뒤 다음 날 다시 이야기하는 방식",
    contextCaveat: "급한 결정이 없고 다음 날 다시 이야기할 수 있는 상황의 답이에요. 실제 갈등 대처나 관계 상태는 확인하지 않았어요.",
    partnerQuestion: "잠깐 멈춘 뒤 다음 날 언제 다시 이야기하면 편할까?",
    action: "“오늘은 각자 생각해보고 내일 저녁에 다시 이야기하고 싶어.”",
    openQuestion: "의견이 안 맞는 날에는 언제, 어떤 방식으로 다시 이야기하면 좋을까?",
    openAction: "다시 이야기할 때 필요한 준비와 편한 시점을 각각 말해보세요.",
  },
  Q12: {
    subject: "내가 맡은 업체 탐색에서 후보를 추린 뒤 상대와 이야기하는 방식",
    contextCaveat: "둘이 조건과 담당을 이미 정한 뒤의 답이에요. 탐색 시작부터의 참여를 묻는 Q05와 상황이 달라요.",
    partnerQuestion: "내가 후보를 추리는 동안 새 조건이 생기면 어떻게 알려주면 좋을까?",
    action: "“정한 조건으로 후보를 추린 뒤 같이 보자. 조건이 달라지면 먼저 알려줘.”",
    openQuestion: "내가 후보 찾기를 맡았을 때 상대와 중간에 무엇을 함께 확인하면 좋을까?",
    openAction: "후보를 찾는 중에 다시 확인할 조건과 이야기할 시점을 함께 적어보세요.",
  },
  Q13: {
    subject: "예식 분위기를 생각하기 시작할 때 가족이 바라는 분위기를 듣는 방식",
    contextCaveat: "가족의 의견을 듣는 시작 시점에 관한 답이에요. 가족 의견을 최종 선택으로 삼겠다는 답은 아니에요.",
    partnerQuestion: "처음 분위기를 생각할 때 가족에게 무엇을 물어보고 싶을까?",
    action: "가족에게 듣고 싶은 분위기와 둘이 먼저 정할 부분을 각각 적어보세요.",
    openQuestion: "식의 분위기를 생각할 때 가족과 언제, 어떤 내용을 나누면 편할까?",
    openAction: "가족 의견을 듣고 싶은지와 원하는 시점을 각각 이야기해보세요.",
  },
  Q14: {
    subject: "둘이 식의 모습을 대략 정한 뒤 확정 전에 가족 의견을 듣는 방식",
    contextCaveat: "둘의 초안이 있고 확정 전인 상황이에요. 처음부터 가족 의견을 듣는 Q13에도 모두 동의할 수 있어요.",
    partnerQuestion: "우리 초안을 가족에게 보여줄 때 아직 바꿀 수 있는 부분은 어디까지일까?",
    action: "“우리가 생각한 모습을 먼저 정리하고, 확정 전에 가족에게도 의견을 듣자.”",
    openQuestion: "둘의 초안을 정한 뒤 가족 의견을 듣는 과정에서 무엇을 정해두면 편할까?",
    openAction: "초안·의견을 들을 범위·확정 시점을 구분해 적어보세요.",
  },
  Q15: {
    subject: "둘 다 괜찮은 식순 두 가지 중 가족이 더 좋아하는 쪽을 고르는 방식",
    contextCaveat: "둘 다 두 식순을 괜찮게 느낀다는 조건이에요. 다른 식순이나 비용·가족 관계에 대한 답은 아니에요.",
    partnerQuestion: "두 식순이 모두 괜찮다는 점을 확인하고 가족 의견을 들어도 될까?",
    action: "“둘 다 괜찮은 이 두 식순에서는 가족이 더 좋아하는 쪽으로 골라도 좋겠어.”",
    openQuestion: "둘 다 괜찮은 두 식순 중 마지막으로 고를 때 무엇을 기준으로 삼고 싶을까?",
    openAction: "두 후보에 대한 둘의 동의를 먼저 확인하고, 마지막 기준을 직접 정해보세요.",
  },
  Q16: {
    subject: "식순 의견이 다를 때 가족 의견을 들은 뒤 마지막 선택을 둘이 하는 방식",
    contextCaveat: "식순에 대한 의견이 다를 때의 최종 선택에 관한 답이에요. 가족의 자원·권한·실제 의견을 확인한 문항은 아니에요.",
    partnerQuestion: "가족 의견을 듣고 우리가 마지막으로 확인할 식순 기준은 무엇일까?",
    action: "“가족의 의견을 들은 뒤 마지막 식순은 우리 둘이 확인하고 정하고 싶어.”",
    openQuestion: "식순에 대한 의견이 다를 때 마지막 선택 과정에 누구와 무엇을 확인하고 싶을까?",
    openAction: "마지막 선택에서 함께 확인할 사람과 꼭 지킬 식순 기준을 적어보세요.",
  },
  Q17: {
    subject: "예식장 답변 때문에 속상할 때 해결책보다 내 이야기를 먼저 들어주는 방식",
    contextCaveat: "바로 처리할 일이 없고 상대에게 여유가 있는 날의 답이에요. 해결책을 원하지 않는다는 뜻까지 확인하지 않았어요.",
    partnerQuestion: "이야기를 먼저 들어줄 때 어떤 말이나 반응이 편할까?",
    action: "“해결책은 잠시 뒤에 생각하고, 지금은 내 이야기를 먼저 들어주면 좋겠어.”",
    openQuestion: "속상한 예식장 답변을 받은 날에는 어떤 도움이 먼저 필요할까?",
    openAction: "이야기 듣기·함께 확인하기·다른 도움 중 지금 필요한 것을 직접 요청해보세요.",
  },
  Q18: {
    subject: "업체 연락이 버거울 때 내용을 같이 정리하기보다 연락을 대신 맡아주는 방식",
    contextCaveat: "부담스러운 업체 연락을 묻는 답이에요. 준비가 밀린 날 함께 진행하는 Q19와 조건이 달라 서로 반대 답으로 계산하지 않아요.",
    partnerQuestion: "연락을 대신 맡길 때 전달할 내용과 나에게 다시 확인할 부분은 무엇일까?",
    action: "“이번 업체 연락을 대신 맡아줄 수 있을까? 새 조건을 정해야 하면 나에게 먼저 확인해줘.”",
    openQuestion: "업체 연락이 버거울 때 어떤 부분을 함께 하면 도움이 될까?",
    openAction: "질문 정리·연락·답변 확인 중 맡기거나 함께 하고 싶은 범위를 직접 고르세요.",
  },
  Q19: {
    subject: "준비가 밀린 날 일부를 대신 끝내주기보다 함께 하나씩 하는 방식",
    contextCaveat: "맡은 준비가 밀린 날의 진행 방식에 관한 답이에요. 상대에게 여유가 없거나 바로 끝낼 일이 생기면 달라질 수 있어요.",
    partnerQuestion: "밀린 일을 함께 한다면 무엇부터 같이 시작하고 싶을까?",
    action: "“내 일을 대신 끝내기보다 지금 가장 작은 일 하나를 나와 같이 해주면 좋겠어.”",
    openQuestion: "준비가 밀린 날에는 어떤 일을 함께 하거나 맡기면 편할까?",
    openAction: "밀린 일 하나를 골라 같이 할 부분과 맡기고 싶은 부분을 직접 말해보세요.",
  },
  Q20: {
    subject: "예식장 방문 뒤 처음 쉬는 시간을 상대와 함께 보내는 방식",
    contextCaveat: "예식장을 둘러보고 지친 직후의 첫 휴식에 관한 답이에요. Q21에도 동의했다면 편한 조건이나 순서는 더 물어봐야 해요.",
    partnerQuestion: "함께 쉬는 동안 이야기를 나누는 것과 조용히 있는 것 중 무엇이 편할까?",
    action: "“예식장을 보고 나면 처음에는 같이 쉬고 싶어. 쉬는 동안 무엇을 할지도 같이 정하자.”",
    openQuestion: "예식장을 보고 지친 직후에는 어떻게 쉬면 편할까?",
    openAction: "함께 보내는 첫 휴식의 어떤 부분이 맞지 않거나 반반인지 이야기해보세요.",
  },
  Q21: {
    subject: "예식장 방문 뒤 처음 쉬는 시간을 혼자 보내는 방식",
    contextCaveat: "지친 직후의 첫 휴식에 관한 답이에요. 일상의 성격이나 상대와의 거리감을 뜻하지 않아요. Q20과 함께 동의할 수도 있어요.",
    partnerQuestion: "혼자 먼저 쉬고 싶을 때 어떻게 알려주고 다시 함께하면 좋을까?",
    action: "“예식장을 보고 나면 처음에는 혼자 쉬고 싶어. 다시 이야기할 때를 같이 정해두자.”",
    openQuestion: "혼자 쉬는 시간이 편하거나 불편한 조건은 무엇일까?",
    openAction: "이번 방문 뒤 원하는 첫 휴식을 말하고, 다시 이야기하고 싶은 시점도 알려주세요.",
  },
} as const satisfies Record<ItemId, ReadingCopy>;

function isNumeric(response: Response): response is NumericResponse {
  return typeof response === "number";
}

function readingFor(response: NumericResponse): NumericReading {
  if (response === 3) return "middle";
  return response === 4 || response === 5 ? "agreement" : "disagreement";
}

function checkedAnswers(answers: Answers): Answers {
  const checked = parseAnswers(answers);
  if (!checked) throw new Error("21문항의 응답 형식을 확인해 주세요.");
  return checked;
}

function makeEvidence(answers: Answers): ResponseEvidence[] {
  return ITEMS21.map((item) => ({
    itemId: item.id,
    number: item.number,
    statement: item.statement,
    context: TOPICS.find((topic) => topic.id === item.topicId)?.context ?? "",
    response: answers[item.id],
    responseLabel: responseLabel(answers[item.id]),
  }));
}

function makeInsight(evidence: ResponseEvidence): PreferenceInsight | null {
  if (!isNumeric(evidence.response)) return null;
  const copy = READING_COPY[evidence.itemId];
  const reading = readingFor(evidence.response);
  const observation = reading === "agreement" ? AGREEMENT_COPY[evidence.itemId]
    : reading === "middle" ? `${copy.subject}에 끌리는 정도가 반반이라고 답했어요.`
      : `${copy.subject}은 내가 원하는 방식과 맞지 않는다고 답했어요.`;
  return {
    itemId: evidence.itemId,
    reading,
    observation,
    evidence,
    contextCaveat: copy.contextCaveat,
    partnerQuestion: reading === "agreement" ? copy.partnerQuestion : copy.openQuestion,
    action: reading === "agreement" ? copy.action : copy.openAction,
  };
}

function countResponses(answers: Answers): ResponseCounts {
  const values = ITEMS21.map((item) => answers[item.id]);
  return {
    total: 21,
    responded: values.filter((value) => value !== null).length,
    numeric: values.filter(isNumeric).length,
    unknown: values.filter((value) => value === "unknown").length,
    notApplicable: values.filter((value) => value === "not-applicable").length,
    skipped: values.filter((value) => value === "skipped").length,
    unanswered: values.filter((value) => value === null).length,
  };
}

function makeTopicReports(evidence: readonly ResponseEvidence[]): TopicReport[] {
  return TOPICS.map((topic) => {
    const insights = evidence.filter((row) => topic.itemIds.some((id) => id === row.itemId))
      .map(makeInsight).filter((insight): insight is PreferenceInsight => insight !== null);
    const agreement = insights.filter((insight) => insight.reading === "agreement").length;
    const middle = insights.filter((insight) => insight.reading === "middle").length;
    const disagreement = insights.filter((insight) => insight.reading === "disagreement").length;
    return {
      id: topic.id,
      title: topic.title,
      numericCount: insights.length,
      summary: insights.length === 0 ? "이 주제는 수치 응답으로 확인한 선호가 아직 없어요. 남긴 응답 상태를 아래에서 확인할 수 있어요."
        : `수치 응답 ${insights.length}개 중 맞아요 ${agreement}개 · 반반 ${middle}개 · 맞지 않아요 ${disagreement}개예요. 문장마다 따로 읽어요.`,
      insights,
    };
  });
}

const JOINT_READINGS = [
  {
    itemIds: ["Q02", "Q03"],
    message: "원하는 한두 부분에 예산을 집중하는 것과, 새 항목을 넣을 때 전체 예산을 유지하며 재배분하는 것에 모두 동의했어요. 두 답은 서로 다른 예산 선택을 설명해요.",
    partnerQuestion: "집중하고 싶은 항목이 생겼을 때, 어디에서 얼마를 줄일지도 함께 정할까?",
    action: "더 쓰고 싶은 항목과 줄일 항목을 따로 적은 뒤 두 목록이 실제로 맞는지 확인해보세요.",
  },
  {
    itemIds: ["Q05", "Q06"],
    message: "처음부터 후보를 함께 보기와, 내가 먼저 몇 곳 찾아본 뒤 이야기하기에 모두 동의했어요. 함께 보는 범위와 먼저 찾아볼 범위는 이 답만으로 정할 수 없어요.",
    partnerQuestion: "처음 같이 볼 것과 각자 먼저 찾아볼 것을 어떻게 나누면 편할까?",
    action: "첫 대화에서 함께 확인할 조건과 먼저 찾아볼 후보 범위를 나눠 정해보세요.",
  },
  {
    itemIds: ["Q13", "Q14"],
    message: "분위기를 생각하기 시작할 때와 둘의 초안을 확정하기 전에 가족 의견을 듣는 것에 모두 동의했어요. 두 시점에서 다른 내용을 물어볼 수 있어요.",
    partnerQuestion: "처음에는 가족에게 무엇을 듣고, 초안이 생기면 무엇을 다시 확인할까?",
    action: "처음 들을 분위기와 확정 전에 확인할 내용을 별도로 적어보세요.",
  },
  {
    itemIds: ["Q18", "Q19"],
    message: "버거운 업체 연락은 대신 맡아주길 바라면서, 준비가 밀린 날에는 함께 하나씩 하는 방식에 모두 동의했어요. 도움이 필요한 일과 상황이 달라요.",
    partnerQuestion: "연락을 맡길 때와 밀린 일을 같이 할 때 각각 어디까지 도움받으면 좋을까?",
    action: "“연락은 대신 맡아주고, 밀린 준비는 나와 같이 해주면 좋겠어.”처럼 상황별 부탁을 나눠보세요.",
  },
  {
    itemIds: ["Q20", "Q21"],
    message: "처음 쉬는 시간을 함께 보내는 것과 혼자 보내는 것에 모두 동의했어요. 어느 조건이나 순서가 편한지는 이 답만으로 정할 수 없어요.",
    partnerQuestion: "어떤 날에는 함께, 어떤 날에는 혼자 먼저 쉬고 싶을까?",
    action: "다음 예식장 방문 뒤에는 그날 원하는 첫 휴식을 직접 말하고, 함께·혼자 중 하나를 고정하지 마세요.",
  },
] as const satisfies readonly CombinationNote[];

function makeCombinations(answers: Answers): CombinationNote[] {
  return JOINT_READINGS.filter((note) => note.itemIds.every((id) => answers[id] === 4 || answers[id] === 5));
}

function makeUnknowns(answers: Answers, counts: ResponseCounts): UnknownNote[] {
  const notes: UnknownNote[] = [];
  const descriptions = [
    { response: "unknown", kind: "unknown", message: "‘아직 모르겠어요’는 판단이 아직 서지 않은 답이에요. 반반이나 낮은 동의로 바꾸지 않았어요." },
    { response: "not-applicable", kind: "not-applicable", message: "‘나에게 해당하지 않아요’는 이 장면을 내 상황에 적용하지 않은 답이에요. 가족 관계나 가치관을 추정하지 않았어요." },
    { response: "skipped", kind: "skipped", message: "‘지금 답하지 않을게요’는 지금 응답을 남기지 않기로 한 선택이에요. 원하는 방식을 정한 답으로 읽지 않았어요." },
    { response: null, kind: "unanswered", message: "아직 답하지 않은 문항이 있어요. 모름·비해당·건너뜀으로 대신 채우지 않았어요." },
    { response: 3, kind: "middle", message: "‘반반이에요’는 문장에 끌리는 정도가 중간이라는 답이에요. 판단이 서지 않았다는 답과 구분했어요." },
  ] as const;
  for (const description of descriptions) {
    const itemIds = ITEMS21.filter((item) => answers[item.id] === description.response).map((item) => item.id);
    if (itemIds.length > 0) notes.push({ kind: description.kind, itemIds, message: description.message });
  }
  notes.push({
    kind: "scope",
    itemIds: [],
    message: counts.numeric === 0
      ? "수치 응답이 없어 어떤 준비 방식이 더 맞는지 아직 설명할 수 없어요. 남긴 응답 상태와 나중에 확인할 장면을 보여드려요."
      : `수치 응답 ${counts.numeric}개가 말해주는 해당 장면의 선호만 설명했어요. 실제 행동·상대의 생각·다른 상황의 선택은 아직 알 수 없어요.`,
  });
  return notes;
}

function noNumericPrompts(counts: ResponseCounts): { question: string; action: string } {
  if (counts.unknown > 0 && counts.notApplicable === 0 && counts.skipped === 0) {
    return {
      question: "아직 잘 모르겠는 장면에서, 어떤 정보를 먼저 확인하면 답하기 쉬울까?",
      action: "판단에 필요한 정보가 있다면 하나만 적어두세요. 정보가 생긴 뒤 해당 문항을 다시 답해도 괜찮아요.",
    };
  }
  if (counts.notApplicable > 0 && counts.unknown === 0 && counts.skipped === 0) {
    return {
      question: "이번 준비에 해당하는 장면이 있다면 어떤 이야기부터 나누고 싶을까?",
      action: "해당하는 장면이 없다면 이 상태로 두어도 괜찮아요. 실제 준비에서 필요한 이야기 하나를 직접 골라보세요.",
    };
  }
  if (counts.skipped > 0 && counts.unknown === 0 && counts.notApplicable === 0) {
    return {
      question: "나중에 답하고 싶은 부분이 있을까, 아니면 지금은 준비 이야기만 나누고 싶을까?",
      action: "지금 답을 더 남기지 않아도 괜찮아요. 원할 때 수정 화면에서 편한 문항 하나만 다시 살펴보세요.",
    };
  }
  if (counts.responded === 0) {
    return {
      question: "먼저 편하게 떠올릴 수 있는 결혼 준비 장면은 무엇일까?",
      action: "원하면 떠올리기 쉬운 문항 하나부터 살펴보세요. 아직 답을 고르기 어렵다면 미응답으로 두어도 괜찮아요.",
    };
  }
  return {
    question: "지금 우리 준비에 해당하는 장면과 나중에 확인할 장면을 어떻게 나누면 좋을까?",
    action: "모름·비해당·건너뜀을 그대로 둔 채, 실제로 필요한 준비 이야기 하나를 직접 골라 나눠보세요.",
  };
}

export function buildReport(input: Answers): PreferenceReport {
  const answers = checkedAnswers(input);
  const counts = countResponses(answers);
  const evidence = makeEvidence(answers);
  const topics = makeTopicReports(evidence);
  const insights = topics.flatMap((topic) => topic.insights);
  const prompts = noNumericPrompts(counts);
  const highlights = topics.flatMap((topic) => {
    const insight = topic.insights.find((entry) => entry.reading === "agreement")
      ?? topic.insights.find((entry) => entry.reading === "middle") ?? topic.insights[0];
    return insight ? [{ topicId: topic.id, itemId: insight.itemId, text: insight.observation }] : [];
  });
  return {
    versions: VERSIONS,
    validationStatus: "UNVALIDATED",
    counts,
    core: {
      headline: counts.numeric === 0 ? "아직 확인할 준비 방식이 남아 있어요" : "이번 답에서 확인한 결혼 준비 선호",
      summary: counts.numeric === 0
        ? "수치 응답으로 정한 선호가 아직 없어요. 모름·비해당·건너뜀·미응답의 뜻을 구분해 그대로 남겼어요."
        : `21문항 중 ${counts.responded}개에 응답을 남겼고, 그중 ${counts.numeric}개가 수치 응답이에요. 아래 요약은 각 장면에서 직접 고른 답에 근거해요.`,
      highlights,
    },
    topics,
    evidence,
    contextCaveats: insights.length > 0
      ? insights.map((insight) => ({ itemId: insight.itemId, text: insight.contextCaveat }))
      : [{ itemId: null, text: "각 문항의 안내 상황을 떠올리기 어려웠거나 내 준비에 해당하지 않을 수 있어요. 남긴 상태만으로 더 편한 방식을 정하지 않아요." }],
    partnerQuestions: insights.length > 0
      ? insights.map((insight) => ({ itemId: insight.itemId, text: insight.partnerQuestion }))
      : [{ itemId: null, text: prompts.question }],
    actions: insights.length > 0
      ? insights.map((insight) => ({ itemId: insight.itemId, text: insight.action }))
      : [{ itemId: null, text: prompts.action }],
    combinations: makeCombinations(answers),
    unknowns: makeUnknowns(answers, counts),
    character: {
      status: "pending",
      message: "새 21문항과 네 글자·16캐릭터의 연결은 아직 설계 중이에요. 이 답으로 캐릭터를 확정하지 않으며, 연결 규칙이 준비되면 별도 버전으로 안내해요.",
    },
  };
}

function isNonFamilyItemId(itemId: ItemId): itemId is NonFamilyItemId {
  return itemId !== "Q13" && itemId !== "Q14" && itemId !== "Q15" && itemId !== "Q16";
}

// 공유 동의는 호출자가 받는다. 이 함수는 공개하기 전 검토할 고정 문구만 만든다.
export function buildSafeSummary(input: Answers): SafeSummary {
  const answers = checkedAnswers(input);
  const lines = ITEMS21.flatMap((item) => isNonFamilyItemId(item.id)
    && (answers[item.id] === 4 || answers[item.id] === 5)
    ? [{ itemId: item.id, text: AGREEMENT_COPY[item.id] }] : []);
  return {
    headline: "내 결혼 준비 선호",
    summary: lines.length > 0
      ? "내가 대체로 또는 아주 잘 맞는다고 답한 준비 방식을 골라 담았어요."
      : "공유할 구체적인 선호를 아직 고르지 않았어요.",
    lines,
  };
}
