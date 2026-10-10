import { ITEMS21, TOPICS, VERSIONS, parseAnswers, responseLabel } from "./bank";
import type { ItemId } from "./types";

export const PREFERENCES21_AMORA_MAX_ITEMS = 5;
export type Preferences21AmoraDraft = Readonly<{
  text: string;
  itemIds: readonly ItemId[];
  versions: typeof VERSIONS;
  notice: string;
}>;

/** 사용자가 직접 고른 본인 답만 편집 가능한 미전송 문장으로 만든다. */
export function buildPreferences21AmoraDraft(ownAnswers: unknown, selectedItemIds: readonly ItemId[]): Preferences21AmoraDraft | null {
  const answers = parseAnswers(ownAnswers);
  if (!answers || !Array.isArray(selectedItemIds) || selectedItemIds.length === 0
    || selectedItemIds.length > PREFERENCES21_AMORA_MAX_ITEMS
    || new Set(selectedItemIds).size !== selectedItemIds.length) return null;
  const rows = selectedItemIds.map((id) => ITEMS21.find((item) => item.id === id));
  if (rows.some((item) => !item || item.topicId === "C" || typeof answers[item.id] !== "number")) return null;
  const lines = rows.flatMap((item) => {
    if (!item) return [];
    const context = TOPICS.find((topic) => topic.id === item.topicId)?.context ?? "";
    return [`${item.id}. ${item.statement}\n내 답: ${responseLabel(answers[item.id])}\n떠올린 상황: ${context}`];
  });
  return Object.freeze({
    text: [
      "결혼 준비 선호 21문항에서 내가 고른 아래 답을 참고해서, 지금 해볼 준비 방식 하나를 같이 생각해 주세요.",
      `출처: 웨딩코드 21문항 / 문항 ${VERSIONS.questionnaireVersion} / 해석 ${VERSIONS.interpretationVersion} / 표시 ${VERSIONS.displayVersion}`,
      ...lines,
      "이 답은 해당 상황에서 원하는 방식이에요. 성격이나 상대의 생각으로 단정하지 말고, 지금도 이 방식이 필요한지 먼저 물어봐 주세요. 예산·일정·할 일·결정 기록을 바꾸기 전에는 따로 확인해 주세요.",
    ].join("\n\n"),
    itemIds: Object.freeze([...selectedItemIds]),
    versions: VERSIONS,
    notice: "아직 아모라에 보내지 않은 초안이에요. 내용을 고친 뒤 본인이 대화에 붙여 넣고 보내면 해당 대화의 처리·저장 기준이 적용돼요.",
  });
}
