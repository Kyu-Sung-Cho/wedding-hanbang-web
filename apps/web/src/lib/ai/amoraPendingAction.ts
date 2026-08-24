import Ajv, { type ValidateFunction } from "ajv";
import { getAmoraPendingActionTtlMs } from "@/lib/ai/amoraActionApprovalPolicy";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { CHECKLIST_MAP } from "@/constants/checklists";

const MAX_PENDING_ACTION_JSON_CHARS = 4_000;
const MAX_CANONICAL_CONFIRMATION_CHARS = 2_000;
const MAX_JSON_KEY_CHARS = 120;
const ACTION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const UNSAFE_DISPLAY_CONTROL_RE = /[\p{Cc}\u2028\u2029]/u;
const UNSAFE_DISPLAY_FORMAT_RE = /\p{Cf}/u;
const TOOL_LABELS: Readonly<Record<string, string>> = {
  update_budget: "총 결혼 예산 변경",
  update_wedding_date: "결혼식 날짜 변경",
  update_task_status: "준비 항목 상태 변경",
  update_venue: "결혼식장 변경",
  update_category_budget: "카테고리 예산·기록 지출 변경",
  apply_budget_plan: "예산 배분안 적용",
  add_custom_category: "맞춤 예산 항목 추가",
  delete_category: "예산 항목 삭제",
  reset_category: "예산 항목 초기화",
  add_schedule_event: "일정 추가",
  update_schedule_event: "일정 변경",
  cancel_schedule_event: "일정 취소",
  restore_schedule_event: "취소 일정 복원",
  delete_schedule_event: "지원 중단된 일정 삭제",
  toggle_checklist_item: "체크리스트 상태 변경",
  add_amora_action: "아모라 행동 카드 추가",
  update_amora_action: "아모라 행동 카드 변경",
  log_wedding_event: "웨딩 일정 기억",
  create_booking: "아모라 방문·상담 요청 기록",
  cancel_booking: "아모라 예약 요청 기록 취소 표시",
};
const FIELD_LABELS: Readonly<Record<string, string>> = {
  total_budget: "총 예산",
  wedding_date: "결혼식 날짜",
  category: "카테고리",
  status: "상태",
  venue: "결혼식장",
  budget: "예산",
  spent: "기록 지출(결제 확인과 별도)",
  allocations: "카테고리별 배분",
  intake_summary: "배분 근거",
  rationale: "배분 이유",
  label: "항목 이름",
  confirmed: "사용자 확인",
  date: "날짜",
  time: "시간",
  title: "제목",
  memo: "메모",
  category_key: "관련 카테고리",
  schedule_scope: "일정 성격",
  event_id: "일정 식별자",
  expected_title: "대상 일정",
  expected_date: "현재 날짜",
  reason: "취소 사유",
  item_id: "체크리스트 항목",
  done: "완료 여부",
  description: "설명",
  due_date: "마감일",
  priority: "중요도",
  source: "저장 출처",
  href: "연결 화면",
  action_id: "행동 카드 식별자",
  moment_type: "일정 종류",
  service_id: "서비스 식별자",
  booking_id: "대상 예약 요청 기록",
  preferred_date: "희망 날짜",
  preferred_time: "희망 시간",
};
const ENUM_VALUE_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  status: {
    not_started: "시작 전",
    in_progress: "진행 중",
    completed: "완료",
    open: "진행 중",
    done: "완료",
    dismissed: "숨김",
  },
  priority: {
    high: "높음",
    medium: "보통",
    low: "낮음",
  },
  moment_type: {
    family_greeting: "한쪽 가족에게 첫인사",
    sanggyeonrye: "양쪽 부모님이 함께 만나는 자리",
    venue_tour: "결혼식장 방문",
    dress_tour: "드레스 매장 방문",
    studio_shoot: "웨딩 사진 촬영",
    dress_fitting: "드레스 수선·최종 확인",
    invitation_meeting: "초대장 전달 모임",
    first_holiday: "결혼 후 첫 명절",
  },
  source: {
    chat: "채팅",
    quote: "견적",
    schedule: "일정",
    budget: "예산",
    guardrail: "주의사항",
    manual: "직접 입력",
  },
  schedule_scope: {
    confirmed_fact: "이미 확정된 사실 기록",
    shared_commitment: "두 사람이 함께 정할 약속",
    external_commitment: "업체·가족과의 약속",
  },
};
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  general: "일반",
  ...PLANNING_CATEGORY_LABELS,
};
const WON_FIELDS = new Set(["total_budget", "budget", "spent"]);
const INTERNAL_CONFIRMATION_FIELDS = new Set([
  "event_id",
  "item_id",
  "action_id",
  "service_id",
]);
const NESTED_FIELD_ORDER = ["category", "budget", "rationale"] as const;

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  strictNumbers: true,
  coerceTypes: false,
});
const validators = new WeakMap<object, ValidateFunction>();

export interface StoredAmoraPendingAction {
  version: 2;
  actionId: string;
  tool: string;
  input: Record<string, unknown>;
  inputDigest: string;
  operationKey: string;
  confirmation: string;
  issuedAt: number;
  expiresAt: number;
}

interface PendingActionMarker {
  tool: string;
  input: Record<string, unknown>;
  confirmation: string;
}

interface ExtractPendingActionInput {
  text: string;
  allowedTools: readonly AiToolDefinition[];
  now: number;
  createActionId: () => string;
}

