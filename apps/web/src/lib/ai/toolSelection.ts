import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

const TOOL_GROUPS = {
  contract: [
    "analyze_contract_readiness",
    "analyze_quote",
    "get_market_price",
    "simulate_guest_guarantee",
  ],
  vendor: [
    "search_vendors",
    "recommend_vendors",
    "get_vendor_detail",
    "get_market_price",
  ],
  booking: ["get_my_bookings", "get_vendor_detail"],
  budget: ["get_budget_summary", "get_market_price", "analyze_quote", "simulate_guest_guarantee"],
  schedule: ["get_schedule_summary", "get_schedule_events", "get_wedding_info", "get_amora_actions"],
  general: ["get_wedding_info", "get_schedule_summary", "get_budget_summary"],
} as const;

const CONTRACT_INTENT = /계약|약관|환불|위약|해지|추가금|견적|보증\s*인원|식대|원본|분쟁|서명|deposit|contract|refund/i;
const VENDOR_INTENT = /업체|스튜디오|드레스|메이크업|예식장|웨딩홀|한복|예물|신혼여행|vendor|shop|추천|찾아/i;
const BOOKING_INTENT = /예약|상담\s*요청|가능\s*시간|빈\s*시간|내\s*예약|booking|slot/i;
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
  const contractTurn = context.hasDocumentAttachments || CONTRACT_INTENT.test(text);

  if (contractTurn) addGroup(TOOL_GROUPS.contract);
  if (context.hasImageAttachments && !contractTurn) {
    addGroup(["analyze_quote", "get_market_price"]);
  }
  if (BOOKING_INTENT.test(text)) addGroup(TOOL_GROUPS.booking);
  if (VENDOR_INTENT.test(text)) addGroup(TOOL_GROUPS.vendor);
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
