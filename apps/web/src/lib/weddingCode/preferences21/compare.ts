import { ITEMS21, TOPICS, VERSIONS, parseAnswers, responseLabel } from "./bank";
import type { ItemId, Response } from "./types";
import { hasPreferences21ExactKeys, hasPreferences21Versions, isPreferences21PlainObject } from "./storage";

export type Preferences21ComparisonRow = Readonly<{
  itemId: ItemId;
  statement: string;
  context: string;
  ownResponse: Response;
  partnerResponse: Response;
  ownLabel: string;
  partnerLabel: string;
  state: "same-answer" | "different-answers" | "needs-answer";
  question: string;
  action: string;
}>;
export type Preferences21Comparison =
  | { status: "ready"; rows: readonly Preferences21ComparisonRow[]; numericCompared: number; sameNumeric: number; differentNumeric: number; notice: string }
  | { status: "invalid" | "version-mismatch"; notice: string };

export const preferences21ResponseLabel = responseLabel;

const CONVERSATIONS: Readonly<Record<ItemId, { question: string; action: string }>> = {
  Q01: { question: "처음 만난 이야기를 식에서 나누는 데 각자 기대하거나 망설이는 점은 무엇인가요?", action: "이야기를 넣을지, 넣는다면 누가 어떤 길이로 말할지 각자 제안한 뒤 함께 정해 보세요." },
  Q02: { question: "예산을 더 쓰고 싶은 한두 부분과, 간단해져도 괜찮은 부분은 각자 무엇인가요?", action: "각자가 지키고 싶은 항목과 줄여도 되는 항목을 적고, 함께 허용할 범위를 정해 보세요." },
  Q03: { question: "새 항목이 생겼을 때 다른 돈을 줄이는 방식은 각자 어떤 조건에서 괜찮을까요?", action: "줄일 수 있는 항목과 지켜야 할 항목을 각자 제안하고, 돈을 옮기기 전에 둘 다 확인하기로 정해 보세요." },
  Q04: { question: "하객 인사를 마친 뒤 남는 시간에 각자 하고 싶은 일은 무엇인가요?", action: "하객과 이야기할 시간과 둘만의 시간을 어떻게 나눌지 각자 제안한 뒤 함께 정해 보세요." },
  Q05: { question: "후보를 처음 찾을 때 함께 보는 방식이 각자에게 편한 이유나 부담은 무엇인가요?", action: "처음부터 함께 볼 부분과 따로 찾아도 될 부분을 둘 다 동의하는 범위로 정해 보세요." },
  Q06: { question: "내가 먼저 후보를 찾는 시간과 함께 이야기하는 시점을 각자 어떻게 원하나요?", action: "각자 찾을 범위와 후보를 공유할 시점을 제안하고, 둘이 확인할 시간을 함께 정해 보세요." },
  Q07: { question: "상대가 첫 후보를 추려도 편하려면 각자 어떤 조건을 먼저 알아야 하나요?", action: "후보 기준과 담당 범위를 둘이 확인한 뒤, 누가 첫 후보를 찾을지 함께 정해 보세요." },
  Q08: { question: "둘 다 좋아하는 마지막 두 후보에서 각자 선택에 참여하고 싶은 정도와 이유는 무엇인가요?", action: "누가 마지막 선택을 할지 미리 가정하지 말고, 함께 고르기·한 사람이 고르기 중 둘 다 편한 방식을 확인해 주세요." },
  Q09: { question: "조건에 맞는 두 곳이 남았을 때 더 찾거나 자세히 비교하고 싶은 이유는 각각 무엇인가요?", action: "더 찾는 일을 멈출 조건과 남은 후보에서 확인할 내용을 함께 정해 보세요." },
  Q10: { question: "후보가 다를 때 새로 찾거나 기존 후보를 살펴보고 싶은 이유는 각각 무엇인가요?", action: "새 후보를 찾을지, 기존 후보를 다시 볼지 각자 제안한 뒤 범위와 확인 시점을 함께 정해 보세요." },
  Q11: { question: "의견이 안 맞는 날 각자에게 필요한 시간과 다음 대화를 시작하기 편한 때는 언제인가요?", action: "바로 결정할 필요가 없는지 확인하고, 둘이 편한 다음 대화 시점을 함께 정해 보세요." },
  Q12: { question: "담당자가 후보를 찾을 때 중간에 함께 보거나 추린 뒤 보는 방식이 각자 편한 이유는 무엇인가요?", action: "담당 범위와 중간 확인 여부를 함께 정하고, 후보를 공유할 시점을 다시 확인해 보세요." },
  Q13: { question: "가족 이야기를 나눌 수 있다면, 준비 초기에 의견을 듣는 방식에서 각자 원하는 점은 무엇인가요?", action: "가족 이야기를 꺼내도 괜찮은지 먼저 묻고, 누구에게 무엇을 언제 물을지 둘이 동의한 범위로 정해 보세요." },
  Q14: { question: "둘의 초안을 정한 뒤 가족 의견을 듣는 시점에서 각자 원하는 점은 무엇인가요?", action: "초안을 어느 정도 정한 뒤 누구에게 어떤 의견을 물을지 둘이 확인하고, 확정 전 검토 시간을 함께 정해 보세요." },
  Q15: { question: "둘 다 괜찮은 식순에서 가족 선호를 반영해도 편한 범위는 각자 어디까지인가요?", action: "가족 선호를 참고할 조건과 다시 둘이 확인할 조건을 함께 정해 보세요." },
  Q16: { question: "가족과 원하는 식순이 다를 때 각자 중요하게 보는 기준과 대화 방식은 무엇인가요?", action: "누구의 의견을 들을지와 마지막 결정 절차를 함께 정하고, 전달할 말도 둘이 확인해 보세요." },
  Q17: { question: "속상한 날 각자에게 먼저 필요한 것은 들어주는 시간인가요, 함께 방법을 찾는 시간인가요?", action: "도움을 시작하기 전에 ‘이야기를 먼저 들어줄까, 방법을 같이 찾을까?’라고 서로 물어보기로 정해 보세요." },
  Q18: { question: "업체 연락이 버거울 때 대신 맡거나 같이 정리하는 도움에서 각자 원하는 범위는 무엇인가요?", action: "도움받는 사람이 원하는 연락 범위를 먼저 말하고, 맡을 사람도 가능한 범위를 확인한 뒤 함께 정해 보세요." },
  Q19: { question: "준비가 밀렸을 때 함께 하거나 일부를 대신 끝내는 도움에서 각자 편한 점은 무엇인가요?", action: "도움받는 방식과 맡을 수 있는 일을 각각 제안하고, 둘 다 괜찮은 작은 일부터 해보세요." },
  Q20: { question: "지친 뒤 처음 쉴 때 함께 있고 싶은 정도와 필요한 휴식 방식은 각자 어떤가요?", action: "처음 휴식을 함께 보낼지와 어떤 방식으로 쉴지 서로 물어보고, 둘 다 편한 시간을 정해 보세요." },
  Q21: { question: "지친 뒤 처음 쉴 때 혼자 있고 싶은 정도와 다시 이야기하기 편한 때는 각자 어떤가요?", action: "혼자 쉴 시간이 필요한지 서로 묻고, 다시 만나거나 이야기할 시점을 둘이 편한 방식으로 정해 보세요." },
};

