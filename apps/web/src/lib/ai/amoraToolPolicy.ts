import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import type { SpecialistType } from "@/types/moat.types";

const BASE_READ_TOOLS = [
  "get_wedding_info",
  "get_budget_summary",
  "get_schedule_summary",
  "get_amora_actions",
  "get_my_bookings",
] as const;

const BUDGET_READ_TOOLS = [
  "get_budget_summary",
  "get_market_price",
  "simulate_guest_guarantee",
] as const;
const BUDGET_WRITE_TOOLS = [
  "update_budget",
  "update_category_budget",
  "apply_budget_plan",
  "add_custom_category",
] as const;
const SCHEDULE_READ_TOOLS = ["get_schedule_summary", "get_schedule_events"] as const;
const SCHEDULE_WRITE_TOOLS = [
  "update_wedding_date",
  "update_task_status",
  "add_schedule_event",
  "update_schedule_event",
  "toggle_checklist_item",
] as const;
const VENDOR_READ_TOOLS = [
  "search_vendors",
  "check_vendor_availability",
  "recommend_vendors",
  "get_vendor_detail",
  "get_available_slots",
  "get_my_bookings",
  "get_market_price",
] as const;
const CONTRACT_READ_TOOLS = [
  "analyze_contract_readiness",
  "analyze_quote",
  "get_market_price",
  "get_vendor_detail",
] as const;
const ACTION_READ_TOOLS = ["get_amora_actions"] as const;
const ACTION_WRITE_TOOLS = [
  "add_amora_action",
  "update_amora_action",
  "log_wedding_event",
] as const;

export const AMORA_TOOL_POLICY_NAMES: ReadonlySet<string> = new Set([
  ...BASE_READ_TOOLS,
  ...BUDGET_READ_TOOLS,
  ...BUDGET_WRITE_TOOLS,
  ...SCHEDULE_READ_TOOLS,
  ...SCHEDULE_WRITE_TOOLS,
  ...VENDOR_READ_TOOLS,
  ...CONTRACT_READ_TOOLS,
  ...ACTION_READ_TOOLS,
  ...ACTION_WRITE_TOOLS,
  "search_nearby_places",
  "update_venue",
]);

