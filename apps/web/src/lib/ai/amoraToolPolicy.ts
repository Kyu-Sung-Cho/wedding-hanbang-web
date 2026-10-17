import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import type { SpecialistType } from "@/types/moat.types";
import { hasAmoraSharedTaskProposalRequest } from "./amoraSharedTaskIntent";
import { isMutatingTool } from "./mutationTools";
import { assessMarketPriceRequestScope } from "./marketPriceRequestScope";

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
// 계약 개입 금지(2026-08-18) 이후 남은 것은 "받은 견적서를 같이 본다"뿐이다.
// 계약서 해석·위험 판정은 제거했고, 견적 확인은 판정 없이 확인 질문만 만든다.
const DOCUMENT_ATTACHMENT_READ_TOOLS = [
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
  ...DOCUMENT_ATTACHMENT_READ_TOOLS,
  ...ACTION_READ_TOOLS,
  ...ACTION_WRITE_TOOLS,
  "update_venue",
]);

// `대관료` 가 빠져 있었다. 운영 발화 `대관료는 보통 얼마야?` 는 범위는 W0 인데
// 이 어휘에 안 걸려 **시세 조회 도구가 안 붙었다** — 도구가 있는데 한 번도
// 안 쓰이는 자리다. `얼마` 도 함께 넣는다: 이 목록은 범위 판정이 아니라
// **도구 선택**이라 틀려도 읽기 도구 하나가 더 붙을 뿐이고, 범위 관문이
// 이미 앞에서 결혼 대화인지 가른 뒤다.
// 2026-09-04: `보증 인원`·`하객`·`노쇼` 가 없어 이 제품이 직접 만든 계산기
// (`simulate_guest_guarantee`)가 그 주제의 핵심 낱말로는 한 번도 안 열렸다. 위와 같은
// 성격의 목록이라 틀려도 읽기 도구 하나가 더 붙을 뿐이다.
// 2026-09-04: "1인당 밥값이 6만원이면 비싼 거야?" 에 시세 도구가 안 붙었다(`식대` 만 알았다).
const BUDGET_INTENT = /예산|비용|금액|가격|견적|시세|돈|식대|밥값|식사비|식비|1인당|인당|대관료|지출|썼|결제|배분|얼마|보증\s*인원|하객|노쇼|다시\s*(?:짜|나눠|나누)|budget|price|quote/i;
const SCHEDULE_INTENT = /일정|스케줄|날짜|예정일|결혼식|예식|본식|웨딩|체크리스트|할\s*일|준비\s*목록|촬영|투어|피팅|상담|미팅|schedule|date|task/i;
/** "3월 15일", "27년 9월 12일", "담주 금요일" 처럼 날짜만으로 말한 일정. */
const DATE_LIKE =
  /\d{1,2}\s*월\s*\d{1,2}\s*일|\d{2,4}\s*년\s*\d{1,2}\s*월|(?:이번|다음|담)\s*주\s*(?:월|화|수|목|금|토|일)?요?일?/;
const VENDOR_INTENT = /업체|웨딩홀|예식장|결혼식장|식장|스튜디오|드레스|(?:혼주\s*)?메이크업|스드메|플래너|웨딩\s*(?:촬영|사진)|본식|결혼\s*준비|예약|대관|vendor|venue|booking/i;
/**
 * 견적을 봐 달라는 말.
 *
 * `analyze_quote` 는 `CONTRACT_READ_TOOLS` 안에 있었고 그 묶음은 `CONTRACT_INTENT` 로만
 * 열렸는데, 거기에 "견적"이 없었다. "견적"은 `BUDGET_INTENT` 에 있어서 예산 도구만
 * 열렸다. 그래서 **"스드메 290 견적 받았는데 봐줘"로는 견적 체크가 채팅에서 안 열렸다** —
 * 프롬프트가 "핵심 기능"이라 부르는 것인데도.
 *
 * `CONTRACT_INTENT` 를 넓히지 않는다. 넓히면 계약 판정 도구까지 함께 열리는데, 아모라의
 * 계약 해석은 2026-08-18 파운더 결정으로 걷어낸 방향이다. 견적 하나만 여는 좁은 문을 낸다.
 *
 * 고위험 판정과 겹치지 않는 것도 확인했다 — `amoraQuestionScope.ts` 의
 * `HIGH_RISK_DOMAIN_PATTERN` 은 `계약서.{0,16}(봐|검토|…)` 를 잡지만 "견적"은 안 잡는다.
 * 계약 어휘로 열었다면 그 판정이 먼저 떨어져 도구가 **빈 배열**이 됐을 것이다.
 */
const QUOTE_INTENT = /견적|estimate|quotation/i;
// `할 일` 이 빠져 있었다 — 가장 자연스러운 한국어 표현인데.
//
// 2026-08-25 운영 실측: "결혼식장 계약서 확인하는 걸 다음 할 일로 추가해줘" 에
// 행동 카드 도구가 하나도 안 열려서, 아모라가 일정 도구로 카드를 내거나
// "앱의 할 일 추가에서 직접 입력해 주세요" 라고 답했다. 설계된 기능이 가장
// 흔한 말로는 닿지 않았다.
//
// 같은 파일의 `ACTION_ADD_WRITE` 에는 이미 들어 있다 — 두 선택기가 갈려 있었다.
const ACTION_INTENT = /기억|기록|메모|액션|챙겨|리마인드|할\s*일|투두|remember|note|remind|to-?do/i;
const BUDGET_CATEGORY_WORDS =
  /상견례|예식장|웨딩홀|스튜디오|드레스|턱시도|메이크업|스드메|예물|반지|한복|예단|신혼여행|혼수|신혼집|청첩장|스냅|영상|웨딩\s*구두|부케|꽃장식|답례품|사회|축가|폐백|예비비/;