interface ResolvePendingActionInput {
  value: unknown;
  confirmedActionId: unknown;
  allowedTools: readonly AiToolDefinition[];
  now: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeJsonKey(key: string): boolean {
  return key.length > 0
    && key.length <= MAX_JSON_KEY_CHARS
    && key.trim().length > 0
    && !FORBIDDEN_JSON_KEYS.has(key)
    && !UNSAFE_DISPLAY_CONTROL_RE.test(key)
    && !UNSAFE_DISPLAY_FORMAT_RE.test(key);
}

function isSafeJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") {
    const withoutAllowedWhitespace = value.replace(/[\t\n\r]/g, "");
    return !UNSAFE_DISPLAY_CONTROL_RE.test(withoutAllowedWhitespace)
      && !UNSAFE_DISPLAY_FORMAT_RE.test(value);
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isSafeJsonValue);
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, nested]) => isSafeJsonKey(key) && isSafeJsonValue(nested),
  );
}

function getValidator(tool: AiToolDefinition): ValidateFunction | null {
  const schema = tool.input_schema;
  if (!schema || typeof schema !== "object") return null;
  let validator = validators.get(schema);
  if (!validator) {
    try {
      validator = ajv.compile(schema);
    } catch {
      return null;
    }
    validators.set(schema, validator);
  }
  return validator;
}

function hasOnlyDeclaredTopLevelKeys(
  input: Record<string, unknown>,
  tool: AiToolDefinition,
): boolean {
  const properties = isRecord(tool.input_schema.properties)
    ? tool.input_schema.properties
    : {};
  return Object.keys(input).every((key) => Object.prototype.hasOwnProperty.call(properties, key));
}

function validateMarker(
  value: unknown,
  tools: readonly AiToolDefinition[],
): PendingActionMarker | null {
  if (!isRecord(value)) return null;
  if (typeof value.tool !== "string" || !isRecord(value.input)) return null;
  if (!isSafeJsonValue(value.input)) return null;

  const tool = tools.find((candidate) => candidate.name === value.tool);
  if (!tool || !hasOnlyDeclaredTopLevelKeys(value.input, tool)) return null;
  const validator = getValidator(tool);
  if (!validator || validator(value.input) !== true) return null;

  const confirmation = formatCanonicalConfirmation(tool, value.input);
  if (!confirmation) return null;

  return { tool: value.tool, input: value.input, confirmation };
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const raw = String(value);
  if (raw.includes("e") || raw.includes("E")) return raw;
  const [integer, fraction] = raw.split(".");
  const sign = integer.startsWith("-") ? "-" : "";
  const digits = sign ? integer.slice(1) : integer;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

function formatWon(value: number): string {
  // 0 은 "0만 원"이 아니라 "0원"이다. 지출 0 을 적어 보낼 때 실제로 이렇게 보였다.
  if (value === 0) return "0원";
  if (Number.isInteger(value / 10_000)) {
    return `${formatNumber(value / 10_000)}만 원`;
  }
  return `${formatNumber(value)}원`;
}

/**
 * 날짜만 한국어로 읽어준다.
 *
 * 확인 카드의 나머지는 이미 사람 말이다 — 금액은 "5,500만 원", enum 은 "업체·가족과의
 * 약속". 그런데 날짜만 `"2027-04-17"` 로 **따옴표까지 붙은 채** 나왔다. 사용자가 결혼식
 * 날짜를 바꾸기 직전에 읽는 줄이 이것이다.
 *
 * ## 따옴표를 통째로 없애지 않는 이유
 *
 * 문자열 값의 따옴표는 **줄 위조를 막는다.** 제목에 개행을 넣으면 `- 총 예산: 1원` 같은
 * 가짜 확인 줄을 만들 수 있는데, `JSON.stringify` 가 개행을 `
` 으로 접어 한 줄에
 * 가둔다. 그래서 자유 문자열은 그대로 두고, **모양이 확실한 날짜만** 바꾼다.
 *
 * 날짜 필드에는 스키마 pattern 이 없는 것도 있다(`update_wedding_date`). 그러니 스키마를
 * 믿지 말고 **값의 모양을 여기서 직접 확인한다.** 달력에 없는 날짜(2027-02-31)나 다른
 * 모양이면 따옴표 붙은 원래 표시로 돌아간다 — 이상한 값은 이상하게 보여야 한다.
 */
const DATE_FIELDS: ReadonlySet<string> = new Set([
  "wedding_date",
  "date",
  "expected_date",
  "due_date",
]);

function formatKoreanDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const utc = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(utc.getTime())) return null;
  // 2027-02-31 처럼 넘쳐서 다른 날로 굴러간 값을 거른다.
  if (utc.getUTCFullYear() !== Number(year)
    || utc.getUTCMonth() + 1 !== Number(month)
    || utc.getUTCDate() !== Number(day)) {
    return null;
  }
  return `${Number(year)}년 ${Number(month)}월 ${Number(day)}일`;
}

function formatFieldValue(key: string, value: unknown): string {
  if (typeof value === "number") {
    return WON_FIELDS.has(key) ? formatWon(value) : formatNumber(value);
  }
  if (typeof value === "boolean") {
    if (key === "done") return value ? "완료" : "미완료";
    return value ? "예" : "아니요";
  }
  if (typeof value === "string") {
    const normalized = value;
    if (key === "booking_id") {
      return JSON.stringify(`…${normalized.slice(-8)}`);
    }
    if (DATE_FIELDS.has(key)) {
      const korean = formatKoreanDate(normalized);
      if (korean) return korean;
    }
    const categoryLabel = key === "category" || key === "category_key"
      ? CATEGORY_LABELS[normalized]
      : undefined;
    const enumLabel = ENUM_VALUE_LABELS[key]?.[normalized];
    return categoryLabel ?? enumLabel ?? JSON.stringify(normalized);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "없음";
    return value.map((item, index) => {
      if (isRecord(item)) {
        const fields = Object.keys(item)
          .sort((left, right) => {
            const leftIndex = NESTED_FIELD_ORDER.indexOf(
              left as (typeof NESTED_FIELD_ORDER)[number],
            );
            const rightIndex = NESTED_FIELD_ORDER.indexOf(
              right as (typeof NESTED_FIELD_ORDER)[number],
            );
            if (leftIndex === -1 && rightIndex === -1) {
              return left < right ? -1 : left > right ? 1 : 0;
            }
            if (leftIndex === -1) return 1;
            if (rightIndex === -1) return -1;
            return leftIndex - rightIndex;
          })
          .map((nestedKey) => `${FIELD_LABELS[nestedKey] ?? nestedKey}: ${formatFieldValue(nestedKey, item[nestedKey])}`)
          .join(", ");
        return `${index + 1}) ${fields}`;
      }
      return formatFieldValue(key, item);
    }).join(" / ");
  }
  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .map((nestedKey) => `${FIELD_LABELS[nestedKey] ?? nestedKey}: ${formatFieldValue(nestedKey, value[nestedKey])}`)
      .join(", ");
  }
  return "없음";
}

