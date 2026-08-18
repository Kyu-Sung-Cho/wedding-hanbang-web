import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import type { SpecialistType } from "@/types/moat.types";
import {
  getCanonicalCategoryKeyForMoment,
  type ScheduleCareCategoryKey,
  type ScheduleCareMomentType,
} from "@hanbang/shared/constants";

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
const QUOTE_READ_TOOLS = ["analyze_quote"] as const;
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
  ...QUOTE_READ_TOOLS,
  ...BUDGET_WRITE_TOOLS,
  ...SCHEDULE_READ_TOOLS,
  ...SCHEDULE_WRITE_TOOLS,
  ...VENDOR_READ_TOOLS,
  ...DOCUMENT_ATTACHMENT_READ_TOOLS,
  ...ACTION_READ_TOOLS,
  ...ACTION_WRITE_TOOLS,
  "update_venue",
]);

const BUDGET_INTENT = /예산|비용|금액|가격|견적|시세|돈|식대|지출|썼|결제|budget|price|quote/i;
const QUOTE_ANALYSIS_INTENT = /견적|quote/i;
const SCHEDULE_INTENT = /일정|스케줄|날짜|예정일|결혼식|예식|본식|웨딩|체크리스트|할\s*일|준비\s*목록|schedule|date|task/i;
const VENDOR_INTENT = /업체|웨딩홀|예식장|결혼식장|스튜디오|드레스|(?:혼주\s*)?메이크업|스드메|플래너|웨딩\s*(?:촬영|사진)|본식|결혼\s*준비|예약|vendor|venue|booking/i;
const ACTION_INTENT = /기억|기록|메모|액션|챙겨|리마인드|remember|note|remind/i;
const FIRST_USE_ACTION_DRAFT_INTRO =
  "나만 상담에서 정리한 이 한 가지를 둘이 볼 실행 카드로 제안해줘.";
const FIRST_USE_ACTION_DRAFT_LEGACY_INTRO =
  "나만 상담에서 정리한 아래 한 가지를 공동 준비 기록에 추가할 수 있는 실행 카드로 제안해줘.";
const FIRST_USE_ACTION_DRAFT_CONFIRMATION =
  "저장 전에는 확인 카드만 보여줘.";
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
const DIRECT_WEDDING_DATE_DECLARATION = /(?:(?:내년|올해)\s*)?(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일(?:에|로)?\s*(?:결혼(?:식)?(?:해|해요|이야|이에요|예정이야|예정이에요)|(?:결혼식|예식)(?:으로\s*)?(?:정했어|정했어요))/i;
const DIRECT_SCHEDULE_DECLARATION = /(?:(?:이번|다음)\s*)?(?:월|화|수|목|금|토|일)요일(?:에)?\s*(?:상견례|예식장\s*(?:상담|투어)|웨딩홀\s*(?:상담|투어)|드레스\s*(?:투어|피팅)|스튜디오\s*(?:촬영|상담)|메이크업\s*(?:상담|테스트)|청첩장\s*모임)(?:이야|야|이에요|예요|가|해|해요)/i;
const DIRECT_TASK_STATUS_DECLARATION = /(?:상견례|예식장|웨딩홀|스튜디오|드레스|메이크업|예물|한복|예단|신혼여행|혼수|신혼집|청첩장|스냅|답례품|폐백).*(?:계약|예약|준비|주문)(?:했어|했어요|완료했어|완료했어요)/i;
const CONCRETE_SCHEDULE_DATE = /(?:오늘|내일|모레|(?:(?:이번|다음)\s*주\s*)?(?:월|화|수|목|금|토|일)요일|(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일|\d{4}[-./]\d{1,2}[-./]\d{1,2})/i;

const SCHEDULE_CARE_MOMENT_PATTERNS: readonly Readonly<{
  momentType: ScheduleCareMomentType;
  pattern: RegExp;
}>[] = [
  { momentType: "sanggyeonrye", pattern: /상견례/i },
  {
    momentType: "family_greeting",
    pattern: /(?:(?:가족|부모님).{0,12}(?:첫|처음)\s*인사|(?:첫|처음)\s*인사(?:를|드리))/i,
  },
  {
    momentType: "venue_tour",
    pattern: /(?:예식장|웨딩홀|결혼식장)\s*(?:상담|투어|방문)/i,
  },
  {
    momentType: "dress_fitting",
    pattern: /드레스\s*(?:(?:최종|본식)\s*)?(?:피팅|가봉|수선(?:\s*상태)?\s*확인)/i,
  },
  {
    momentType: "dress_tour",
    pattern: /드레스\s*(?:(?:샵|매장)\s*)?(?:투어|보러|입어\s*보)/i,
  },
  {
    momentType: "studio_shoot",
    pattern: /(?:스튜디오\s*(?:사진\s*)?촬영|웨딩\s*사진\s*촬영)/i,
  },
  {
    momentType: "invitation_meeting",
    pattern: /청첩장\s*(?:전달\s*)?(?:모임|약속)|청첩장\s*전달/i,
  },
  {
    momentType: "first_holiday",
    pattern: /(?:결혼\s*후\s*)?첫\s*명절/i,
  },
];

export interface CanonicalScheduleMomentBinding {
  momentType: ScheduleCareMomentType;
  categoryKey: ScheduleCareCategoryKey;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const KOREAN_WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  월: 0,
  화: 1,
  수: 2,
  목: 3,
  금: 4,
  토: 5,
  일: 6,
};

function formatValidatedYmd(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year)
    || !Number.isInteger(month)
    || !Number.isInteger(day)
    || year < 2000
    || year > 2100
  ) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function kstCalendarDate(now: Date): Date | null {
  if (!Number.isFinite(now.getTime())) return null;
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  ));
}

