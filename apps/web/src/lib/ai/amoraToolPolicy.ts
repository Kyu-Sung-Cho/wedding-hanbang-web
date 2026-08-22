import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import type { SpecialistType } from "@/types/moat.types";

const BASE_READ_TOOLS = [
  "get_wedding_info",
  "get_budget_summary",
  "get_schedule_summary",
  "get_amora_actions",
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
  "cancel_schedule_event",
  "restore_schedule_event",
  "toggle_checklist_item",
] as const;
const VENDOR_READ_TOOLS = [
  "get_market_price",
] as const;
const CONTRACT_READ_TOOLS = [
  "analyze_contract_readiness",
  "analyze_quote",
  "get_market_price",
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
  "update_venue",
]);

const BUDGET_INTENT = /예산|비용|금액|가격|견적|시세|돈|식대|지출|썼|결제|배분|다시\s*(?:짜|나눠|나누)|budget|price|quote/i;
const SCHEDULE_INTENT = /일정|스케줄|날짜|예정일|결혼식|예식|본식|웨딩|체크리스트|할\s*일|준비\s*목록|촬영|투어|피팅|상담|미팅|schedule|date|task/i;
/** "3월 15일", "27년 9월 12일", "담주 금요일" 처럼 날짜만으로 말한 일정. */
const DATE_LIKE =
  /\d{1,2}\s*월\s*\d{1,2}\s*일|\d{2,4}\s*년\s*\d{1,2}\s*월|(?:이번|다음|담)\s*주\s*(?:월|화|수|목|금|토|일)?요?일?/;
const VENDOR_INTENT = /업체|웨딩홀|예식장|결혼식장|스튜디오|드레스|(?:혼주\s*)?메이크업|스드메|플래너|웨딩\s*(?:촬영|사진)|본식|결혼\s*준비|예약|vendor|venue|booking/i;
const CONTRACT_INTENT = /계약|계약서|약관|위약|환불|취소\s*수수료|contract|clause|refund/i;
const ACTION_INTENT = /기억|기록|메모|액션|챙겨|리마인드|remember|note|remind/i;
const BUDGET_CATEGORY_WORDS =
  /상견례|예식장|웨딩홀|스튜디오|드레스|턱시도|메이크업|스드메|예물|반지|한복|예단|신혼여행|혼수|신혼집|청첩장|스냅|영상|웨딩\s*구두|부케|꽃장식|답례품|사회|축가|폐백|예비비/;