/**
 * 체크리스트 항목 id를 사용자가 읽을 수 있는 이름으로 바꾼다.
 *
 * 모델은 실제 항목 id를 한 번도 받지 못한다 — 프롬프트에 들어가는 건 `할일: 3/12완료`
 * 같은 숫자뿐이다. 그런데 이 도구를 제안하려면 `item_id`를 적어야 하므로 모델은
 * 사실상 지어낸다. 그리고 확인 카드는 `item_id`를 숨겨서, 사용자에게는
 * "준비 항목 상태 변경 · 카테고리: 드레스 · 완료 여부: 완료"만 보였다.
 * 지어낸 id가 우연히 다른 실제 항목과 맞으면 엉뚱한 항목이 완료로 바뀌는데
 * 알아챌 방법이 없었다.
 *
 * 이 저장소의 안전망은 모델의 정확성이 아니라 사용자의 확인이다. 그러니 카드가
 * 어떤 항목인지 이름으로 말해야 그 안전망이 작동한다.
 *
 * 해석 대상은 실행부와 같은 표준 목록이다 — `mergeChecklist`가 template만 돌려주므로
 * (utils/checklist.ts) 저장본에만 있는 항목이란 존재하지 않는다. 즉 여기서 못 찾는
 * id는 실행부에서도 `checklist_item_not_found`로 실패할 id다. 그런 제안은 카드로
 * 만들지 않는다.
 */
function resolveChecklistItemLabel(input: Record<string, unknown>): string | null {
  const category = typeof input.category === "string" ? input.category : null;
  const itemId = typeof input.item_id === "string" ? input.item_id : null;
  if (!category || !itemId) return null;

  const items = CHECKLIST_MAP[category]?.items;
  if (!Array.isArray(items)) return null;

  const found = items.find((item) => item.id === itemId);
  return typeof found?.label === "string" && found.label.trim() ? found.label : null;
}

function formatCanonicalConfirmation(
  tool: AiToolDefinition,
  input: Record<string, unknown>,
): string | null {
  const toolLabel = TOOL_LABELS[tool.name];
  if (!toolLabel) return null;
  const declaredFields = isRecord(tool.input_schema.properties)
    ? Object.keys(tool.input_schema.properties)
    : [];
  const fieldLines = declaredFields
    .filter((key) =>
      !INTERNAL_CONFIRMATION_FIELDS.has(key)
      && Object.prototype.hasOwnProperty.call(input, key)
    )
    .map((key) => `- ${FIELD_LABELS[key] ?? key}: ${formatFieldValue(key, input[key])}`);

  if (tool.name === "toggle_checklist_item") {
    const itemLabel = resolveChecklistItemLabel(input);
    // 어떤 항목인지 말할 수 없으면 확인을 요청하지 않는다. 사용자가 확인할 수 없는
    // 변경은 승인받은 변경이 아니다.
    if (!itemLabel) return null;
    fieldLines.push(`- ${FIELD_LABELS.item_id}: ${itemLabel}`);
  }

  const confirmation = [
    CANONICAL_CONFIRMATION_OPENING,
    `- 변경: ${toolLabel}`,
    ...fieldLines,
  ].join("\n");
  return confirmation.length <= MAX_CANONICAL_CONFIRMATION_CHARS
    ? confirmation
    : null;
}

/**
 * 서버가 만드는 확인문의 첫 줄. **서버 소유 문자열이다.**
 *
 * 모델이 이 문장을 흉내 내 표식 없이 쓰면 누를 버튼이 없는 가짜 카드가 된다
 * (2026-08-22 라이브: 진짜 카드가 나오기 시작하자 모델이 이력에서 배워 재생산했고,
 * 그 턴이 다시 이력에 쌓여 **진짜 카드를 막았다**). 그래서 이 문자열은 한 곳에서만
 * 정의하고, 표식 없이 나타나면 지운다.
 */
const CANONICAL_CONFIRMATION_OPENING = "다음 변경을 적용할까요?";

/**
 * 가짜 확인문을 지운 자리에 남길 말. 침묵은 답이 아니다 — 사용자는 방금 무언가를
 * 부탁했고, 무엇을 다시 해야 하는지 알아야 한다. 서버가 소유하는 문장이라 모델이
 * 지어낸 상태를 옮겨 적지 않는다.
 */
/**
 * 한 답변에 표식이 둘 이상일 때의 안내.
 *
 * 계약은 "표식을 정확히 하나" 로 못 박고 있고, 둘이면 서버가 **둘 다** 버린다.
 * 하나만 골라 적용하면 나머지가 조용히 사라져 사용자는 둘 다 된 줄 안다 —
 * 이 저장소가 가장 싫어하는 부류다.
 *
 * 그런데 그동안 남기던 말이 "같은 요청을 한 번만 다시 보내주시겠어요?" 였다.
 * 같은 요청을 다시 보내면 또 둘이 나오므로 **무한 고리**다(2026-08-24 감사).
 * "예산 6천으로 올리고 상견례도 다음 주 토요일로 잡아줘" 처럼 두 가지를 한
 * 문장에 담는 것은 흔한 요청이다.
 *
 * 그래서 빠져나갈 방법을 알려준다.
 */
