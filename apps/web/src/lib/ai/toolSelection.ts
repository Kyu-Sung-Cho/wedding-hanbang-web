import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

const TOOL_GROUPS = {
  budget: ["get_budget_summary", "get_market_price"],
  schedule: ["get_schedule_summary", "get_schedule_events", "get_wedding_info"],
  general: ["get_wedding_info", "get_schedule_summary", "get_budget_summary"],
} as const;

const BUDGET_INTENT = /예산|비용|가격|금액|얼마|지출|절약|시세|budget|price|cost/i;
const SCHEDULE_INTENT = /일정|스케줄|체크리스트|할\s*일|진행|준비\s*상태|D-?day|언제|schedule|checklist/i;
const AMBIGUOUS_FOLLOW_UP = /^(?:그거|이거|저거|아까\s*거|좀\s*더|더|자세히|왜|어떻게)(?:\s|[?.!,]|$)/i;

export function selectAmoraToolsForTurn(
  availableTools: AiToolDefinition[],
  context: {
    userText: string;
    previousUserText?: string;
    hasDocumentAttachments?: boolean;
    hasImageAttachments?: boolean;
  },
): AiToolDefinition[] {
  const available = new Map(availableTools.map((tool) => [tool.name, tool]));
  const selectedNames: string[] = [];
  const addGroup = (group: readonly string[]) => {
    for (const name of group) {
      if (selectedNames.length >= 6) return;
      if (available.has(name) && !selectedNames.includes(name)) selectedNames.push(name);
    }
  };

  const currentText = context.userText.trim();
  const text = AMBIGUOUS_FOLLOW_UP.test(currentText) && context.previousUserText
    ? `${context.previousUserText}\n${currentText}`
    : currentText;
  if (BUDGET_INTENT.test(text)) {
    addGroup(TOOL_GROUPS.budget);
  }
  if (SCHEDULE_INTENT.test(text)) {
    addGroup(TOOL_GROUPS.schedule);
  }
  if (selectedNames.length === 0) addGroup(TOOL_GROUPS.general);

  return selectedNames
    .map((name) => available.get(name))
    .filter((tool): tool is AiToolDefinition => Boolean(tool));
}