const BUDGET_INTENT = /예산|비용|금액|가격|견적|시세|돈|식대|지출|썼|결제|budget|price|quote/i;
const SCHEDULE_INTENT = /일정|스케줄|날짜|체크리스트|할\s*일|준비\s*목록|schedule|date|task/i;
const VENDOR_INTENT = /업체|웨딩홀|예식장|결혼식장|스튜디오|드레스|(?:혼주\s*)?메이크업|스드메|플래너|웨딩\s*(?:촬영|사진)|본식|결혼\s*준비|예약|vendor|venue|booking/i;
const CONTRACT_INTENT = /계약|계약서|약관|위약|환불|취소\s*수수료|contract|clause|refund/i;
const ACTION_INTENT = /기억|기록|메모|액션|챙겨|리마인드|remember|note|remind/i;
const NEARBY_INTENT = /근처|주변|가까운|인근|nearby/i;
const KNOWN_BUDGET_CATEGORY = /상견례|예식장|웨딩홀|스튜디오|드레스|턱시도|메이크업|예물|반지|한복|예단|신혼여행|혼수|신혼집|청첩장|스냅|영상|웨딩\s*구두|부케|꽃장식|답례품|사회|축가|폐백|예비비/i;
const BUDGET_PLAN_WRITE = /(?:예산|비용).*(?:배분|플랜|계획|안).*(?:적용|저장|확정)|(?:배분|플랜|계획|안).*(?:적용|저장|확정).*(?:예산|비용)/i;
const CUSTOM_BUDGET_CATEGORY_WRITE = /(?:예산\s*)?(?:카테고리|항목).*(?:추가|등록)|(?:추가|등록).*(?:예산\s*)?(?:카테고리|항목)/i;
const CATEGORY_BUDGET_WRITE = /(?:예산|비용|금액|지출|썼|결제).*(?:변경|바꿔|수정|설정|저장|기록|썼|결제)|(?:변경|바꿔|수정|설정|저장|기록).*(?:예산|비용|금액|지출)/i;
const TOTAL_BUDGET_WRITE = /(?:총\s*)?(?:예산|비용).*(?:변경|바꿔|수정|설정|업데이트)|(?:변경|바꿔|수정|설정|업데이트).*(?:총\s*)?(?:예산|비용)/i;
const WEDDING_DATE_WRITE = /(?:결혼식|예식|웨딩).*(?:날짜|예정일).*(?:변경|바꿔|수정|설정|정했)|(?:결혼식|예식|웨딩).*(?:\d{4}[-./년]|\d{1,2}월\s*\d{1,2}일).*(?:이야|야|로\s*정했)/i;
const TASK_STATUS_WRITE = /(?:상견례|예식장|웨딩홀|스튜디오|드레스|메이크업|예물|한복|예단|신혼여행|혼수|신혼집|청첩장|스냅|답례품|폐백).*(?:완료|진행\s*중|시작\s*전)(?:했|으로|이야|야|$)/i;
const CHECKLIST_WRITE = /(?:체크리스트|할\s*일|준비\s*항목).*(?:완료|체크|해제|되돌)/i;
const SCHEDULE_UPDATE_WRITE = /(?:일정|스케줄).*(?:변경|바꿔|수정|옮겨|미뤄|당겨)/i;
const SCHEDULE_ADD_WRITE = /(?:일정|스케줄).*(?:추가|등록|저장|잡아)|(?:추가|등록|저장).*(?:일정|스케줄)/i;
const ACTION_ADD_WRITE = /기억해\s*줘|메모해\s*줘|챙겨\s*줘|리마인드.*(?:추가|등록|설정)|(?:다음\s*)?할\s*일.*(?:추가|등록|저장)/i;
const ACTION_UPDATE_WRITE = /(?:기억|메모|리마인드|할\s*일|액션).*(?:완료|끝냈|숨겨|삭제|지워|수정)/i;
const VENUE_WRITE = /(?:웨딩홀|예식장|식장|장소|venue).*(?:변경|바꿔|수정|설정|정했)/i;
const MONEY_AMOUNT = /\d+(?:[.,]\d+)?\s*(?:억|천만|백만|십만|만)?\s*원/i;
const NON_EXECUTABLE_DECLARATION = /(?:친구|지인|언니|오빠|누나|형|동생|남의|다른\s*사람).*(?:은|는|이|가)|(?:하면|한다면|했으면|일까|할까|어떨|어때|좋을까|괜찮을까|가정|예시|추천해|알려줘)|(?:아니야|아니다|취소|미정)/i;
const DIRECT_TOTAL_BUDGET_DECLARATION = /(?:총\s*)?(?:예산|비용)(?:은|이|을|를)?\s*\d+(?:[.,]\d+)?\s*(?:억|천만|백만|십만|만)?\s*원(?:이야|야|으로\s*(?:정했어?|할게)|이야요|이에요|예요)?/i;
const DIRECT_CATEGORY_BUDGET_DECLARATION = /(?:상견례|예식장|웨딩홀|스튜디오|드레스|턱시도|메이크업|예물|반지|한복|예단|신혼여행|혼수|신혼집|청첩장|스냅|영상|웨딩\s*구두|부케|꽃장식|답례품|사회|축가|폐백|예비비)(?:의|에|\s)*(?:(?:예산|비용|금액)(?:은|이|을|를)?\s*)?\d+(?:[.,]\d+)?\s*(?:억|천만|백만|십만|만)?\s*원\s*(?:이야|야|이에요|예요|썼어|썼어요|결제했어|결제했어요|으로\s*(?:정했어?|할게))/i;
const DIRECT_WEDDING_DATE_DECLARATION = /(?:(?:내년|올해)\s*)?(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일(?:에|로)?\s*(?:결혼(?:식)?(?:해|해요|이야|이에요|예정이야|예정이에요)|(?:결혼식|예식)(?:으로\s*)?(?:정했어|정했어요))/i;
const DIRECT_SCHEDULE_DECLARATION = /(?:(?:이번|다음)\s*)?(?:월|화|수|목|금|토|일)요일(?:에)?\s*(?:상견례|예식장\s*(?:상담|투어)|웨딩홀\s*(?:상담|투어)|드레스\s*(?:투어|피팅)|스튜디오\s*(?:촬영|상담)|메이크업\s*(?:상담|테스트)|청첩장\s*모임)(?:이야|야|이에요|예요|가|해|해요)/i;
const DIRECT_TASK_STATUS_DECLARATION = /(?:상견례|예식장|웨딩홀|스튜디오|드레스|메이크업|예물|한복|예단|신혼여행|혼수|신혼집|청첩장|스냅|답례품|폐백).*(?:계약|예약|준비|주문)(?:했어|했어요|완료했어|완료했어요)/i;

export interface AmoraToolRoutingMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SelectAmoraToolsInput {
  availableTools: readonly AiToolDefinition[];
  userText: string;
  specialistType: SpecialistType;
  attachmentKind?: "none" | "image" | "document";
  /** 직전 대화만 전달. 구현이 마지막 2개/각 600자로 다시 제한한다. */
  routingContext?: readonly AmoraToolRoutingMessage[];
}

function addAll(target: Set<string>, names: readonly string[]): void {
  for (const name of names) target.add(name);
}

/**
 * Narrows server-issued, confirmation-required proposals by conversation
 * domain. Unlike selectAmoraTools this never authorizes a write; it only
 * limits which validated proposal marker the assistant may offer.
 */
export function selectAmoraPendingProposalTools({
  availableTools,
  userText,
  specialistType,
}: SelectAmoraToolsInput): AiToolDefinition[] {
  const selected = new Set<string>();
  if (BUDGET_INTENT.test(userText) || specialistType === "budget_optimizer") {
    addAll(selected, BUDGET_WRITE_TOOLS);
  }
  if (SCHEDULE_INTENT.test(userText) || specialistType === "ceremony_coordinator") {
    addAll(selected, SCHEDULE_WRITE_TOOLS);
  }
  if (/(?:웨딩홀|예식장|식장|장소|venue)/i.test(userText)) {
    selected.add("update_venue");
  }
  if (ACTION_INTENT.test(userText)) addAll(selected, ACTION_WRITE_TOOLS);
  return availableTools.filter((tool) => selected.has(tool.name));
}

/**
 * Deterministically narrows the provider-visible tools while preserving the
 * canonical availableTools order (stable prompts/cache). It can only remove
 * tools; beta-disabled destructive tools are never introduced by this policy.
 */
export function selectAmoraTools({
  availableTools,
  userText,
  specialistType,
  attachmentKind = "none",
}: SelectAmoraToolsInput): AiToolDefinition[] {
  const selected = new Set<string>();
  const acceptsDirectDeclaration = !NON_EXECUTABLE_DECLARATION.test(userText);
  addAll(selected, BASE_READ_TOOLS);

  const hasBudgetIntent = BUDGET_INTENT.test(userText)
    || specialistType === "budget_optimizer";
  const hasScheduleIntent = SCHEDULE_INTENT.test(userText)
    || specialistType === "ceremony_coordinator";
  const hasVendorIntent = VENDOR_INTENT.test(userText);
  const hasContractIntent = CONTRACT_INTENT.test(userText)
    || specialistType === "contract_reviewer"
    || attachmentKind === "document";
  const hasActionIntent = ACTION_INTENT.test(userText);
  if (hasBudgetIntent) addAll(selected, BUDGET_READ_TOOLS);
  if (hasScheduleIntent) addAll(selected, SCHEDULE_READ_TOOLS);
  if (hasVendorIntent) addAll(selected, VENDOR_READ_TOOLS);
  if (hasContractIntent) addAll(selected, CONTRACT_READ_TOOLS);
  if (hasActionIntent) addAll(selected, ACTION_READ_TOOLS);
  if (NEARBY_INTENT.test(userText) && !hasVendorIntent) {
    selected.add("search_nearby_places");
  }

  // Each mutation family requires current-turn, domain-specific language.
  // Assistant prose and generic approvals are never authority to write.
  if (BUDGET_INTENT.test(userText)) {
    if (BUDGET_PLAN_WRITE.test(userText)) selected.add("apply_budget_plan");
    else if (CUSTOM_BUDGET_CATEGORY_WRITE.test(userText)) selected.add("add_custom_category");
    else if (KNOWN_BUDGET_CATEGORY.test(userText) && (
      CATEGORY_BUDGET_WRITE.test(userText)
      || (acceptsDirectDeclaration
        && MONEY_AMOUNT.test(userText)
        && DIRECT_CATEGORY_BUDGET_DECLARATION.test(userText))
    )) {
      selected.add("update_category_budget");
    } else if (TOTAL_BUDGET_WRITE.test(userText)
      || (acceptsDirectDeclaration && DIRECT_TOTAL_BUDGET_DECLARATION.test(userText))) {
      selected.add("update_budget");
    }
  }
  if (WEDDING_DATE_WRITE.test(userText)
    || (acceptsDirectDeclaration && DIRECT_WEDDING_DATE_DECLARATION.test(userText))) {
    selected.add("update_wedding_date");
  }
  if (TASK_STATUS_WRITE.test(userText)
    || (acceptsDirectDeclaration && DIRECT_TASK_STATUS_DECLARATION.test(userText))) {
    selected.add("update_task_status");
  }
  if (CHECKLIST_WRITE.test(userText)) selected.add("toggle_checklist_item");
  if (SCHEDULE_UPDATE_WRITE.test(userText)) selected.add("update_schedule_event");
  if (SCHEDULE_ADD_WRITE.test(userText)
    || (acceptsDirectDeclaration && DIRECT_SCHEDULE_DECLARATION.test(userText))) {
    selected.add("add_schedule_event");
  }
  if (ACTION_ADD_WRITE.test(userText)) selected.add("add_amora_action");
  if (ACTION_UPDATE_WRITE.test(userText)) selected.add("update_amora_action");
  if (VENUE_WRITE.test(userText)) selected.add("update_venue");

  return availableTools.filter((tool) => selected.has(tool.name));
}