const MULTI_ACTION_REPLACEMENT =
  "한 번에 두 가지를 바꾸는 건 아직 어려워요. 하나씩 말씀해 주시면 바로 확인 카드로 만들어 드릴게요.";

const FORGED_CONFIRMATION_REPLACEMENT =
  "방금 제안을 확인 카드로 만들지 못했어요. 같은 요청을 한 번만 다시 보내주시겠어요?";

/**
 * 서버 문장을 그대로 베끼지 않고 **제 말로** 확인을 약속하는 형태.
 *
 * 계약상 보이는 확인 문장은 서버만 만든다. 그러므로 표식 없이 "확인해 주시면
 * 적용할게요" 라고 말하는 턴은 정의상 지킬 수 없는 약속이다 — 사용자가 "확인"
 * 이라고 답해도 실행할 action_id 가 없다.
 *
 * 이것을 걷어내는 두 번째 이유는 이력이다. 실측(2026-08-22, 같은 프롬프트로
 * 이력만 바꿔 10회씩):
 *
 *     이력 12턴이 모두 표식을 달고 있음        표식 10/10
 *     마지막 1턴만 표식 없는 확인 문장          표식  8/10
 *     마지막 2턴                              표식  4/10
 *     마지막 3턴                              표식  0/10
 *
 * **연속 세 번이면 그 대화는 끝난다.** 한 번의 실패가 이력에 남아 다음 실패를
 * 부르는 톱니바퀴라, 실패한 턴을 확인 문장 모양으로 남겨 두면 안 된다.
 *
 * 넓게 잡으면 정상적인 되묻기를 지우게 되므로 좁게 쓴다. 놓치는 쪽이 낫다.
 */
/**
 * **한 문장 안에서** 확인을 청하고 곧바로 반영을 약속하는 형태만 잡는다.
 *
 * 첫 판은 `[^.\n]{0,24}` 로 사이를 벌려 놨는데, 그 문자열 집합이 `?`·`!`·`,` 를
 * 통과시켜 **정규식이 문장 경계를 넘었다.** 적대적 검토가 실제로 재현했다:
 *
 *     "제가 이해한 게 맞는지 확인해 주시겠어요? 일정 변경할 부분이 있으면 알려주세요."
 *       → "확인해 주시겠어요? 일정 변경할" 이 한 매치로 잡혀 답변이 통째로 사라졌다
 *
 * 그래서 두 가지를 좁혔다. 첫째, 판정은 문장 단위로 한다(아래 `splitSentences`).
 * 둘째, 약속 쪽은 **종결어미까지** 요구한다 — "변경할 항목", "반영할 부분" 처럼
 * 명사를 꾸미는 말은 약속이 아니다.
 */
const CONFIRMATION_REQUEST_RE = /확인(?:해|하)\s*주(?:시면|세요|시겠|시길|셔야)/u;
const APPLY_PROMISE_RE =
  /(?:적용|반영|저장|변경)(?:할게요|할께요|하겠습니다|하겠어요|해\s*드릴게요|해\s*드리겠습니다|해\s*둘게요)/u;
/**
 * 이 문장이 지킬 수 없는 확인 약속인가.
 *
 * `"확인"이라고 답해주세요` 형태도 지어낸 확인이지만 **잡지 않는다.** 그 문장만
 * 봐서는 확인을 받을 상대가 아모라인지 업체인지 가를 신호가 없어서다 —
 * "업체에 “확인”이라고 답장하시면 예약이 잡혀요" 는 정상 안내인데 같은 모양이다.
 * 상대를 추측하는 규칙을 덧붙이면 이 파일이 처음에 만든 것과 같은 종류의 오탐이
 * 다시 생긴다. 놓치는 쪽을 고른다.
 */
function isForgedConfirmationSentence(sentence: string): boolean {
  return CONFIRMATION_REQUEST_RE.test(sentence)
    && APPLY_PROMISE_RE.test(sentence);
}

/**
 * 문장으로 쪼갠다. 마침표는 **뒤에 공백이나 끝이 올 때만** 문장 끝으로 본다 —
 * 그러지 않으면 `3.5`, `https://a.com/b` 한가운데가 문장 경계가 된다(검토에서
 * 실제로 지적된 형태다). `?`·`!`·줄바꿈은 그 자체로 끝이다.
 */
const SENTENCE_END_RE = /(?:\.(?=\s|$)|[!?]+|\n)+/gu;

function splitSentences(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let cursor = 0;
  SENTENCE_END_RE.lastIndex = 0;
  for (
    let match = SENTENCE_END_RE.exec(text);
    match !== null;
    match = SENTENCE_END_RE.exec(text)
  ) {
    const end = match.index + match[0].length;
    if (end > cursor) spans.push({ start: cursor, end });
    cursor = end;
  }
  if (cursor < text.length) spans.push({ start: cursor, end: text.length });
  return spans;
}

/**
 * 중재 블록 구간. 이 안은 건드리지 않는다.
 *
 * 갈등 중재 답변은 `[mediation]…[/mediation]` 안에 합의안을 담아 보내고, 서버는
 * **이 정화가 끝난 뒤에** 그 블록을 꺼낸다. 블록 안을 지우면 중재 카드가 조용히
 * 사라진다 — 오류도 남지 않는다. 검토가 재현했다.
 */
const MEDIATION_BLOCK_RE = /\[\s*mediation\s*\][\s\S]*?\[\s*\/\s*mediation\s*\]/giu;

function protectedSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  MEDIATION_BLOCK_RE.lastIndex = 0;
  for (
    let match = MEDIATION_BLOCK_RE.exec(text);
    match !== null;
    match = MEDIATION_BLOCK_RE.exec(text)
  ) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/**
 * 표식이 붙지 않은 턴에서 확인 약속을 걷어낸다.
 *
 * 서버 문장을 그대로 베낀 경우(`CANONICAL_CONFIRMATION_OPENING`)는 그 뒤가 통째로
 * 서버 형식 블록이므로 거기서부터 끝까지 자른다. 제 말로 지어낸 약속은 **그 문장만**
 * 지운다 — 매치 지점부터 끝까지 버리면 오탐 한 번에 뒤따르는 정상 답변이 전부
 * 사라진다(검토가 지적한 형태다).
 *
 * 무엇을 지웠으면 **무엇을 하면 되는지 함께 남긴다.** 앞말만 남기면 "…으로
 * 이해했어요." 로 끝나 사용자는 누를 것도 할 것도 없이 기다리게 된다.
 */
function stripForgedConfirmation(text: string): string {
  const canonicalIndex = text.indexOf(CANONICAL_CONFIRMATION_OPENING);
  const base = canonicalIndex === -1 ? text : text.slice(0, canonicalIndex);

  const protectedRanges = protectedSpans(base);
  const isProtected = (span: { start: number; end: number }) =>
    protectedRanges.some((range) => span.start < range.end && span.end > range.start);

  let kept = "";
  let removedAny = false;
  for (const span of splitSentences(base)) {
    const sentence = base.slice(span.start, span.end);
    if (!isProtected(span) && isForgedConfirmationSentence(sentence)) {
      removedAny = true;
      continue;
    }
    kept += sentence;
  }

  if (canonicalIndex === -1 && !removedAny) return text;
  const before = kept.trim();
  return before.length > 0
    ? `${before}\n\n${FORGED_CONFIRMATION_REPLACEMENT}`
    : FORGED_CONFIRMATION_REPLACEMENT;
}

// 모델은 표식을 정확한 모양으로만 내지 않는다. 실측: `[ pending_action ]`(괄호 안 공백)
// 을 내자 정확 일치 정규식이 못 잡아 **`{"tool":…}` 원문이 사용자 화면에 그대로
// 보였다**(2026-08-22). 관대하게 잡는 쪽이 안전하다 — 잡으면 카드가 되고, 못 잡으면
// 내부 계약이 새기 때문이다. 대소문자·공백만 허용하고 낱말 자체는 그대로 요구한다.
const PENDING_ACTION_OPEN_TAG = String.raw`\[\s*pending_action\s*\]`;
const PENDING_ACTION_CLOSE_TAG = String.raw`\[\s*\/\s*pending_action\s*\]`;
const PENDING_ACTION_PAIR_RE = new RegExp(
  `${PENDING_ACTION_OPEN_TAG}([\\s\\S]*?)${PENDING_ACTION_CLOSE_TAG}`,
  "gi",
);
const PENDING_ACTION_ANY_TAG_RE = new RegExp(
  `\\[\\s*\\/?\\s*pending_action\\s*\\]`,
  "i",
);

function cleanPendingActionTags(text: string): {
  cleanText: string;
  payloads: string[];
  hadPendingActionTag: boolean;
} {
  const payloads: string[] = [];
  const withoutCompleteTags = text.replace(
    PENDING_ACTION_PAIR_RE,
    (_match, payload: string) => {
      payloads.push(payload);
      return "";
    },
  );
  const danglingTagIndex = withoutCompleteTags.search(PENDING_ACTION_ANY_TAG_RE);
  const withoutDanglingTag = danglingTagIndex === -1
    ? withoutCompleteTags
    : withoutCompleteTags.slice(0, danglingTagIndex);
  return {
    cleanText: withoutDanglingTag.replace(/\n{3,}/g, "\n\n").trim(),
    payloads,
    hadPendingActionTag: payloads.length > 0 || danglingTagIndex !== -1,
  };
}

export function extractAmoraPendingAction({
  text,
  allowedTools,
  now,
  createActionId,
}: ExtractPendingActionInput): {
  cleanText: string;
  pendingAction: StoredAmoraPendingAction | null;
  hadPendingActionTag: boolean;
} {
  const { cleanText: strippedText, payloads, hadPendingActionTag } =
    cleanPendingActionTags(text);
  // 카드가 안 나오는 모든 경로에서 **가짜 확인문을 먼저 걷어낸다.** 라우트가 따로
  // 부르게 만들면 언젠가 빠뜨린다 — 이 저장소는 그 방식으로 여러 번 당했다.
  const cleanText = stripForgedConfirmation(strippedText);
  // **서로 다른** 변경을 둘 이상 낸 경우만 이 안내를 쓴다. 똑같은 표식을 두 번
  // 쓴 것은 모델이 제 말을 반복한 것이고, 사용자에게 "하나씩 말해달라" 고 하면
  // 엉뚱한 말이 된다 — 사용자는 하나만 부탁했으니까.
  if (new Set(payloads).size > 1) {
    // 하나만 적용하지 않는다 — 나머지가 조용히 사라지면 사용자는 둘 다 된 줄 안다.
    return {
      cleanText: MULTI_ACTION_REPLACEMENT,
      pendingAction: null,
      hadPendingActionTag,
    };
  }
  if (payloads.length !== 1 || payloads[0].length > MAX_PENDING_ACTION_JSON_CHARS) {
    return { cleanText, pendingAction: null, hadPendingActionTag };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloads[0]);
  } catch {
    return { cleanText, pendingAction: null, hadPendingActionTag };
  }
  const marker = validateMarker(parsed, allowedTools);
  if (!marker) {
    return { cleanText, pendingAction: null, hadPendingActionTag };
  }

  const actionId = createActionId();
  if (!ACTION_ID_RE.test(actionId)) {
    return { cleanText, pendingAction: null, hadPendingActionTag };
  }
  const identity = getAmoraToolOperationIdentity(marker.tool, marker.input);
  return {
    cleanText: marker.confirmation,
    hadPendingActionTag,
    pendingAction: {
      version: 2,
      actionId,
      tool: marker.tool,
      input: marker.input,
      inputDigest: identity.inputDigest,
      operationKey: identity.operationKey,
      confirmation: marker.confirmation,
      issuedAt: now,
      expiresAt: now + getAmoraPendingActionTtlMs(marker.tool, marker.input),
    },
  };
}