const KNOWN_BUDGET_CATEGORY = new RegExp(BUDGET_CATEGORY_WORDS.source, "i");
// 2026-09-04 22턴 회상 실측: "앞에서 만든 3500만원 배분표 그대로 실제 예산에 반영해줘" 는
// 배분→예산→반영 순서고 동사가 `반영` 이라 이 목록에 없었다 — 팀원 8/24 대본 그대로다.
const BUDGET_PLAN_WRITE = /(?:예산|비용).*(?:배분|플랜|계획|안).*(?:반영|적용|저장|확정)|(?:배분|플랜|계획|안).*(?:반영|적용|저장|확정).*(?:예산|비용)|(?:배분|플랜|계획|안).*(?:예산|비용).*(?:반영|적용|저장|확정)/i;
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
const ACTION_ADD_WRITE = /기억해\s*줘|메모해\s*줘|챙겨\s*줘|리마인드.*(?:추가|등록|설정)|(?:다음\s*)?할\s*일.*(?:추가|등록|저장|넣어)/i;
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
const NON_EXECUTABLE_DECLARATION = /(?:친구|지인|언니|오빠|누나|형|동생|남의|다른\s*사람).*(?:은|는|이|가)|(?:하면|한다면|했으면|일까(?!지)|할까|어떨|어때|좋을까|괜찮을까|가정|예시|추천해|알려줘)|(?:아니야|아니다|취소|미정)/i;
const NON_EXECUTABLE_RESTORE = /(?:친구|지인|언니|오빠|누나|형|동생|남의|다른\s*사람).*(?:은|는|이|가)|(?:하면|한다면|했으면|일까(?!지)|할까|어떨|어때|좋을까|괜찮을까|가정|예시|추천해|알려줘)|(?:아니야|아니다|미정)/i;
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
/**
 * 남에게 들은 말임을 드러내는 **어미**. 절 끝에 와야 한다.
 *
 * ## 왜 이 모양인가 (2026-08-26)
 *
 * 예전에는 `대|래` 가 경계 없는 한 글자였다. 그래서 **`대표님`·`대관료`·`대기실`
 * 안에서도 걸렸다.** 파운더가 라이브에서 이렇게 말했는데:
 *
 *     "내가 소네 스튜디오에서 9월 5일날 11시에 촬영하기로 했어 …
 *      대표님이 해주시는거야"
 *
 * `스튜디오에서` 가 HEARSAY_SOURCE 에, **`대표님` 의 첫 글자 `대`** 가 여기 걸려
 * 자기 결정이 전언으로 분류됐다. 그러면 제안 도구가 0개가 되고 카드 계약문이
 * 프롬프트에 아예 안 실려 **아모라는 저장을 제안할 방법 자체가 없다.** 절단 실험:
 * `대표님`→`사장님` 이면 도구 11개, `스튜디오에서`→`스튜디오의` 여도 11개.
 *
 * 운영 장부 실측(본문은 꺼내지 않고 SQL 안에서만 셌다): 사용자 메시지 740건 중
 * 이 가드에 막힌 것이 11건인데,
 *
 *     진짜 전언 표지(더라·던데·다고 하)가 있는 것   1건
 *     `대` 가 단어 안에서만 걸린 것                 4건
 *     `는데` 로 걸린 것                             5건
 *
 * `는데` 는 전언 표지가 아니라 그냥 연결어미다("계약금 넣었는데"). 전언으로 쓰일
 * 때는 앞에 인용이 붙으므로 `다는데`·`라는데` 만 남긴다.
 *
 * ## 좁히면서 무엇을 지켰나
 *
 * 이 가드가 막는 것은 "친구가 5천이래" 를 우리 결정으로 저장하는 일이다. 그건
 * 그대로 막힌다 — `~대`·`~래` 는 절 끝에 오는 어미라 경계를 요구해도 다 잡힌다
 * (`했대`, `한대`, `6300만원이래`, `알려주신대.`). `amoraChangeRequestCorpus`
 * 의 NO_OFFER 목록이 그 계약을 고정하고 있다.
 */