const KNOWN_BUDGET_CATEGORY = new RegExp(BUDGET_CATEGORY_WORDS.source, "i");
const BUDGET_PLAN_WRITE = /(?:예산|비용).*(?:배분|플랜|계획|안).*(?:적용|저장|확정)|(?:배분|플랜|계획|안).*(?:적용|저장|확정).*(?:예산|비용)/i;
const CUSTOM_BUDGET_CATEGORY_WRITE = /(?:예산\s*)?(?:카테고리|항목).*(?:추가|등록)|(?:추가|등록).*(?:예산\s*)?(?:카테고리|항목)/i;
const CATEGORY_BUDGET_WRITE = /(?:예산|비용|금액|지출|썼|결제).*(?:변경|바꿔|수정|설정|저장|기록|썼|결제)|(?:변경|바꿔|수정|설정|저장|기록).*(?:예산|비용|금액|지출)/i;
const TOTAL_BUDGET_WRITE = /(?:총\s*)?(?:예산|비용).*(?:변경|바꿔|수정|설정|업데이트)|(?:변경|바꿔|수정|설정|업데이트).*(?:총\s*)?(?:예산|비용)/i;
const WEDDING_DATE_WRITE = /(?:결혼식|예식|웨딩).*(?:날짜|예정일).*(?:변경|바꿔|수정|설정|정했)|(?:결혼식|예식|웨딩).*(?:\d{4}[-./년]|\d{1,2}월\s*\d{1,2}일).*(?:이야|야|로\s*정했)/i;
const TASK_STATUS_WRITE = /(?:상견례|예식장|웨딩홀|스튜디오|드레스|메이크업|예물|한복|예단|신혼여행|혼수|신혼집|청첩장|스냅|답례품|폐백).*(?:완료|진행\s*중|시작\s*전)(?:했|으로|이야|야|$)/i;
const CHECKLIST_WRITE = /(?:체크리스트|할\s*일|준비\s*항목).*(?:완료|체크|해제|되돌)/i;
const SCHEDULE_UPDATE_WRITE = /(?:일정|스케줄).*(?:변경|바꿔|수정|옮겨|미뤄|당겨)/i;
const SCHEDULE_ADD_WRITE = /(?:일정|스케줄).*(?:추가|등록|저장|잡아)|(?:추가|등록|저장).*(?:일정|스케줄)/i;
const SCHEDULE_CANCEL_WRITE = /(?:일정|스케줄).*(?:취소|안\s*가|못\s*가)|(?:취소|안\s*가|못\s*가).*(?:일정|스케줄)/i;
const SCHEDULE_RESTORE_WRITE = /(?:취소(?:한|된)?\s*)?(?:일정|스케줄).*(?:복원|되돌|다시\s*(?:살려|잡아|예정))|(?:복원|되돌|다시\s*(?:살려|잡아|예정)).*(?:일정|스케줄)/i;
const SCHEDULE_RESTORE_SHORT_WRITE = /(?:(?:취소(?:한|했던|된)|취소해\s*둔).{0,50}(?:상견례|예식장|웨딩홀|드레스(?:\s*피팅)?|턱시도(?:\s*피팅)?|메이크업|스튜디오|본식|웨딩\s*촬영|청첩장|신혼여행)|(?:상견례|예식장|웨딩홀|드레스(?:\s*피팅)?|턱시도(?:\s*피팅)?|메이크업|스튜디오|본식|웨딩\s*촬영|청첩장|신혼여행).{0,50}취소(?:한|했던|된)?(?:\s*거)?).{0,50}(?:복원|되돌|다시\s*(?:살려|잡아|예정))/i;
const ACTION_ADD_WRITE = /기억해\s*줘|메모해\s*줘|챙겨\s*줘|리마인드.*(?:추가|등록|설정)|(?:다음\s*)?할\s*일.*(?:추가|등록|저장)/i;
const ACTION_UPDATE_WRITE = /(?:기억|메모|리마인드|할\s*일|액션).*(?:완료|끝냈|숨겨|삭제|지워|수정)/i;
const VENUE_WRITE = /(?:웨딩홀|예식장|식장|장소|venue).*(?:변경|바꿔|수정|설정|정했)/i;
// 한국어 금액은 "4천2백만원"·"1억5천만원"처럼 단위를 겹쳐 쓴다. 숫자 하나에
// 단위 하나만 받으면 결혼 예산에서 가장 흔한 표기를 통째로 놓친다
// (2026-07-25 실계정 E2E: "총예산 4천2백만원으로 바꿔줘"가 확정 발화로
//  인식되지 않아 아모라가 "예산을 수정할 수 없다"고 답했다).
// 조각은 정규식 리터럴로 두고 .source로 잇는다 — 문자열로 쓰면 "\d"가 그냥
// d로 죽어 조용히 오작동한다(이 수리 중 실제로 한 번 밟았다).
const KRW_AMOUNT = /(?:\d+(?:[.,]\d+)?\s*(?:억|천만|백만|십만|천|백|십|만)?\s*)+(?:억|천만|백만|십만|만)?\s*원/;
const MONEY_AMOUNT = new RegExp(KRW_AMOUNT.source, "i");
const NON_EXECUTABLE_DECLARATION = /(?:친구|지인|언니|오빠|누나|형|동생|남의|다른\s*사람).*(?:은|는|이|가)|(?:하면|한다면|했으면|일까|할까|어떨|어때|좋을까|괜찮을까|가정|예시|추천해|알려줘)|(?:아니야|아니다|취소|미정)/i;
const NON_EXECUTABLE_RESTORE = /(?:친구|지인|언니|오빠|누나|형|동생|남의|다른\s*사람).*(?:은|는|이|가)|(?:하면|한다면|했으면|일까|할까|어떨|어때|좋을까|괜찮을까|가정|예시|추천해|알려줘)|(?:아니야|아니다|미정)/i;
const DIRECT_TOTAL_BUDGET_DECLARATION = new RegExp(
  /(?:총\s*)?(?:예산|비용)(?:은|이|을|를)?\s*/.source
    + KRW_AMOUNT.source
    + /\s*(?:이야|야|으로\s*(?:정했어?|할게|바꿔줘?|변경해줘?)|이야요|이에요|예요)?/.source,
  "i",
);
const DIRECT_CATEGORY_BUDGET_DECLARATION = new RegExp(
  /(?:상견례|예식장|웨딩홀|스튜디오|드레스|턱시도|메이크업|예물|반지|한복|예단|신혼여행|혼수|신혼집|청첩장|스냅|영상|웨딩\s*구두|부케|꽃장식|답례품|사회|축가|폐백|예비비)(?:의|에|\s)*(?:(?:예산|비용|금액)(?:은|이|을|를)?\s*)?/.source
    + KRW_AMOUNT.source
    + /\s*(?:이야|야|이에요|예요|썼어|썼어요|결제했어|결제했어요|으로\s*(?:정했어?|할게))/.source,
  "i",
);
/**
 * "드레스에 300만원 잡아줘" 처럼 **부탁하는 어형**의 카테고리 예산 변경.
 *
 * `DIRECT_CATEGORY_BUDGET_DECLARATION` 은 이미 정한 것을 알리는 말
 * (`이야|썼어|결제했어|정했어`)만 알아본다. 실측(2026-08-22)에서 실제로 쓸 법한
 * 변경 요청 12개 중 7개가 도구 0개였고, 그중 넷이 이 어형이었다.
 *
 * 카테고리·금액·변경 동사가 **모두** 있을 때만 인정한다. 셋 중 하나라도 빠지면
 * 무엇을 얼마로 바꿀지 정해지지 않은 말이다.
 */