/**
 * 저장된 제안을 이력용 표식으로 되돌린다.
 *
 * 아모라의 답변은 표식이 **제거된 채** 저장된다 — 서버가 떼어 metadata 로 옮기기
 * 때문이다. 그래서 다음 턴의 이력에는 "적용할까요?" 라고만 말하고 표식은 없는
 * 아모라 턴이 쌓이고, 모델은 자기 앞 턴의 그 모양을 따라 한다. 대화가 길수록
 * 나쁜 예시가 많아진다.
 *
 * 실측(2026-08-22, 스테이징에서 같은 요청을 이력만 늘려가며 12회):
 *
 *     이력 14~24행   카드 3/6
 *     이력 26~36행   카드 0/6
 *
 * 실패한 턴은 전부 "확인해 주시면 적용할게요" 같은 **표식 없는 확인 문장**이었다.
 * 이력이 가르친 그대로다. 사용자 대화는 12턴을 훌쩍 넘으므로, 이대로면 어느
 * 순간부터 아모라가 아무것도 저장하지 못한다.
 *
 * 되붙인 표식은 제공자에게 보내는 배열에만 들어간다. 저장된 본문은 그대로다.
 */
export function renderAmoraPendingActionMarker(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (value.version !== 2) return null;
  const tool = value.tool;
  const input = value.input;
  if (typeof tool !== "string" || tool.length === 0) return null;
  if (!isRecord(input)) return null;
  let payload: string;
  try {
    payload = JSON.stringify({ tool, input });
  } catch {
    return null;
  }
  if (payload.length > MAX_PENDING_ACTION_JSON_CHARS) return null;
  return `[pending_action]${payload}[/pending_action]`;
}

/**
 * 아모라의 지난 턴을 **제공자에게 돌려줄 때**의 본문.
 *
 * 표식을 낸 턴은 표식을 되붙이고, 확인만 약속하고 표식이 없던 턴은 그 약속을
 * 걷어낸다. 둘 다 같은 이유다 — 이력은 모델에게 "아모라 턴은 이렇게 생겼다"를
 * 가르치는 자리다.
 *
 * 저장된 본문은 건드리지 않는다. 이 함수의 결과는 제공자에게 보내는 배열에만
 * 들어간다. 그래서 **이미 망가진 지난 대화도 이 경로에서 회복된다** — 정화를
 * 생성 시점에만 두면 운영에 이미 쌓인 대화는 영영 그대로다.
 */
/**
 * 이력의 표식 앞에 붙는 한 줄. 이 값이 **제안일 뿐 확정이 아님**을 모델에게 알린다.
 * 사용자에게는 보이지 않는다 — 이력은 제공자에게만 간다.
 */
// 짧게 둔다. 길게 쓰면 모델이 그 문장에 매달려 **정작 물어본 것에 답하지 않는다**
// (2026-08-23 실측: 긴 안내를 붙였더니 "총예산 얼마야?" 에 금액 대신 "그 변경들은
// 반영되지 않았습니다" 만 답했다). 표식이 사실이 아님만 알리면 된다.
const UNCONFIRMED_PROPOSAL_HISTORY_NOTE = "[미확인 제안 — 저장된 값 아님]";

/**
 * 이 아모라 턴이 **실패 안내**인가.
 *
 * 표식 없이 확인 문장만 쓴 턴은 서버가 지우고 `FORGED_CONFIRMATION_REPLACEMENT`
 * 로 바꾼다. 사용자에게는 그게 맞다 — 무엇을 다시 해야 하는지 알아야 하니까.
 *
 * 그런데 그 문장을 **모델 이력에도 그대로 보여주면** 모델은 그것을 아모라 턴의
 * 모양으로 배운다. 실측(2026-08-24): 운영 대화 최근 17개 아모라 턴 중 3개가 이
 * 안내였고, 그 뒤로 일정 취소 요청 3번 연속 카드가 나오지 않았다. 같은 일이
 * 스테이징에서도 5번 연속 재현됐다. 실패 몇 번이 그 대화를 **영구히** 망친다.
 *
 * 그래서 이 턴은 프로바이더 이력에서 뺀다. DB 와 화면은 그대로다.
 */
export function isAmoraFailedProposalNotice(content: unknown): boolean {
  return typeof content === "string"
    && content.includes(FORGED_CONFIRMATION_REPLACEMENT);
}