function addCalendarDays(base: Date, days: number): string | null {
  const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1_000);
  return formatValidatedYmd(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
  );
}

/**
 * Resolves only calendar phrases whose KST date is deterministic from the
 * current turn. Month/day without a year remains provider-visible for user
 * confirmation but is never server-overwritten because the intended year is
 * ambiguous.
 */
export function getCanonicalScheduleDateBinding(
  userText: string,
  now: Date,
): string | null {
  if (NON_EXECUTABLE_DECLARATION.test(userText)) return null;

  const iso = userText.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/u);
  if (iso) return formatValidatedYmd(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const koreanFull = userText.match(/\b(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/u);
  if (koreanFull) {
    return formatValidatedYmd(
      Number(koreanFull[1]),
      Number(koreanFull[2]),
      Number(koreanFull[3]),
    );
  }

  const base = kstCalendarDate(now);
  if (!base) return null;
  if (/오늘/u.test(userText)) return addCalendarDays(base, 0);
  if (/내일/u.test(userText)) return addCalendarDays(base, 1);
  if (/모레/u.test(userText)) return addCalendarDays(base, 2);

  const weekday = userText.match(/(?:(이번|다음)\s*주\s*)?(월|화|수|목|금|토|일)요일/u);
  if (!weekday) return null;
  const targetIndex = KOREAN_WEEKDAY_INDEX[weekday[2]];
  if (targetIndex === undefined) return null;
  const currentIndex = (base.getUTCDay() + 6) % 7;
  if (weekday[1] === "다음") {
    return addCalendarDays(base, 7 - currentIndex + targetIndex);
  }
  if (weekday[1] === "이번") {
    const offset = targetIndex - currentIndex;
    return offset < 0 ? null : addCalendarDays(base, offset);
  }
  return addCalendarDays(base, (targetIndex - currentIndex + 7) % 7);
}

/**
 * Reads only the current user turn and returns a high-confidence canonical
 * care-moment binding. Provider prose and earlier turns never supply this
 * metadata, and hypothetical/third-party statements fail closed.
 */
export function getCanonicalScheduleMomentBinding(
  userText: string,
): CanonicalScheduleMomentBinding | null {
  if (
    NON_EXECUTABLE_DECLARATION.test(userText)
    || !CONCRETE_SCHEDULE_DATE.test(userText)
  ) return null;
  const matched = SCHEDULE_CARE_MOMENT_PATTERNS.find(({ pattern }) =>
    pattern.test(userText)
  );
  if (!matched) return null;
  const categoryKey = getCanonicalCategoryKeyForMoment(matched.momentType);
  return categoryKey
    ? { momentType: matched.momentType, categoryKey }
    : null;
}

function bindCanonicalScheduleMoment(
  tools: readonly AiToolDefinition[],
  binding: CanonicalScheduleMomentBinding | null,
  dateBinding: string | null = null,
): AiToolDefinition[] {
  if (!binding) return [...tools];
  return tools.map((tool) => {
    if (tool.name !== "add_schedule_event") return tool;
    const properties = tool.input_schema.properties;
    const propertySchemas = properties !== null
      && typeof properties === "object"
      && !Array.isArray(properties)
      ? properties as Record<string, unknown>
      : {};
    const required = Array.isArray(tool.input_schema.required)
      ? tool.input_schema.required.filter(
          (field): field is string => typeof field === "string",
        )
      : [];
    const boundInput = {
      ...(dateBinding ? { date: dateBinding } : {}),
      moment_type: binding.momentType,
      category_key: binding.categoryKey,
    };
    return {
      ...tool,
      input_schema: {
        ...tool.input_schema,
        "x-amora-bound-input": boundInput,
        properties: {
          ...propertySchemas,
          ...(dateBinding
            ? {
                date: {
                  ...(propertySchemas.date !== null
                    && typeof propertySchemas.date === "object"
                    && !Array.isArray(propertySchemas.date)
                    ? propertySchemas.date as Record<string, unknown>
                    : {}),
                  enum: [dateBinding],
                },
              }
            : {}),
          moment_type: {
            ...(propertySchemas.moment_type !== null
              && typeof propertySchemas.moment_type === "object"
              && !Array.isArray(propertySchemas.moment_type)
              ? propertySchemas.moment_type as Record<string, unknown>
              : {}),
            enum: [binding.momentType],
          },
          category_key: {
            ...(propertySchemas.category_key !== null
              && typeof propertySchemas.category_key === "object"
              && !Array.isArray(propertySchemas.category_key)
              ? propertySchemas.category_key as Record<string, unknown>
              : {}),
            enum: [binding.categoryKey],
          },
        },
        required: [...new Set([...required, "moment_type", "category_key"])],
      },
    };
  });
}

export interface AmoraToolRoutingMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AmoraFirstUseActionProposalBinding {
  promotionId: string;
  canonicalAddActionInput: Readonly<{
    title: string;
    description: string;
    category_key: "general";
    priority: "medium";
    source: "chat";
  }>;
}

export interface SelectAmoraToolsInput {
  availableTools: readonly AiToolDefinition[];
  userText: string;
  specialistType: SpecialistType;
  attachmentKind?: "none" | "image" | "document";
  /** Request-captured time. Only supplied at the server boundary. */
  now?: Date;
  /** Service-validated receipt for the exact current shared user row. */
  firstUseActionBinding?: AmoraFirstUseActionProposalBinding | null;
  /** 직전 대화만 전달. 구현이 마지막 2개/각 600자로 다시 제한한다. */
  routingContext?: readonly AmoraToolRoutingMessage[];
}

function addAll(target: Set<string>, names: readonly string[]): void {
  for (const name of names) target.add(name);
}

function parseFirstUseSharedActionDraft(
  userText: string,
): Record<string, unknown> | null {
  const lines = userText.split("\n");
  if (
    lines.length !== 5
    || lines[0] !== FIRST_USE_ACTION_DRAFT_INTRO
    || lines[4] !== FIRST_USE_ACTION_DRAFT_CONFIRMATION
  ) return null;

  const fields = [
    { line: lines[1], prefix: "지금 할 한 가지: ", maxLength: 120 },
    { line: lines[2], prefix: "이유: ", maxLength: 220 },
    { line: lines[3], prefix: "완료 기준: ", maxLength: 220 },
  ];
  const values = fields.map(({ line, prefix, maxLength }) => {
    if (!line.startsWith(prefix)) return null;
    const value = line.slice(prefix.length).trim();
    return value.length > 0
      && Array.from(value).length <= maxLength
      && !["<", ">", "{", "}", "[", "]"].some((character) => value.includes(character))
      ? value
      : null;
  });
  if (values.some((value) => value === null)) return null;
  const [title, reason, completionCriterion] = values as [string, string, string];
  return {
    title,
    description: `이유: ${reason} 완료 기준: ${completionCriterion}`,
    category_key: "general",
    priority: "medium",
    source: "chat",
  };
}

function bindFirstUseAction(
  tool: AiToolDefinition,
  boundInput: Record<string, unknown>,
): AiToolDefinition {
  const propertySchemas = tool.input_schema.properties !== null
    && typeof tool.input_schema.properties === "object"
    && !Array.isArray(tool.input_schema.properties)
    ? tool.input_schema.properties as Record<string, unknown>
    : {};
  const properties = Object.fromEntries(
    Object.entries(boundInput).map(([key, value]) => {
      const original = propertySchemas[key];
      return [key, {
        ...(original !== null && typeof original === "object" && !Array.isArray(original)
          ? original as Record<string, unknown>
          : {}),
        enum: [value],
      }];
    }),
  );
  return {
    ...tool,
    input_schema: {
      ...tool.input_schema,
      "x-amora-bound-input": boundInput,
      properties,
      required: Object.keys(boundInput),
    },
  };
}

function matchesFirstUseActionBinding(
  expectedInput: Record<string, unknown>,
  binding: AmoraFirstUseActionProposalBinding | null | undefined,
): binding is AmoraFirstUseActionProposalBinding {
  if (
    !binding
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(binding.promotionId)
  ) return false;
  const input = binding.canonicalAddActionInput;
  const expectedKeys = Object.keys(expectedInput);
  const actualKeys = Object.keys(input);
  return actualKeys.length === expectedKeys.length
    && expectedKeys.every((key) => input[key as keyof typeof input] === expectedInput[key]);
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
  now,
  firstUseActionBinding,
}: SelectAmoraToolsInput): AiToolDefinition[] {
  const firstUseDraftBinding = parseFirstUseSharedActionDraft(userText);
  if (firstUseDraftBinding) {
    if (!matchesFirstUseActionBinding(firstUseDraftBinding, firstUseActionBinding)) {
      return [];
    }
    return availableTools
      .filter((tool) => tool.name === "add_amora_action")
      .map((tool) => bindFirstUseAction(
        tool,
        firstUseActionBinding.canonicalAddActionInput,
      ));
  }
  if (
    userText.startsWith(`${FIRST_USE_ACTION_DRAFT_INTRO}\n`)
    || userText.startsWith(`${FIRST_USE_ACTION_DRAFT_LEGACY_INTRO}\n`)
  ) {
    return [];
  }
  const selected = new Set<string>();
  const scheduleMomentBinding = getCanonicalScheduleMomentBinding(userText);
  const scheduleDateBinding = scheduleMomentBinding && now
    ? getCanonicalScheduleDateBinding(userText, now)
    : null;
  const acceptsDirectDeclaration = !NON_EXECUTABLE_DECLARATION.test(userText);
  // 제안 경로는 쓰기 권한이 아니라 "확인 카드를 낼 수 있는가"만 정한다(아래 주석 참고).
  // 좁게 잡으면 "내년 5월 20일에 결혼해"처럼 가장 자연스러운 확정 발화가
  // 저장으로 이어지지 못하므로, 확정형 선언 정규식도 함께 인정한다.
  if (
    BUDGET_INTENT.test(userText)
    || DIRECT_TOTAL_BUDGET_DECLARATION.test(userText)
    || DIRECT_CATEGORY_BUDGET_DECLARATION.test(userText)
    || specialistType === "budget_optimizer"
  ) {
    addAll(selected, BUDGET_WRITE_TOOLS);
  }
  if (
    SCHEDULE_INTENT.test(userText)
    || (acceptsDirectDeclaration && DIRECT_WEDDING_DATE_DECLARATION.test(userText))
    || (acceptsDirectDeclaration && DIRECT_SCHEDULE_DECLARATION.test(userText))
    || (acceptsDirectDeclaration && DIRECT_TASK_STATUS_DECLARATION.test(userText))
    || scheduleMomentBinding !== null
    || specialistType === "ceremony_coordinator"
  ) {
    addAll(selected, SCHEDULE_WRITE_TOOLS);
  }
  if (/(?:웨딩홀|예식장|식장|장소|venue)/i.test(userText)) {
    selected.add("update_venue");
  }
  if (ACTION_INTENT.test(userText)) addAll(selected, ACTION_WRITE_TOOLS);
  return bindCanonicalScheduleMoment(
    availableTools.filter((tool) => selected.has(tool.name)),
    scheduleMomentBinding,
    scheduleDateBinding,
  );
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
  const scheduleMomentBinding = getCanonicalScheduleMomentBinding(userText);
  addAll(selected, BASE_READ_TOOLS);

  const hasBudgetIntent = BUDGET_INTENT.test(userText)
    || specialistType === "budget_optimizer";
  const hasQuoteIntent = QUOTE_ANALYSIS_INTENT.test(userText);
  const hasScheduleIntent = SCHEDULE_INTENT.test(userText)
    || specialistType === "ceremony_coordinator";
  const hasVendorIntent = VENDOR_INTENT.test(userText);
  // 문서를 올렸다는 사실만으로 계약 검토로 넘어가지 않는다. 견적서를 같이
  // 보는 경로만 남긴다 — 첨부가 없으면 견적 의도로만 열린다.
  const hasDocumentAttachment = attachmentKind === "document";
  const hasActionIntent = ACTION_INTENT.test(userText);
  if (hasBudgetIntent) addAll(selected, BUDGET_READ_TOOLS);
  if (hasQuoteIntent) addAll(selected, QUOTE_READ_TOOLS);
  if (hasScheduleIntent) addAll(selected, SCHEDULE_READ_TOOLS);
  if (hasVendorIntent) addAll(selected, VENDOR_READ_TOOLS);
  if (hasDocumentAttachment) addAll(selected, DOCUMENT_ATTACHMENT_READ_TOOLS);
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
    || (acceptsDirectDeclaration && DIRECT_SCHEDULE_DECLARATION.test(userText))
    || scheduleMomentBinding !== null) {
    selected.add("add_schedule_event");
  }
  if (ACTION_ADD_WRITE.test(userText)) selected.add("add_amora_action");
  if (ACTION_UPDATE_WRITE.test(userText)) selected.add("update_amora_action");
  if (VENUE_WRITE.test(userText)) selected.add("update_venue");

  return bindCanonicalScheduleMoment(
    availableTools.filter((tool) => selected.has(tool.name)),
    scheduleMomentBinding,
  );
}