const HEARSAY_ENDING =
  /(?:대|래)(?:요)?(?=[\s.,!?~…)"'\]」』]|$)|(?:더라|던데|다는데|라는데|다고\s*(?:하|해|들)|라고\s*(?:하|해|들))/;
/** 아모라에게 실제로 시키는 말. 이게 있으면 전언이어도 요청으로 본다. */
const REQUEST_TO_AMORA =
  /(?:줘|주세요|주실래|부탁(?:해|드려|합니다)|해\s*줄래)\s*[.!?]*\s*$|(?:줘|주세요)[,.!?]/;
/**
 * 웃음·회상 예외가 보는 부탁 어미 — `REQUEST_TO_AMORA` 의 상위집합.
 *
 * 2026-09-14 2차 감사: "잡아줘~ ㅎㅎ"·"잡아줘요 ㅎㅎ"·"잡아줄래? ㅎㅎ"·"올려줘~" 가
 * 전부 제안 도구 0개였다(웃음만 떼면 4개). `줘` 뒤의 `~`·`요`·`ㄹ래` 를 위 정규식이
 * 못 본다. 전언 갈래는 그대로 `REQUEST_TO_AMORA` 를 쓴다 — 그 계약은
 * `ownDecisionIsNotHearsay` 와 `amoraChangeRequestCorpus` 의 NO_OFFER 가 고정하고
 * 있어 여기서 같이 넓히지 않는다.
 */
const REQUEST_TO_AMORA_RELAXED =
  /(?:줘|주세요|주실래|줄래|부탁(?:해|드려|합니다|드립니다))(?:요)?\s*[~.!?]*\s*$|(?:줘|주세요|줄래)(?:요)?[~,.!?]/;
/**
 * 회상을 푸는 부탁 — 문장 끝의 **변경 동사 + 부탁 어미**.
 *
 * 부탁 어미만 보면 "작년에 예식장 알아봤었는데 그때 견적 다시 보여줘" 도 회상이
 * 풀려 제안 도구 12개가 열린다(2026-09-14 2차 감사, 1차 수정 전엔 0개). 옛 값을
 * 떠올리며 **읽어** 달라는 말(보여줘·알려줘·확인해줘)은 회상이다. 바꿔 달라는
 * 동사가 부탁 어미 바로 앞에 올 때만 요청으로 본다 — "6천으로 올려줘"·"10월 17일로
 * 변경해줘"·"300만원으로 잡아 주세요"·"6천으로 해줘"·"변경 부탁해".
 * `isExplicitAmoraChangeRequest` 처럼 문장 아무 데서나 변경 동사를 찾으면 회상절의
 * "취소했었는데" 가 요청으로 읽히므로 어미에 붙여서만 본다. `정해` 는 `결정해`·
 * `인정해` 안에서 걸리지 않게 앞에 한글이 없을 때만, `로 해줘` 는 `대로 해줘`
 * ("원래 계획대로 해줘" 는 값이 없다)를 빼고 본다.
 */
const CHANGE_REQUEST_TO_AMORA =
  /(?:올려|내려|바꿔|잡아|넣어|옮겨|미뤄|당겨|줄여|늘려|맞춰|고쳐|지워|빼|살려|짜|나눠|(?<![가-힣])정해|(?<!대)(?:으로|로)\s*(?:다시\s*)?해|(?:등록|추가|수정|반영|변경|취소|삭제|설정|저장|적용|복원|확정|결정|기록|배분|처리|체크)\s*해)\s*(?:줘|주세요|주실래|줄래)(?:요)?(?:\s*[~.!?]*\s*$|[~,.!?])|(?:등록|추가|수정|반영|변경|취소|삭제|설정|저장|적용|복원|확정|결정|기록|배분|처리|체크)\s*(?:좀\s*)?부탁(?:해|드려|합니다|드립니다)(?:요)?\s*[~.!?]*\s*$/;

/** 앞서 한 **말**을 무르는 것. 일정 자체를 취소하는 것과는 다르다. */
//
// `(?:아까|방금|앞서)\s*.{0,40}(?:취소|...)` 처럼 넓게 두면 이미 저장된
// 일정을 가리키는 말까지 삼킨다(2026-08-24 감사):
//
//   "방금 추가한 드레스 투어 일정 취소해줘"     → 확인 카드 0개
//   "아까 취소한 드레스 투어 일정 다시 살려줘"  → 확인 카드 0개
//
// 베타 첫 주에 가장 많이 밟는 '방금 한 걸 되돌리기' 경로가 통째로 막혔다.
// 그래서 그 갈래는 **말**을 가리킬 때만 잡는다(말한·얘기한·한 말·라고 한).
const RETRACTION =
  /(?:라고\s*한|한다고\s*한|말한|했던|얘기한|한\s*거)\s*(?:거|것)?\s*(?:취소|없던|무효|잊어|무르)|없던\s*(?:일|걸|것)\s*로|(?:아까|방금|앞서)\s*(?:말한|얘기한|한\s*말|라고\s*한).{0,40}(?:취소|없던|아니야|아니었|잊어|무르)|안\s*(?:바꿨|했어|정했)|(?:바꾼|한)\s*적\s*없/;

/** 두 값 사이에서 아직 못 정한 말. */
const UNDECIDED_COMPARISON =
  /(?:할지|이랑|랑|또는|아니면)\s*.*(?:중에|중\s*(?:뭐|어느|무엇)|고민|나을까|나아|어느\s*쪽)|고민\s*(?:이야|중|돼|된다)|나을까|나은\s*가/;

/** "~하면 어떻게 될까" 류의 가정 질문. */
const HYPOTHETICAL_QUESTION =
  /(?:으면|면)\s*.{0,40}(?:까\?|까$|궁금|어떻게\s*(?:되|달라|나)|얼마(?:나|가)?\s*(?:되|나오|남)|\?)|다\s*치(?:면|고)|겠지\s*[.?!]*$/;

/** 지금이 아니라 나중에 하겠다는 말. */
const DEFERRED_INTENT =
  /(?:정해지면|나오면|끝나면|확정되면|알려주시면)\s*(?:그때|나중에|이따)|보류|(?:여쭤보고|물어보고|상의하고|생각해보고)\s*.{0,40}(?:결정|정할|할게)/;

/**
 * 지난 값을 되돌아보는 말. 뒤에 아모라에게 **바꿔** 달라는 부탁(`CHANGE_REQUEST_TO_AMORA`)
 * 이 붙어 있으면 그건 요청이다. 읽어 달라는 부탁은 회상을 풀지 않는다.
 */
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
//
// `겹쳐|겹치` 는 여기 있으면 안 된다. 일정이 겹치는 것은 **바꾸려는 이유**지
// 값을 피하려는 말이 아니다. 그것 때문에 결혼 준비에서 일정을 옮기는 가장 흔한
// 문장이 통째로 막혔다(2026-08-24 감사):
//
//   "3월 15일에 스튜디오 촬영이랑 드레스 투어가 겹쳐서 드레스 투어를
//    3월 22일로 옮겨줘"  → 확인 카드 0개
//
// 같은 문장에서 "겹쳐서" 만 빼면 카드가 정상으로 나왔다. 겹침을 이유로
// **피하겠다**는 말은 `피하고 싶|피했으면|피하자` 가 그대로 잡는다.
const AVOIDANCE = /(?:피하고\s*싶|피했으면|피하자)/;

/** 농담. 값이 진심이 아니다. */
const JOKING = /농담|장난이(?:야|고)/;
/**
 * 웃음 표기. 2026-09-14 운영 실측: "드레스 300만원으로 잡아줘 ㅎㅎ" 가 `JOKING`
 * (당시 `ㅋㅋ|ㅎㅎ` 포함)에 걸려 제안 도구가 0개였고, 아모라는 "반영되지 않았다"고
 * 답했다. ㅋㅋ·ㅎㅎ 는 한국어 채팅에서 어조를 누그러뜨리는 말이지 무르는 말이
 * 아니다 — 아모라에게 시키는 말(`REQUEST_TO_AMORA_RELAXED`)이 없을 때만 농담으로 본다.
 * 부탁 어미 뒤에 붙은 웃음은 걷어내고 본다("잡아줘 ㅎㅎ"·"잡아줘~ ㅎㅎ" 도 부탁이다).
 * `amoraChangeRequestCorpus` 의 "총예산 1억으로 올려서 하와이에서 하자" 류는
 * 부탁이 없어 그대로 막힌다.
 */
const LAUGH = /ㅋㅋ|ㅎㅎ/;
const LAUGH_MARKS = /[ㅋㅎ]+/g;

/**
 * **누구의 말인가** — 이 값은 사용자가 지금 낸 것이 아니다.
 *
 * 출처가 남이거나(전언), 이미 무른 말이거나, 농담이거나, 아모라가 아닌 사람에게
 * 하는 말이다. 이건 어떤 경우에도 카드가 되면 안 된다.
 */
function isNotOurDecision(userText: string): boolean {
  // 웃음 표기를 걷어낸 뒤에 부탁 어미를 본다 — "잡아줘 ㅎㅎ" 도 부탁이다.
  const withoutLaugh = userText.replace(LAUGH_MARKS, "");
  const requestedOfAmora = REQUEST_TO_AMORA.test(withoutLaugh);
  const requestedOfAmoraRelaxed = REQUEST_TO_AMORA_RELAXED.test(withoutLaugh);
  const changeRequestedOfAmora = CHANGE_REQUEST_TO_AMORA.test(withoutLaugh);
  if (RETRACTION.test(userText)) return true;
  // 회상은 **바꿔** 달라는 부탁이 붙어 있을 때만 푼다 — "원래 5천이었는데 총예산
  // 6천으로 올려줘" 는 회상이 아니라 요청이다(2026-09-14 운영 실측: 카드 없이 예산
  // 화면에서 직접 입력하라고 답했다). 부탁이 없는 "작년에 예식장 알아봤었어" 도,
  // 읽어 달라는 "작년에 예식장 알아봤었는데 그때 견적 다시 보여줘" 도 그대로 막힌다.
  if (PAST_RECALL.test(userText) && !changeRequestedOfAmora) return true;
  if (MESSAGE_TO_OTHERS.test(userText)) return true;
  if (JOKING.test(userText)) return true;
  if (LAUGH.test(userText) && !requestedOfAmoraRelaxed) return true;
  if (SPOUSE_RECALL_CHECK.test(userText)) return true;
  if (AVOIDANCE.test(userText)) return true;
  // 전언은 부탁이 붙어 있지 않을 때만 막는다 — "부모님 지원금 3000만원
  // 들어왔어 반영해줘" 는 전언이 아니라 요청이다.
  return HEARSAY_SOURCE.test(userText)
    && HEARSAY_ENDING.test(userText)
    && !requestedOfAmora;
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

/** 완료·해제를 뜻하는 말. 항목 이름만으로는 "물어본 것"과 구분되지 않는다. */
export const AMORA_CHECKLIST_STATE_VERB =
  /(?:완료|끝냈|끝났|마쳤|했어|했음|했습니다|다\s*했|체크|해제|되돌|취소)/i;

/** 공백·가운뎃점·괄호를 지우고 견준다. 사용자는 "주문·제작" 을 "주문 제작" 으로 쓴다. */
function normalizeLabelToken(value: string): string {
  return value.replace(/[\s·・.,()[\]{}'"`~!?]/gu, "");
}

/**
 * 사용자가 **이 커플에 실제로 있는** 체크리스트 항목을 말했는가.
 *
 * 이름 전체가 그대로 나오길 요구하면 못 잡는다 — 사람은 "초대장 디자인 초안
 * 선택" 을 "디자인 초안 선택" 이라고 줄여 말한다. 그래서 이름을 토큰으로 쪼개
 * **과반(60%) 이상이 문장에 있고 최소 두 개가 맞을 때** 그 항목으로 본다.
 *
 * 한 토큰만 스쳐도 열리면 "디자인 좋아요" 같은 말에 카드가 나온다. 두 조건이
 * 그것을 막는다.
 */
/**
 * journey.progress 에서 체크리스트 항목 이름만 모은다.
 *
 * 범위 판정과 도구 관문이 **같은 목록**을 봐야 한다. 각자 긁어모으면 한쪽만
 * 고치는 일이 생기고, 그러면 "범위는 올라갔는데 도구는 안 열린다" 같은
 * 어긋남이 생긴다.
 */
/**
 * 아모라가 알아볼 체크리스트 항목 이름.
 *
 * **정본은 저장값이 아니라 템플릿이다.** 화면은
 * `mergePlanningChecklist(template, saved)` 로 그리는데, 그 병합은 템플릿 라벨이
 * 이기고 저장값에서는 `done` 만 가져온다. 그래서 사용자가 화면에서 읽는 이름은
 * 언제나 템플릿의 이름이다.
 *
 * 그런데 이 함수는 저장된 progress 의 라벨을 그대로 읽고 있었다. 둘이 다르면
 * 아모라는 **사용자가 말한 이름을 영영 못 알아본다.**
 *
 * 실측(2026-08-24 운영): 체크리스트 항목 173개 중 90개, 19커플 중 15커플의
 * 저장 라벨이 물음표로 깨져 있었다(`'??? ??? ??'`). 화면은 멀쩡했고 아모라만
 * 못 알아봤다 — "항목 이름을 다시 보내주세요" 를 반복했다.
 *
 * 이제 템플릿에서 이름을 가져온다. 저장값이 어떻게 깨져 있든 아모라가 보는
 * 이름과 사용자가 보는 이름이 같아진다.
 */
export function collectAmoraChecklistLabels(progress: unknown): string[] {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return [];
  const stored = progress as Record<string, unknown>;
  const labels: string[] = [];
  for (const template of CATEGORY_CHECKLISTS) {
    const saved = stored[template.key];
    // 그 분야를 아직 열지 않은 커플에게는 항목을 세지 않는다 — 없는 항목을
    // 완료 처리하겠다고 나서지 않게.
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) continue;
    for (const item of template.items) {
      if (typeof item.label === "string" && item.label.trim().length > 0) {
        labels.push(item.label);
      }
    }
  }
  return labels.slice(0, 120);
}

export function mentionsKnownChecklistItem(
  userText: string,
  labels: readonly string[] | undefined,
): boolean {
  if (!labels || labels.length === 0) return false;
  const haystack = normalizeLabelToken(userText);
  if (haystack.length === 0) return false;
  for (const label of labels) {
    if (typeof label !== "string") continue;
    const tokens = label
      .split(/[\s·・/]+/u)
      .map(normalizeLabelToken)
      .filter((token) => token.length >= 2);
    if (tokens.length === 0) continue;
    const matched = tokens.filter((token) => haystack.includes(token)).length;
    if (matched >= 2 && matched / tokens.length >= 0.6) return true;
    // 토큰이 하나뿐인 짧은 이름은 전체가 그대로 나와야 한다.
    if (tokens.length === 1 && haystack.includes(tokens[0]) && tokens[0].length >= 4) {
      return true;
    }
  }
  return false;
}

export interface SelectAmoraToolsInput {
  availableTools: readonly AiToolDefinition[];
  userText: string;
  specialistType: SpecialistType;
  attachmentKind?: "none" | "image" | "document";
  /** 직전 대화만 전달. 구현이 마지막 2개/각 600자로 다시 제한한다. */
  routingContext?: readonly AmoraToolRoutingMessage[];
  /**
   * 이 커플의 실제 체크리스트 항목 이름.
   *
   * 관문이 손으로 쓴 낱말 목록만 보면, 사용자가 그 낱말을 안 쓰는 순간 기능이
   * 사라진다. 실측(2026-08-23): "체크리스트에서 디자인 초안 선택 다 했어" 는
   * 카드가 나오고 **"디자인 초안 선택 다 했어" 는 안 나온다.** 낱말 하나 차이다.
   *
   * 항목 이름은 서버가 가진 사실이다. 그것을 말했으면 그게 곧 의도다. 목록을
   * 넓히는 대신 커플의 자료와 대조하면 새 항목이 생겨도 패턴을 안 짜도 되고,
   * 존재하지 않는 항목에는 절대 안 열린다.
   */
  checklistLabels?: readonly string[];
  /**
   * 라우터가 **키워드로 실제 매칭해서** 이 전문분야를 골랐는가.
   *
   * 2026-09-03: `routeSpecialist` 는 키워드가 하나도 안 맞으면 단계 기본값
   * (preparation_1 → budget_optimizer)을 준다. 아래 관문 해제는 "서버가 배분·일정
   * 전문 경로로 **보냈을 때**"를 뜻하는데, 기본값까지 그렇게 읽혀 아무 키워드도
   * 없는 상담성 질문에서도 관문 둘이 꺼졌다. 서버만 이 구별을 알 수 있으므로
   * 라우팅한 쪽이 함께 넘긴다. 안 넘기면(단위 테스트처럼 specialistType 을 직접
   * 지정하는 호출) 기존 계약대로 전문 경로로 본다.
   */
  specialistMatchedByKeyword?: boolean;
}

/**
 * 짧은 답이 이어받는 **앞 요청**(연속성 닻). 라우트가 되묻기·도구 의도 연속성을
 * 증명한 턴에서만 넘긴다.
 */
export interface AmoraProposalContinuityAnchor {
  /** 연속성으로 붙은 직전 W0 사용자 발화(`carriedToolIntent.priorUserText`). */
  priorUserText: string;
  /** 그 발화만으로 고른 전문분야 — 그 발화가 자기 턴에서 받았던 라우팅이다. */
  priorSpecialistType: SpecialistType;
  priorSpecialistMatchedByKeyword: boolean;
  /** 지금 사용자 발화(앞 요청을 붙이기 전). */
  replyText: string;
}

export interface SelectAmoraPendingProposalToolsInput extends SelectAmoraToolsInput {
  continuityAnchor?: AmoraProposalContinuityAnchor;
}

function addAll(target: Set<string>, names: readonly string[]): void {
  for (const name of names) target.add(name);
}

/**
 * Narrows server-issued, confirmation-required proposals by conversation
 * domain. Unlike selectAmoraTools this never authorizes a write; it only
 * limits which validated proposal marker the assistant may offer.
 *
 * ## 짧은 답은 앞 요청이 받았던 것을 받는다 (2026-09-17)
 *
 * 라이브 재현(세 단계 모두 같았다):
 *
 *   사용자: "… 이 기준으로 항목별 예산 배분을 표로 짜주고, 왜 그렇게 나눴는지도 알려줘."
 *   아모라: (배분표)                                   ← 이 턴은 예산 카드 도구 4개
 *   사용자: "응, 이대로 실제 예산에 반영해줘."
 *   아모라: "… 적용할까요?"                             ← 글로만 되물음
 *   사용자: "응 적용해줘"                               ← 카드 도구 0개
 *   아모라: (기능이 없다며 예산 화면에서 직접 입력하라고 안내)
 *
 * 라우트는 연속성이 증명된 턴에서 앞 요청과 답을 이어 붙여 넘기는데, 전문분야와
 * 키워드 일치 여부는 **답만** 보고 정한다. 답에는 키워드가 없어 아래 관문 해제가
 * 꺼지고, 이어 붙인 문장의 `NON_EXECUTABLE_RESTORE` 가 **앞 요청 자신의**
 * "알려줘"(또는 "추천해"·"좋을까")에 걸렸다. 앞 요청은 자기 턴에서 키워드로 배분
 * 경로에 들어가 같은 관문을 통과했었다 — 이어받는 답이 이어받은 요청보다 적게 받았다.
 *
 * 그래서 닻이 있으면 **앞 요청이 자기 턴에서 받았던 제안 도구**를 더한다. 단
 * 아무 답에나 더하지는 않는다 — 답이 **그 제안을 그대로 실행해 달라는 말뿐일 때**
 * 전부를, **금액 하나만 고쳐 달라는 말뿐일 때** 그 중 예산 카드 도구만 더한다
 * (`carriedProposalToolsForReply`). 더해지는 것은 언제나 앞 요청이 이미 받았던 것이라
 * 새 권한이 없고, 이어 붙인 문장의 결과는 그대로 포함하므로 어떤 턴도 전보다 줄지 않는다.
 *
 * 전문분야를 이어 붙인 문장에서 다시 고르지 않는다 — 그러면 "음 고민 중이야"·
 * "응 근데 추천해줘" 같은 답도 열리고, "친구는 드레스에 300만원 썼대" 뒤의
 * "네 반영해줘" 가 전언 자신보다 많이 받는다.
 */
export function selectAmoraPendingProposalTools(
  input: SelectAmoraPendingProposalToolsInput,
): AiToolDefinition[] {
  // 이어 붙인 문장으로 고른 것 — 이 수리 전과 같다.
  const names = pendingProposalToolNames(input);
  const anchor = input.continuityAnchor;
  if (anchor) {
    // 앞 요청이 자기 턴에서 받았던 것. 답은 이 묶음 **안에서만** 이어받는다.
    const carried = pendingProposalToolNames({
      ...input,
      userText: anchor.priorUserText,
      specialistType: anchor.priorSpecialistType,
      specialistMatchedByKeyword: anchor.priorSpecialistMatchedByKeyword,
    });
    for (const name of carriedProposalToolsForReply(anchor.replyText, carried)) {
      names.add(name);
    }
  }
  return input.availableTools.filter((tool) => names.has(tool.name));
}

/**
 * 답이 앞 제안에서 **무엇을** 이어받는가. 기본은 아무것도 아니다.
 *
 * 이어받는 모양은 둘뿐이고, 둘 다 **답 전체**를 대조한다 — 목록 밖 낱말이 하나라도
 * 섞이면 그 답은 이어받지 않는다.
 *
 *  1. 순수 실행 부탁(`CARRIED_PROPOSAL_PURE_APPLY`): 승낙어 · 지시어(이대로·그대로…) ·
 *     전부/다 · 실행 동사뿐인 답. 앞 제안의 도구 **전부**를 받는다.
 *  2. 금액 정정(`CARRIED_PROPOSAL_AMOUNT_CORRECTION`): "(아니) (항목은) 금액으로 해줘"
 *     뿐인 답. 앞 제안의 도구 중 **예산 카드 도구만** 받는다 — 앞 제안에 예산 도구가
 *     없으면 아무것도 받지 않는다.
 *
 * 그 밖의 답은 이어 붙인 문장이 스스로 받는 것만 받는다(닻이 없던 때와 같다).
 *
 * ## 왜 무름·보류·빼기·축 목록을 버렸나 (2026-09-18 재검사 (3))
 *
 * 앞 판은 "실행·정정 어형이면 열되, 무름·보류·한 줄 빼기·다른 축이 보이면 닫는다" 였다.
 * 닫는 쪽이 전부 **낱말 목록**이었고, 재검사마다 목록 밖 어형이 새로 샜다:
 *
 *  - 동사가 떨어진 제거 — "예단 빼고 저장해줘"·"스냅 없이 반영해줘" 는 뒤 절이 실행
 *    부탁이라 열렸다. `apply_budget_plan`(배분 **전체**를 반영하는 도구)까지 받았다.
 *  - 보류 시각 낱말 — "상견례 끝나고 적용해줘"·"이번 주말에 반영해줘" 는 보류 목록에
 *    없는 시각이라 열렸다.
 *  - 축 비교가 **거르개가 아니라 거부권**이었다 — 답이 앞 제안에 있던 축 하나를 가리키면
 *    그 축만이 아니라 앞 제안의 도구 **전부**를 받았다(일정·할 일을 함께 받은 앞 요청
 *    뒤의 상견례 날짜 답이 할 일 도구까지 받았다).
 *  - 물음표가 붙은 부탁 — "이대로 적용해줘?"·"4천으로 해줘?" 는 정정 갈래로 열렸다.
 *
 * 닫아야 하는 말은 끝이 없고 이어받아야 하는 말은 모양이 좁다. 그래서 목록을 늘리지
 * 않고 **여는 모양만** 적는다. 무름·시각·빼기·물음표·다른 동사·새 대상은 그 모양
 * 밖이라 따로 셀 필요가 없다 — 목록에 없는 말이 새로 와도 닫힌 채로 남는다. 같은 판에서
 * `isNotOurDecision` 도 이 자리에서 걷었다: "농담이야 이대로 적용해줘" 의 앞말이 곧 모양 밖이다.
 *
 * 재측정(앞 라운드 어형 479가지 × 앞 요청 2개 × 단계 3개, 개인 레인 포함)에서 닻이 더한
 * 칸은 순수 실행 부탁 210칸과 금액 정정 24칸(전부 예산 카드 도구)뿐이었다. 버킷별 전/후
 * 표는 `amoraProposalContinuityAnchor.test.ts` 의 `MATRIX` 주석에 있다.
 *
 * ## 정정을 왜 남겼나 — 재 보니 닻 없이는 받지 못한다
 *
 * 이 판을 짜기 전에 같은 축 정정 셋을 **닻 없이** 실제 선택기에 넣어 쟀다(앞 요청 = 배분표
 * 계획, 단계 3개):
 *
 *   답                        닻 없음(이어 붙인 문장)    앞 요청 자기 몫
 *   "아니 4천으로 해줘"          0 / 0 / 0                 4 / 4 / 4
 *   "드레스는 300으로 해줘"       0 / 0 / 0                 4 / 4 / 4
 *   "총예산 3500으로 해줘"        4 / 4 / 4                 4 / 4 / 4
 *
 * 셋째는 `총예산` 이 키워드로 배분 경로를 열어 스스로 받지만, 앞의 둘은 이어 붙인 문장이
 * 앞 요청의 "알려줘" 에 걸려 0개다. 이어받지 않으면 "아니 4천으로 해줘" 에서 D1("응
 * 적용해줘" → 카드 0개)이 그대로 되살아난다. 그래서 정정 갈래를 남기되 좁혔다 — 금액이
 * 있어야 하고, 금액을 고치는 말 **뿐**이어야 하며, 받는 것은 예산 카드 도구뿐이다.
 *
 * **날짜 정정은 이 갈래에 없다.** 날짜는 그 자체가 시각 표현이라 "다음 주 화요일로
 * 옮겨줘"(새 값)와 "다음 주에 적용해줘"(보류)를 글자로 가르려면 다시 목록이 필요하다.
 * 일정 제안 뒤의 "아니 10월 18일로 해줘" 는 이제 이어받지 않는다 — 닻이 없던 `main` 과
 * 같은 상태이고, "본식 일정 10월 18일로 옮겨줘" 처럼 대상을 말하면 스스로 받는다.
 * 치른 값이라 테스트가 그 칸을 함께 적는다.
 *
 * ## 이미 있는 판정기를 왜 그대로 쓰지 않았나
 *
 * - `classifyAmoraTypedCardAcceptance`(amoraTypedCardAcceptance.ts)가 순수 실행 부탁의
 *   원형이고 **문법을 그대로 빌렸다**. 맨 승낙("응"·"네")을 인정하지 않는 것도 그 파일의
 *   판단이다 — 닻은 아모라가 **무엇을** 되물었는지 모른다("적용할까요?" 인지 "일정도 잡아
 *   드릴까요?" 인지). 다만 낱말이 다르다(그 파일은 `알겠어` 를 승낙으로 보고 `맞아` 는
 *   모르며, 실행 동사가 넷뿐이다). 그 파일을 넓히면 카드를 옮기는 다른 계약이 같이 바뀐다.
 * - `CHANGE_REQUEST_TO_AMORA`·`hasNewAmoraChangeIntent` 는 "부탁 어미로 끝나는가" 를
 *   **문장 끝에서** 본다. 앞에 무엇이 붙어 있는지는 안 본다 — 이 판이 버린 구조 그대로다.
 */
function carriedProposalToolsForReply(
  replyText: string,
  carriedToolNames: ReadonlySet<string>,
): string[] {
  const normalized = replyText.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (CARRIED_PROPOSAL_PURE_APPLY.test(normalized)) return [...carriedToolNames];
  if (CARRIED_PROPOSAL_AMOUNT_CORRECTION.test(normalized)) {
    // 거르개다 — 앞 제안이 예산 말고 다른 축도 받았어도 금액 정정은 예산 도구만 받는다.
    return BUDGET_WRITE_TOOLS.filter((name) => carriedToolNames.has(name));
  }
  return [];
}

// ── 순수 실행 부탁 한 마디의 문법 ──────────────────────────────────
//
// 아래 조각을 이어 `CARRIED_PROPOSAL_PURE_APPLY` 를 만든다. 조각은 **정규식 리터럴**로
// 두고 `.source` 로 잇는다 — 문자열로 쓰면 `\s` 가 그냥 s 로 죽어 조용히 오작동한다(이
// 파일의 `KRW_AMOUNT` 주석이 적은 사고이고, 이 관문을 처음 짤 때도 한 번 밟았다).

/**
 * 승낙어 머리. `알겠어` 는 없다 — 카드가 없는 자리에서 "알겠어" 는 인정이지 실행 부탁이 아니다.
 *
 * `좋아` 뒤에만 띄어쓰기나 쉼표를 요구한다. 붙여 쓰면 "좋아해"·"좋아해요"·"좋아하자" 처럼
 * **좋아하다**가 되고, 그것은 실행 부탁이 아니라 마음에 든다는 말이다(2026-09-18 재검사:
 * 붙여 쓴 좋아하다 일곱 어형이 이어받았다). 다른 승낙어는 붙여 써도 다른 낱말이 되지
 * 않으므로("응해줘"·"ㅇㅇ해줘") 그대로 둔다.
 */
const CARRIED_APPLY_AFFIRMATION_LEAD =
  /(?:(?:(?:응+|웅|네+|넹|넵|예|그래요?|그럼요?|좋습니다|맞아요?|오케이|ok(?:ay)?|[ㅇᄋ]{2}|[ㅇᄋ][ㅋᄏ]+)[\s,]*|좋아요?[\s,]+)){0,2}/;
/**
 * 앞 제안을 가리키는 말 — 지시어, 전부/다, 내용 없는 부사(그냥·좀). 전부 선택이고 어느
 * 것도 **새 대상이나 값**이 아니다. 시각(지금·나중에)은 일부러 없다.
 */
const CARRIED_APPLY_POINTER =
  /(?:(?:그냥|좀)\s*)?(?:(?:이대로|그대로|그렇게|그걸로|그거로|그것으로|제안대로|카드대로|(?:방금|기존|위|아까)\s*(?:제안|내용)\s*대로)\s*)?(?:(?:전부|모두|다)\s*){0,2}(?:(?:그냥|좀)\s*)?/;
/**
 * 실행해 달라는 어형. 되돌리는 동사(취소·삭제·빼)도, 방향을 정하는 동사(올려·내려·줄여·
 * 늘려·옮겨·고쳐)도 없다 — 앞의 것은 제안 뒤에서 거절이고, 뒤의 것은 제안을 **바꾸라는**
 * 말이라 그대로 실행하는 것이 아니다. 맨 "해줘"·"하자" 는 실행 부탁이다("응 해줘").
 *
 * 맨 "할게" 는 없다 — "그렇게 할게" 는 아모라에게 맡기는 말이 아니라 **사용자가 하겠다**는
 * 인정이다. 실행 동사에 붙은 "적용할게요" 만 제안대로 하겠다는 답으로 본다.
 */
const CARRIED_APPLY_ACTION =
  /(?:(?:적용|반영|저장|진행|등록|추가|기록|배분|설정|확정)\s*(?:해\s*(?:줘요?|주세요|주라|줄래요?|주실래요?|요)?|하자|할게요?|합시다|부탁(?:해요?|드려요|드립니다)?)|(?:넣어|잡아|바꿔|맞춰|나눠)\s*(?:줘요?|주세요|주라|줄래요?|주실래요?)|해\s*(?:줘요?|주세요|주라|줄래요?|주실래요?|요)?|하자|합시다|부탁(?:해요?|드려요|드립니다)?)/;
/**
 * 끝의 문장부호·웃음. **물음표는 없다** — "이대로 적용해줘?" 는 부탁이 아니라 되묻는 말이다.
 * 승낙어 `[ㅇᄋ][ㅋᄏ]+` 는 실행 부탁 **앞**에서만 읽히므로 꼬리에 ㅋ 를 허용해도 "ㅇㅋ" 가
 * 부서지지 않는다(amoraTypedCardAcceptance.ts 리뷰 [5]).
 */
const CARRIED_APPLY_TAIL = /[\s.!~。…ㅋㅎᄏᄒ^]*$/;
/** **답 전체**가 승낙어 + 앞 제안을 가리키는 말 + 실행 부탁이어야 한다. 앞뒤를 묶는 것이 관문의 전부다. */
const CARRIED_PROPOSAL_PURE_APPLY = new RegExp(
  "^" + CARRIED_APPLY_AFFIRMATION_LEAD.source
    + CARRIED_APPLY_POINTER.source
    + CARRIED_APPLY_ACTION.source
    + CARRIED_APPLY_TAIL.source,
  "iu",
);

// ── 금액 정정 한 마디의 문법 ───────────────────────────────────────

/** 정정의 머리 — "아니"·"그건 아니야" 처럼 앞 값을 아니라고 하는 말 하나. 그 뒤에 새 금액이 와야 한다. */
const CARRIED_CORRECTION_LEAD =
  /(?:(?:(?:이건|그건|이게|그게)\s*)?(?:아니(?:야|요|에요)?|아냐|아뇨)[\s,.!]*)?/;
/**
 * 무엇의 금액인가 — 선택. 이 파일이 이미 쓰는 항목 이름·예산 어휘만 받는다. 목록 밖
 * 낱말("나중에"·"내일은")은 대상이 될 수 없어서 그 답은 이어받지 않는다.
 */
const CARRIED_CORRECTION_TARGET_WORD = new RegExp(
  [/(?:총|전체)?\s*예산|식대/.source, BUDGET_CATEGORY_WORDS.source].join("|"),
);
/** 대상 낱말 뒤 — "메이크업 예산" 의 `예산` 과 조사 하나. */
const CARRIED_CORRECTION_TARGET_TAIL = /(?:\s*예산)?\s*(?:은|는|이|가|을|를|만|도)?\s*/;
/**
 * 새 금액. 단위를 생략한 구어("300으로"·"4천으로")도 금액이다. 날짜·시각·사람 수의
 * 단위(월·일·시·명)는 받지 않는다 — 금액 정정만 이 갈래다.
 *
 * 소수점은 **단위가 붙을 때만** 받는다("1.5억으로"·"2.5천으로"). 단위 없는 점은 금액이
 * 아니라 날짜·시각이다 — "3.15로 해줘"·"7.30으로 바꿔줘" 가 금액 정정으로 읽혀 예산
 * 도구를 이어받았다(2026-09-18 재검사). 단위 없는 숫자는 맨 마지막 덩어리에만 온다.
 */
const CARRIED_CORRECTION_AMOUNT =
  /(?:\d[\d,]*(?:\.\d+)?\s*(?:억|천만|백만|십만|천|백|십|만)\s*){0,2}\d[\d,]*(?:(?:\.\d+)?\s*(?:억|천만|백만|십만|천|백|십|만))?\s*원?\s*(?:으로|로)\s*(?:좀\s*)?/;
/** 금액을 그 값으로 두라는 어형. 되돌리는 동사는 없다. */
const CARRIED_CORRECTION_VERB =
  /(?:(?:해|바꿔|맞춰|올려|내려|낮춰|줄여|늘려|고쳐|잡아|(?:변경|수정|조정|설정)\s*해)\s*(?:줘요?|주세요|주라|줄래요?|주실래요?|요)?|하자|할게요?|합시다|(?:변경|수정|조정)\s*(?:하자|부탁(?:해요?|드려요|드립니다)?)|부탁(?:해요?|드려요|드립니다)?)/;
/** **답 전체**가 (아니) + (대상) + 금액 + 정정 동사여야 한다. 물음표·시각·무름·빼기가 섞이면 맞지 않는다. */
const CARRIED_PROPOSAL_AMOUNT_CORRECTION = new RegExp(
  "^" + CARRIED_CORRECTION_LEAD.source
    + "(?:(?:" + CARRIED_CORRECTION_TARGET_WORD.source + ")" + CARRIED_CORRECTION_TARGET_TAIL.source + ")?"
    + CARRIED_CORRECTION_AMOUNT.source
    + CARRIED_CORRECTION_VERB.source
    + CARRIED_APPLY_TAIL.source,
  "iu",
);

function pendingProposalToolNames({
  userText,
  specialistType,
  checklistLabels,
  specialistMatchedByKeyword,
}: SelectAmoraToolsInput): Set<string> {
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
  if (isNotOurDecision(userText)) return selected;
  // '아직 저장하지 말고 제안/미리보기만'은 실행이나 다른 계획 변경이
  // 아니다. 해당 제품 객체의 추가 확인 카드만 준비하고 승인 경계는 유지한다.
  if (hasAmoraSharedTaskProposalRequest(userText)) {
    selected.add("add_amora_action");
    return selected;
  }
  // 값이 덜 정해진 말은 보통 카드를 안 내지만, 서버가 배분·일정 전문 경로로 보낸
  // 턴에서는 그것이 **정상이고 방아쇠**다. `NON_EXECUTABLE_RESTORE` 도 같은 성격이라
  // (`좋을까|어떨|추천해`) 함께 예외를 받는다 — 남 이야기 쪽은 위 가드가 이미 잡는다.
  // 단계 기본값으로 떨어진 턴은 "보낸" 것이 아니다 — 그때는 관문을 그대로 둔다.
  const routedToPlanningSpecialist =
    (specialistMatchedByKeyword ?? true)
    && (specialistType === "budget_optimizer"
      || specialistType === "ceremony_coordinator");
  if (!routedToPlanningSpecialist) {
    if (NON_EXECUTABLE_RESTORE.test(userText)) return selected;
    if (isUnsettledValue(userText)) return selected;
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
    // 손으로 쓴 낱말이 없어도, **이 커플에 실제로 있는** 체크리스트 항목 이름을
    // 완료·해제 표현과 함께 말했으면 연다.
    //
    // 실측(2026-08-23): "체크리스트에서 디자인 초안 선택 다 했어" 는 카드가
    // 나오고 "디자인 초안 선택 다 했어" 는 안 나왔다. `SCHEDULE_INTENT` 에
    // "체크리스트" 가 있는지 여부가 전부였다. 낱말을 더 넣는 것은 다음 표현에서
    // 또 막히므로, 서버가 가진 사실(항목 이름)과 대조한다.
    || (AMORA_CHECKLIST_STATE_VERB.test(userText)
      && mentionsKnownChecklistItem(userText, checklistLabels))
  ) {
    addAll(selected, SCHEDULE_WRITE_TOOLS);
  }
  if (/(?:웨딩홀|예식장|식장|장소|venue)/i.test(userText)) {
    selected.add("update_venue");
  }
  if (ACTION_INTENT.test(userText)) addAll(selected, ACTION_WRITE_TOOLS);
  return selected;
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
  checklistLabels,
}: SelectAmoraToolsInput): AiToolDefinition[] {
  const selected = new Set<string>();
  const acceptsDirectDeclaration = !NON_EXECUTABLE_DECLARATION.test(userText);
  addAll(selected, BASE_READ_TOOLS);

  const hasBudgetIntent = BUDGET_INTENT.test(userText)
    || specialistType === "budget_optimizer";
  const hasScheduleIntent = SCHEDULE_INTENT.test(userText)
    || specialistType === "ceremony_coordinator";
  const hasVendorIntent = VENDOR_INTENT.test(userText);
  // 문서를 올렸다는 사실만으로 계약 검토로 넘어가지 않는다. 견적서를 같이
  // 보는 경로만 남긴다 — 첨부가 없으면 견적 의도로만 열린다.
  const hasDocumentAttachment = attachmentKind === "document";
  const hasActionIntent = ACTION_INTENT.test(userText);
  // 견적서는 보통 **사진**으로 온다. 계약 의도는 `document` 만 보므로 사진을 올리면
  // 견적 체크가 안 열렸다.
  const hasQuoteIntent = QUOTE_INTENT.test(userText)
    || specialistType === "budget_optimizer"
    || attachmentKind === "image"
    || attachmentKind === "document";
  if (hasBudgetIntent) addAll(selected, BUDGET_READ_TOOLS);
  if (hasScheduleIntent) addAll(selected, SCHEDULE_READ_TOOLS);
  if (hasVendorIntent) addAll(selected, VENDOR_READ_TOOLS);
  if (hasDocumentAttachment) addAll(selected, DOCUMENT_ATTACHMENT_READ_TOOLS);
  if (hasActionIntent) addAll(selected, ACTION_READ_TOOLS);
  if (hasQuoteIntent) selected.add("analyze_quote");
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
  if (
    CHECKLIST_WRITE.test(userText)
    // 손으로 쓴 낱말이 없어도, 이 커플의 실제 항목 이름 + 완료/해제 표현이면 연다.
    || (AMORA_CHECKLIST_STATE_VERB.test(userText)
      && mentionsKnownChecklistItem(userText, checklistLabels))
  ) {
    selected.add("toggle_checklist_item");
  }
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

  const sharedTaskProposalOnly = hasAmoraSharedTaskProposalRequest(userText);
  const priceScope = assessMarketPriceRequestScope(userText);
  if (priceScope.hadExplicitTarget && priceScope.requestedSupportedCategories.size === 0) selected.delete("get_market_price");
  return availableTools.filter((tool) => selected.has(tool.name)
    && (!sharedTaskProposalOnly || !isMutatingTool(tool.name)));
}