const CATEGORY_BUDGET_CHANGE_REQUEST = new RegExp(
  // 교대(A|B|C)를 그대로 이어 붙이면 `A` 또는 `B` 또는 `C…뒤에오는것` 으로 갈라져
  // **카테고리 한 단어만으로 매치된다.** 반드시 묶어서 잇는다.
  `(?:${BUDGET_CATEGORY_WORDS.source})`
    + /(?:의|에|는|은|을|를|\s)*(?:(?:예산|비용|금액)(?:은|이|을|를)?\s*)?/.source
    + KRW_AMOUNT.source
    + /\s*(?:정도|쯤)?\s*(?:으로|로)?\s*(?:더\s*)?(?:잡아|맞춰|맞추|늘려|줄여|올려|내려|낮춰|낮추|책정|배정|설정|정했)/.source,
  "i",
);

const DIRECT_WEDDING_DATE_DECLARATION = /(?:(?:내년|올해)\s*)?(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일(?:에|로)?\s*(?:결혼(?:식)?(?:해|해요|이야|이에요|예정이야|예정이에요)|(?:결혼식|예식)(?:으로\s*)?(?:정했어|정했어요))/i;
const DIRECT_SCHEDULE_DECLARATION = /(?:(?:이번|다음)\s*)?(?:월|화|수|목|금|토|일)요일(?:에)?\s*(?:상견례|예식장\s*(?:상담|투어)|웨딩홀\s*(?:상담|투어)|드레스\s*(?:투어|피팅)|스튜디오\s*(?:촬영|상담)|메이크업\s*(?:상담|테스트)|청첩장\s*모임)(?:이야|야|이에요|예요|가|해|해요)/i;
const DIRECT_TASK_STATUS_DECLARATION = /(?:상견례|예식장|웨딩홀|스튜디오|드레스|메이크업|예물|한복|예단|신혼여행|혼수|신혼집|청첩장|스냅|답례품|폐백).*(?:계약|예약|준비|주문)(?:했어|했어요|완료했어|완료했어요)/i;


/**
 * **값은 있지만 지금 사용자가 정한 것이 아닌 말.**
 *
 * 2026-08-22 코퍼스 220문장 실측에서 카드가 나오면 안 되는데 열린 것이 60건이었고,
 * 전부 아래 여섯 갈래였다. 값이 문장 안에 있어서 모델이 그대로 카드를 만들 수 있고,
 * 그러면 **사용자가 말하지도 않은 결정이 확인 카드로 올라온다.**
 *
 * `NON_EXECUTABLE_DECLARATION` 은 이 중 일부만 알아본다(친구·가정·추천).
 */

/** 남에게 들은 말. 뒤에 아모라에게 하는 부탁이 붙어 있으면 그건 요청이다. */
const HEARSAY_SOURCE =
  /(?:친구|지인|언니|오빠|누나|형|동생|동료|동기|선배|후배|사촌|이모|고모|삼촌|외삼촌|시누이|시댁|시어머니|시아버지|장모|장인|어머니|아버지|엄마|아빠|부모님|실장|플래너|블로그|카페|후기|커뮤니티|유튜브|기사|남의|다른\s*사람)|(?:예식장|웨딩홀|스튜디오|업체|샵)(?:에서|측에서|쪽에서)/;
const HEARSAY_ENDING =
  /(?:대|래|더라|던데|는데|다고\s*(?:하|해|들)|라고\s*(?:하|해|들))/;
/** 아모라에게 실제로 시키는 말. 이게 있으면 전언이어도 요청으로 본다. */
const REQUEST_TO_AMORA =
  /(?:줘|주세요|주실래|부탁(?:해|드려|합니다)|해\s*줄래)\s*[.!?]*\s*$|(?:줘|주세요)[,.!?]/;

/** 앞서 한 말을 무르는 것. 일정 자체를 취소하는 것과는 다르다. */
const RETRACTION =
  /(?:라고\s*한|한다고\s*한|말한|했던|얘기한|한\s*거)\s*(?:거|것)?\s*(?:취소|없던|무효|잊어|무르)|없던\s*(?:일|걸|것)\s*로|(?:아까|방금|앞서)\s*.{0,40}(?:취소|없던|아니야|아니었|잊어|무르)|안\s*(?:바꿨|했어|정했)|(?:바꾼|한)\s*적\s*없/;

/** 두 값 사이에서 아직 못 정한 말. */
const UNDECIDED_COMPARISON =
  /(?:할지|이랑|랑|또는|아니면)\s*.*(?:중에|중\s*(?:뭐|어느|무엇)|고민|나을까|나아|어느\s*쪽)|고민\s*(?:이야|중|돼|된다)|나을까|나은\s*가/;

/** "~하면 어떻게 될까" 류의 가정 질문. */
const HYPOTHETICAL_QUESTION =
  /(?:으면|면)\s*.{0,40}(?:까\?|까$|궁금|어떻게\s*(?:되|달라|나)|얼마(?:나|가)?\s*(?:되|나오|남)|\?)|다\s*치(?:면|고)|겠지\s*[.?!]*$/;

/** 지금이 아니라 나중에 하겠다는 말. */
const DEFERRED_INTENT =
  /(?:정해지면|나오면|끝나면|확정되면|알려주시면)\s*(?:그때|나중에|이따)|보류|(?:여쭤보고|물어보고|상의하고|생각해보고)\s*.{0,40}(?:결정|정할|할게)/;

/** 지난 값을 되돌아보는 말. */
const PAST_RECALL =
  /(?:작년|재작년|예전|원래|처음|그때는)\s*.{0,40}(?:였|었|았)/;

/** 본인이 아직 확정이 아니라고 못 박은 말. */
const EXPLICITLY_UNSETTLED =
  /아직\s*(?:확정|정하지|안\s*정|미정)|아직\s*.{0,20}(?:못\s*정|안\s*정)/;

/** 아모라가 아니라 업체·가족에게 보낼 말을 적은 것. */
const MESSAGE_TO_OTHERS =
  /(?:한테|에게|께)\s*(?:보낼|보내는|전할)|보낼게(?:요)?|(?:문자|메일|카톡|메시지)(?:야|예요|입니다|\s*보낼)/;

/** 아모라가 아니라 배우자에게 과거 합의를 확인하는 말. */
const SPOUSE_RECALL_CHECK = /(?:잖아|기억나|기억\s*하지)\s*[?？]?\s*$/;

/** 그 값을 쓰겠다는 게 아니라 **피하겠다**는 말. */
const AVOIDANCE = /(?:피하고\s*싶|피했으면|피하자|겹쳐|겹치)/;

/** 농담. 값이 진심이 아니다. */
const JOKING = /ㅋㅋ|ㅎㅎ|농담|장난이(?:야|고)/;

/**
 * **누구의 말인가** — 이 값은 사용자가 지금 낸 것이 아니다.
 *
 * 출처가 남이거나(전언), 이미 무른 말이거나, 농담이거나, 아모라가 아닌 사람에게
 * 하는 말이다. 이건 어떤 경우에도 카드가 되면 안 된다.
 */
function isNotOurDecision(userText: string): boolean {
  if (RETRACTION.test(userText)) return true;
  if (PAST_RECALL.test(userText)) return true;
  if (MESSAGE_TO_OTHERS.test(userText)) return true;
  if (JOKING.test(userText)) return true;
  if (SPOUSE_RECALL_CHECK.test(userText)) return true;
  if (AVOIDANCE.test(userText)) return true;
  // 전언은 부탁이 붙어 있지 않을 때만 막는다 — "부모님 지원금 3000만원
  // 들어왔어 반영해줘" 는 전언이 아니라 요청이다.
  return HEARSAY_SOURCE.test(userText)
    && HEARSAY_ENDING.test(userText)
    && !REQUEST_TO_AMORA.test(userText);
}

/**
 * **값이 아직 안 정해졌다** — 비교 중이거나, 가정이거나, 나중으로 미뤘다.
 *
 * 이건 위와 성격이 다르다. 서버가 이미 배분 전문 경로로 보낸 턴에서는
 * "예산 어떻게 나누면 좋을까?" 가 **바로 방아쇠**다 — 아모라가 배분안을 내고
 * 사용자가 확인하는 것이 설계된 흐름이다. 그래서 전문 경로에서는 이 갈래를
 * 적용하지 않는다(기존 테스트가 이 계약을 이미 고정하고 있었다).
 */
function isUnsettledValue(userText: string): boolean {
  return UNDECIDED_COMPARISON.test(userText)
    || HYPOTHETICAL_QUESTION.test(userText)
    || DEFERRED_INTENT.test(userText)
    || EXPLICITLY_UNSETTLED.test(userText);
}

/**
 * 금액 + 변경 동사만으로도 예산 변경 요청이다.
 *
 * "총얘산 5천만원으로 바꿔줘" 처럼 **낱말에 오타가 나면** 어휘 검사가 통째로
 * 놓친다. 어느 예산인지는 모델이 정하므로(둘 다 열린다) 여기서는 "돈을 얼마로
 * 바꿔 달라"는 모양만 본다.
 */
const AMOUNT_CHANGE_REQUEST = new RegExp(
  KRW_AMOUNT.source
    + /\s*(?:으로|로)\s*(?:다시\s*)?(?:바꿔|변경|수정|맞춰|맞추|올려|낮춰|낮추|줄여|늘려|정하|정할|확정|설정|해\s*줘|해줘|해\s*주세요)/.source,
  "i",
);

/** "스드메 500 잡아줘" 처럼 단위를 생략한 구어. 카테고리와 변경 동사가 함께 있을 때만. */
const CATEGORY_BARE_AMOUNT_REQUEST = new RegExp(
  `(?:${BUDGET_CATEGORY_WORDS.source})`
    + /(?:의|에|는|은|을|를|\s)*/.source
    + /\d{2,5}\s*(?:만)?\s*(?:으로|로|에)?\s*(?:다시\s*)?(?:잡아|맞춰|맞추|늘려|줄여|올려|내려|낮춰|낮추|책정|배정|설정)/.source,
  "i",
);

/**
 * 준비 항목의 상태를 바꾸는 말. "스튜디오 예약 완료로 바꿔줘", "반지 완료".
 * 기존 `DIRECT_TASK_STATUS_DECLARATION` 은 "계약했어/예약했어" 형태만 알아본다.
 */
const TASK_STATUS_CHANGE_REQUEST = new RegExp(
  /(?:완료|진행\s*중|시작\s*전|끝냈|끝났|다\s*했)/.source
    + /\s*(?:로|으로)?\s*(?:체크|바꿔|변경|표시|해\s*줘|해줘|해\s*주세요|부탁)/.source
    + '|'
    + `(?:${BUDGET_CATEGORY_WORDS.source})`
    + /\s*(?:완료|끝|해제)\s*$/.source,
  "i",
);

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
  // 남의 이야기와 가정에는 카드를 내지 않는다. `selectAmoraTools` 는 이 가드를
  // 쓰는데 제안 경로만 빠져 있어서, "친구는 드레스에 300만원 썼대" 에도 예산
  // 도구가 열렸다(2026-08-22 실측).
  //
  // `NON_EXECUTABLE_DECLARATION` 이 아니라 `_RESTORE` 를 쓴다 — 전자에는 `취소` 가
  // 들어 있어서 "본식 스냅은 취소하자" 같은 **정당한 취소 요청까지** 막는다.
  // (이 수리 중 실제로 7개였던 도구가 0개가 됐다.) 두 정규식의 차이가 정확히
  // 그 낱말 하나다.
  // 출처가 우리가 아닌 말은 어떤 경로에서도 카드가 되면 안 된다.
  if (isNotOurDecision(userText)) return [];
  // 값이 덜 정해진 말은 보통 카드를 안 내지만, 서버가 배분·일정 전문 경로로 보낸
  // 턴에서는 그것이 **정상이고 방아쇠**다. `NON_EXECUTABLE_RESTORE` 도 같은 성격이라
  // (`좋을까|어떨|추천해`) 함께 예외를 받는다 — 남 이야기 쪽은 위 가드가 이미 잡는다.
  const routedToPlanningSpecialist =
    specialistType === "budget_optimizer"
    || specialistType === "ceremony_coordinator";
  if (!routedToPlanningSpecialist) {
    if (NON_EXECUTABLE_RESTORE.test(userText)) return [];
    if (isUnsettledValue(userText)) return [];
  }
  // 제안 경로는 쓰기 권한이 아니라 "확인 카드를 낼 수 있는가"만 정한다(아래 주석 참고).
  // 좁게 잡으면 "내년 5월 20일에 결혼해"처럼 가장 자연스러운 확정 발화가
  // 저장으로 이어지지 못하므로, 확정형 선언 정규식도 함께 인정한다.
  if (
    BUDGET_INTENT.test(userText)
    || DIRECT_TOTAL_BUDGET_DECLARATION.test(userText)
    || DIRECT_CATEGORY_BUDGET_DECLARATION.test(userText)
    || CATEGORY_BUDGET_CHANGE_REQUEST.test(userText)
    || AMOUNT_CHANGE_REQUEST.test(userText)
    || CATEGORY_BARE_AMOUNT_REQUEST.test(userText)
    || specialistType === "budget_optimizer"
  ) {
    addAll(selected, BUDGET_WRITE_TOOLS);
  }
  if (
    SCHEDULE_INTENT.test(userText)
    || DATE_LIKE.test(userText)
    || DIRECT_WEDDING_DATE_DECLARATION.test(userText)
    || DIRECT_SCHEDULE_DECLARATION.test(userText)
    || DIRECT_TASK_STATUS_DECLARATION.test(userText)
    || TASK_STATUS_CHANGE_REQUEST.test(userText)
    || specialistType === "ceremony_coordinator"
  ) {
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
  if (
    !NON_EXECUTABLE_RESTORE.test(userText)
    && (
      SCHEDULE_RESTORE_WRITE.test(userText)
      || SCHEDULE_RESTORE_SHORT_WRITE.test(userText)
    )
  ) {
    addAll(selected, SCHEDULE_READ_TOOLS);
    selected.add("restore_schedule_event");
  } else if (SCHEDULE_CANCEL_WRITE.test(userText)) {
    selected.add("cancel_schedule_event");
  } else if (SCHEDULE_UPDATE_WRITE.test(userText)) {
    selected.add("update_schedule_event");
  }
  if (SCHEDULE_ADD_WRITE.test(userText)
    || (acceptsDirectDeclaration && DIRECT_SCHEDULE_DECLARATION.test(userText))) {
    selected.add("add_schedule_event");
  }
  if (ACTION_ADD_WRITE.test(userText)) selected.add("add_amora_action");
  if (ACTION_UPDATE_WRITE.test(userText)) selected.add("update_amora_action");
  if (VENUE_WRITE.test(userText)) selected.add("update_venue");

  return availableTools.filter((tool) => selected.has(tool.name));
}