/** 같은 문항·해석·표시 판의 같은 질문에 고른 실제 답만 나란히 둔다. */
export function comparePreferences21Responses(own: unknown, partner: unknown): Preferences21Comparison {
  if (!isPreferences21PlainObject(own) || !isPreferences21PlainObject(partner)
    || !hasPreferences21ExactKeys(own, ["versions", "answers"])
    || !hasPreferences21ExactKeys(partner, ["versions", "answers"])
    || !isPreferences21PlainObject(own.versions) || !isPreferences21PlainObject(partner.versions)
    || !hasPreferences21ExactKeys(own.versions, Object.keys(VERSIONS))
    || !hasPreferences21ExactKeys(partner.versions, Object.keys(VERSIONS))) {
    return { status: "invalid", notice: "두 사람의 답 형식을 확인하지 못했어요. 각자 받은 원래 링크에서 다시 확인해 주세요." };
  }
  if (!hasPreferences21Versions(own.versions) || !hasPreferences21Versions(partner.versions)) {
    return { status: "version-mismatch", notice: "문항·해석·표시 판이 달라 직접 비교하지 않아요. 같은 판에 각자 답한 뒤 비교해 주세요." };
  }
  const ownAnswers = parseAnswers(own.answers);
  const partnerAnswers = parseAnswers(partner.answers);
  if (!ownAnswers || !partnerAnswers) return { status: "invalid", notice: "문항에 연결된 실제 답을 확인하지 못해 비교하지 않았어요." };
  const rows = ITEMS21.map((item): Preferences21ComparisonRow => {
    const first = ownAnswers[item.id];
    const second = partnerAnswers[item.id];
    const numeric = typeof first === "number" && typeof second === "number";
    const conversation = CONVERSATIONS[item.id];
    return Object.freeze({
      itemId: item.id,
      statement: item.statement,
      context: TOPICS.find((topic) => topic.id === item.topicId)?.context ?? "",
      ownResponse: first,
      partnerResponse: second,
      ownLabel: preferences21ResponseLabel(first),
      partnerLabel: preferences21ResponseLabel(second),
      state: numeric ? first === second ? "same-answer" : "different-answers" : "needs-answer",
      question: numeric
        ? `${first === second ? "같은 답을 골랐어도 이유는 다를 수 있어요. " : "다른 답을 고른 이유부터 서로 물어보세요. "}${conversation.question}`
        : "이 질문을 지금 함께 이야기해도 괜찮을까요? 모름·비해당·답하지 않겠다는 선택을 먼저 존중해 주세요.",
      action: numeric
        ? conversation.action
        : "지금 설명하고 싶지 않다면 답을 요구하지 말고, 두 사람이 원할 때 다시 이야기해 보세요.",
    });
  });
  const numericRows = rows.filter((row) => row.state !== "needs-answer");
  return { status: "ready", rows: Object.freeze(rows), numericCompared: numericRows.length,
    sameNumeric: numericRows.filter((row) => row.state === "same-answer").length,
    differentNumeric: numericRows.filter((row) => row.state === "different-answers").length,
    notice: "각자가 고른 답을 비교한 대화 자료예요. 같은 답도 이유가 다를 수 있고, 다른 답도 함께 정할 수 있어요. 두 사람이 합의한 사실은 아직 아니에요." };
}