export function buildAmoraHistoryContent(
  content: string,
  pendingAction: unknown,
): string {
  const marker = renderAmoraPendingActionMarker(pendingAction);
  // 표식은 모델에게 "아모라 턴은 이렇게 생겼다"를 가르치려고 되붙인다. 그런데
  // 그 안의 숫자를 **현재 값으로 읽는** 부작용이 있었다.
  //
  // 실측(2026-08-23): 사용자가 "총예산 9천5백만원으로 바꿔줘"로 카드를 받고
  // 확인하지 않았는데, 다음 턴에서 아모라가 "9,500만 원에 신혼집도 포함인가요?"
  // 라고 되물었다. DB 실제 값은 7,000만 원이었다. **버려진 제안 하나가 그 뒤
  // 대화를 오염시킨다** — 팀 시연에서 카드를 한 번만 안 눌러도 바로 드러난다.
  //
  // 그래서 표식 앞에 확인되지 않았다는 한 줄을 붙인다. 표식 자체는 그대로라
  // 모양 학습 효과는 유지되고, 값이 사실이 아님만 분명해진다.
  if (marker) {
    return `${content}\n${UNCONFIRMED_PROPOSAL_HISTORY_NOTE}\n${marker}`;
  }
  return sanitizeHistoryConfirmation(content);
}

/**
 * 이력에서는 **턴을 통째로** 안내 문구로 바꾼다.
 *
 * 사용자에게 보이는 쪽은 약속 문장 하나만 지운다 — 지우는 만큼 손해이기 때문이다.
 * 그런데 그렇게 남긴 앞말("총 예산을 7,000만 원으로 바꾸는 것으로 이해했어요.")이
 * 바로 모델이 따라 하는 모양이다. 실측으로 확인했다:
 *
 *     실패 3턴, 앞말이 남은 이력          표식 3/10   (약속만 지움 — 효과 없음)
 *     실패 3턴, 턴 전체가 안내 문구        표식 10/10
 *     실패 6턴, 앞말이 남은 이력          표식 5/10
 *     실패 6턴, 턴 전체가 안내 문구        표식  7/10
 *
 * 그래서 두 경로를 가른다. 이력은 모델만 보므로 통째로 바꿔도 사용자가 잃는 것이
 * 없고, 사용자 화면은 보수적으로 둔다.
 *
 * 판정의 첫 신호는 추측이 아니다 — **서버가 직접 넣은 안내 문구**가 들어 있으면
 * 그 턴은 확인 발급에 실패한 턴이다.
 */
function sanitizeHistoryConfirmation(text: string): string {
  if (text.includes(FORGED_CONFIRMATION_REPLACEMENT)) {
    return FORGED_CONFIRMATION_REPLACEMENT;
  }
  // 고치기 전에 쌓인 지난 턴은 안내 문구가 없다. 그 경우만 문장을 살펴본다.
  if (text.includes(CANONICAL_CONFIRMATION_OPENING)) {
    return FORGED_CONFIRMATION_REPLACEMENT;
  }
  const ranges = protectedSpans(text);
  const forged = splitSentences(text).some((span) => {
    if (ranges.some((range) => span.start < range.end && span.end > range.start)) {
      return false;
    }
    return isForgedConfirmationSentence(text.slice(span.start, span.end));
  });
  return forged ? FORGED_CONFIRMATION_REPLACEMENT : text;
}

export function resolveAmoraPendingAction({
  value,
  confirmedActionId,
  allowedTools,
  now,
}: ResolvePendingActionInput): StoredAmoraPendingAction | null {
  if (typeof confirmedActionId !== "string" || !ACTION_ID_RE.test(confirmedActionId)) return null;
  if (!isRecord(value)) return null;
  if (value.version !== 2 || typeof value.actionId !== "string") return null;
  if (!ACTION_ID_RE.test(value.actionId) || value.actionId !== confirmedActionId) return null;
  if (
    typeof value.inputDigest !== "string"
    || !SHA256_HEX_RE.test(value.inputDigest)
    || typeof value.operationKey !== "string"
    || !SHA256_HEX_RE.test(value.operationKey)
  ) return null;
  if (typeof value.issuedAt !== "number" || typeof value.expiresAt !== "number") return null;
  if (!Number.isInteger(value.issuedAt) || !Number.isInteger(value.expiresAt)) return null;
  if (value.issuedAt > now || value.expiresAt <= now) return null;

  const marker = validateMarker({
    tool: value.tool,
    input: value.input,
  }, allowedTools);
  if (!marker || value.confirmation !== marker.confirmation) return null;
  const identity = getAmoraToolOperationIdentity(marker.tool, marker.input);
  if (
    value.inputDigest !== identity.inputDigest
    || value.operationKey !== identity.operationKey
  ) return null;
  if (
    value.expiresAt - value.issuedAt
    !== getAmoraPendingActionTtlMs(marker.tool, marker.input)
  ) return null;

  return {
    version: 2,
    actionId: value.actionId,
    tool: marker.tool,
    input: marker.input,
    inputDigest: identity.inputDigest,
    operationKey: identity.operationKey,
    confirmation: marker.confirmation,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  };
}

/**
 * 계약문에 넣을 한 도구의 입력 필드 설명.
 *
 * 이름을 안 알려주면 모델이 지어낸다. 그리고 지어낸 키가 하나라도 있으면
 * `hasOnlyDeclaredTopLevelKeys`가 표식을 통째로 버리는데 그건 조용하다 —
 * 2026-08-22 스테이징 실측에서 표식 10개가 전부 이렇게 사라졌다
 * (`start_time`·`end_time`·`location`, 그리고 `budget` 대신 `amount`).
 * 값이 정해진 필드는 값 목록까지 준다. 같은 함정이 enum 에서 반복되기 때문이다.
 */
function describeToolInputFields(tool: AiToolDefinition): string {
  const properties = isRecord(tool.input_schema.properties)
    ? tool.input_schema.properties
    : {};
  const required = new Set(
    Array.isArray(tool.input_schema.required)
      ? (tool.input_schema.required as unknown[]).filter(
          (name): name is string => typeof name === "string",
        )
      : [],
  );
  const fields = Object.entries(properties).map(([name, rawSchema]) => {
    const schema = isRecord(rawSchema) ? rawSchema : {};
    const type = typeof schema.type === "string" ? schema.type : "값";
    const enumValues = Array.isArray(schema.enum)
      ? schema.enum.filter((value) => typeof value === "string" || typeof value === "number")
      : [];
    // 이름만 알려주면 모델이 그 자리를 **아무 단위로나** 채운다. 2026-08-22 라이브에서
    // "총 예산을 5000만원으로" 가 `total_budget: 5000`(=5,000원)으로 저장될 뻔했다.
    // 스키마 설명("원 단위. 예: 30000000 = 3000만원")은 정확한데, 변경 도구는 provider
    // `tools` 배열에 없어서 모델이 그 설명을 볼 길이 이 계약문뿐이다.
    const description = typeof schema.description === "string"
      ? schema.description.replace(/\s+/gu, " ").trim()
      : "";
    const base = enumValues.length > 0
      ? `${type}: ${enumValues.map(String).join("|")}`
      : type;
    const detail = description ? `${base} — ${description}` : base;
    return `${name}${required.has(name) ? "*" : ""}(${detail})`;
  });
  return fields.length > 0 ? fields.join(", ") : "(입력 없음)";
}

export function buildAmoraPendingActionPrompt(
  supportedTools: readonly AiToolDefinition[],
): string {
  return [
    "[서버 발급 후속 확인 계약]",
    "- 사용자의 확인이 필요한 변경을 제안하거나 적용 여부를 물을 때는, 그 답변 안에 pending_action 표식을 **반드시 정확히 하나** 포함하세요. 표식 없이 \"적용할까요?\"만 물으면 사용자가 확인해도 실행할 방법이 없습니다.",
    "- 제안 가능한 변경 도구와 input 필드 (`*`는 필수). **아래에 없는 이름을 쓰면 표식이 통째로 버려지고 사용자는 확인 버튼을 받지 못합니다. 값을 넣을 자리가 없으면 지어내지 말고 memo 같은 선언된 필드에 넣거나 생략하세요.**",
    ...supportedTools.map(
      (tool) => `  · ${tool.name}: ${describeToolInputFields(tool)}`,
    ),
    // 필드 이름만 알려주고 이 줄을 빼면, 예전엔 다른 지어낸 키에 걸려 버려지던
    // 표식이 이제는 스키마를 통과해 **지어낸 id로 카드가 나간다.** 그래서 출처를
    // 못 박는다.
    //
    // 이 줄은 원래 "식별자는 프롬프트 문맥에 아예 없으니 되물어라" 였다. 그 전제가
    // 낡았다 — 체크리스트 id 는 2026-08-23 오전에, 일정 id 는 같은 날 실어졌다.
    // 낡은 채로 두었더니 아모라가 **정확한 항목 이름을 듣고도** "항목 ID를 알 수
    // 없다"며 사용자에게 화면에서 ID를 읽어오라고 되물었다. 사용자는 그런 걸
    // 모른다. 되묻기를 없애는 것이 아니라, 되물을 이유가 없을 때 되묻지 않게 한다.
    "- `_id`로 끝나는 필드는 **위 문맥에 적힌 값만** 쓰세요. 일정 id는 `### 등록된 일정`의 각 줄 앞(`evt_…=`)에, 체크리스트 항목 id는 카테고리 줄의 `⬜`·`✅` 바로 뒤(`invitation_02=`)에 있습니다. 문맥에 그 항목이 있으면 되묻지 말고 그 id로 표식을 내세요. 문맥에 없는 항목이면 지어내지 말고 표식 없이 어느 항목인지 되물으세요.",
    "- 표식 형식: [pending_action]{\"tool\":\"도구명\",\"input\":{...}}[/pending_action]",
    "- 모든 입력값이 확정됐을 때만 표식을 쓰세요. 값이 아직 모호하면 표식 없이 값부터 확인하세요. 보이는 확인 문장은 서버가 검증된 tool/input으로 직접 만듭니다.",
    "- 표식은 서버가 제거·검증하며, 사용자가 서버가 발급한 정확한 action_id를 바로 다음 공유 요청으로 확인한 경우에만 실행됩니다.",
    // 이 계약이 붙은 턴은 제안이 실제로 가능한 턴이다. 그런데 직전 턴에서
    // 도구가 빈 결과를 냈거나 이미 표식을 한 번 낸 뒤면, 모델이 "도구가 없다"·
    // "이 환경에서는 안 된다"며 기능 부재를 선언하는 일이 관측된다
    // (2026-07-25 실계정 E2E: 같은 문장도 첫 턴이면 표식 발화, 뒤 턴이면 거절).
    // 사용자는 이걸 버그가 아니라 제품이 원래 안 되는 것으로 받아들인다.
    "- ⚠️ 이 계약이 있는 턴에서는 변경 제안이 가능합니다. \"도구가 없다\", \"이 환경에서는 실행할 수 없다\", \"직접 수정할 수 없다\"처럼 **기능이 없다고 말하지 마세요.** 값이 확정됐으면 표식을 내고, 값이 모호하면 표식 없이 값만 되물으세요. 앞선 턴에서 다른 도구가 빈 결과를 냈거나 이미 표식을 낸 적이 있어도 이번 제안과는 무관합니다.",
  ].join("\n");
}

export function buildAmoraApprovedActionPrompt(
  action: StoredAmoraPendingAction,
): string {
  return [
    "[서버 검증 후속 실행 계약]",
    `- action_id: ${action.actionId}`,
    `- 사용자가 바로 전 제안을 확인해 서버가 ${action.tool} 변경을 직접 실행합니다.`,
    `- 확정 입력: ${JSON.stringify(action.input)}`,
    "- 대화 모델은 같은 변경 도구를 다시 호출하지 말고, SERVER_CONFIRMED_ACTION_RESULT의 실제 성공·실패만 짧고 정확하게 설명하세요.",
  ].join("\n");
}
