import Ajv, { type ValidateFunction } from "ajv";
import { getAmoraPendingActionTtlMs } from "@/lib/ai/amoraActionApprovalPolicy";
import { SERVER_OWNED_MISSING_CARD_NOTICE, SERVER_OWNED_UNVERIFIED_NOTICE } from "@/lib/ai/amoraPersistenceClaims";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import { CATEGORY_LABELS as AMORA_CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { ymdInKst } from "@/lib/utils/kstDate";
import { hasUnsupportedScheduleFields, UNSUPPORTED_SCHEDULE_FIELDS_NOTICE } from "@/lib/ai/amoraUnsupportedScheduleFields";

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
  add_custom_category: "맞춤 예산 항목 반영",
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
const LEGACY_TOOL_LABELS: Readonly<Record<string, string>> = {
  ...TOOL_LABELS,
  add_custom_category: "맞춤 예산 항목 추가",
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
  custom: "맞춤 항목",
  ...AMORA_CATEGORY_LABELS,
};
// 기존 발급문의 이름만 호환한다. 현재 화면 문구가 바뀌어도 허용값이 늘지 않게 고정한다.
const LEGACY_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  ...CATEGORY_LABELS,
  yedan: "두 가족에게 드릴 선물",
  pyebaek: "결혼식 뒤 전통 인사",
};
const WON_FIELDS = new Set(["total_budget", "budget", "spent"]);
const INTERNAL_CONFIRMATION_FIELDS = new Set([
  "event_id",
  "item_id",
  "action_id",
  "service_id",
]);
const NESTED_FIELD_ORDER = ["category", "label", "budget", "rationale"] as const;

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

export interface AmoraQueuedAction {
  tool: string;
  input: Record<string, unknown>;
}

export const AMORA_MAX_QUEUED_ACTIONS = 10;

export function validateAmoraQueuedAction(
  value: unknown,
  allowedTools: readonly AiToolDefinition[],
  now: number,
): AmoraQueuedAction | null {
  const marker = validateMarker(value, allowedTools, now);
  return marker ? { tool: marker.tool, input: marker.input } : null;
}

export function describeAmoraQueuedAction(
  value: unknown,
  allowedTools: readonly AiToolDefinition[],
  now: number,
): string | null {
  const marker = validateMarker(value, allowedTools, now);
  return marker?.confirmation.replace(/^다음 변경을 적용할까요\?\s*/u, "") ?? null;
}

interface ExtractPendingActionInput {
  text: string;
  allowedTools: readonly AiToolDefinition[];
  now: number;
  createActionId: () => string;
  /**
   * 커플의 저장된 일정 id. 주어지면 일정을 **가리키는** 제안(변경·취소·복원)은 이 안의
   * id 만 카드가 된다.
   *
   * 2026-09-04 스테이징 실측: 드레스 입어보기 일정을 카드로 제안만 해 두고(확인 안 함) 다음
   * 턴에 "10월 3일 오후 2시에 투어 일정 넣어줘" 라고 하자 모델이 `update_schedule_event`
   * 에 `evt_dress_tour_20261003` 이라는 **지어낸 id** 를 넣어 카드를 냈다. 누르면 실행기가
   * "수정할 일정을 찾지 못했어요" 로 끝난다 — 사용자는 두 번 확인하고 두 번 실패한다.
   */
  knownScheduleEventIds?: ReadonlySet<string>;
}

/** 저장된 일정을 가리켜야 하는 도구. `add_schedule_event` 는 새 일정이라 해당 없음. */
const SCHEDULE_TARGET_TOOLS: ReadonlySet<string> = new Set([
  "update_schedule_event",
  "cancel_schedule_event",
  "restore_schedule_event",
]);

/**
 * 지어낸 일정 id 로 온 제안을 버릴 때 남기는 말. 일반 폐기 안내("같은 요청을 한 번만
 * 다시 보내주시겠어요?")를 쓰면 같은 요청이 같은 이유로 또 버려진다 — 이 경우는 다시
 * 보내는 게 아니라 **새 일정으로** 말해야 풀린다.
 */
export const UNKNOWN_SCHEDULE_EVENT_NOTICE =
  "말씀하신 일정이 저장된 일정 목록에 없어요. 확인 카드로 제안만 되고 아직 확인하지 않은 일정은 저장되지 않은 거예요. 새 일정으로 넣으려면 날짜와 제목을 함께 다시 말해 주세요.";

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

function declaredProperties(tool: AiToolDefinition): Record<string, unknown> {
  return isRecord(tool.input_schema.properties) ? tool.input_schema.properties : {};
}

function isDeclaredField(tool: AiToolDefinition, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(declaredProperties(tool), key);
}

/**
 * 모델이 자주 쓰는 **다른 이름**을 선언된 이름으로 되돌린다. (2026-09-04)
 *
 * 예전 `hasOnlyDeclaredTopLevelKeys` 는 선언 안 된 키가 하나라도 있으면 표식을 통째로
 * 버렸다. 그 결과가 스테이징 X7 이다 — 모델이 표식을 냈는데(`pending_action_dropped`)
 * 사용자에게는 카드가 없었다. 버려진 것 중 상당수는 뜻이 분명한 **다른 이름**이다:
 * 마감일을 `deadline`·`due`·(행동 카드에서) `date` 로, 카테고리를 `category` 로,
 * 제목을 `name` 으로 쓴 것.
 *
 * 세 가지 조건을 모두 만족할 때만 이름을 바꾼다. 조건이 없으면 뜻이 뒤집힌다 —
 * 예를 들어 `update_category_budget` 의 `category` 는 그 도구가 **선언한** 필드라
 * `category_key` 로 바꾸면 예산 카테고리가 사라진다.
 *
 *  1. 이 도구가 그 별칭 이름을 선언하지 않았을 것
 *  2. 이 도구가 대상 이름을 선언했을 것
 *  3. 대상 이름이 입력에 아직 없을 것 (있으면 모델이 쓴 값을 덮지 않는다)
 *
 * 바뀐 이름은 확인 카드 본문에 그대로 보이므로, 잘못 읽었으면 사용자가 거절할 수
 * 있다. 값 자체는 손대지 않는다.
 */
const COMMON_FIELD_ALIASES: Readonly<Record<string, string>> = {
  deadline: "due_date",
  due: "due_date",
  category: "category_key",
  name: "title",
};

/**
 * 도구별 별칭. `date` 는 `add_schedule_event` 의 **필수 필드**라 전역으로 두면
 * 일정 날짜가 마감일로 옮겨간다. 행동 카드에만 준다.
 */
const TOOL_FIELD_ALIASES: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  add_amora_action: { date: "due_date" },
};

function renameAliasFields(
  input: Record<string, unknown>,
  tool: AiToolDefinition,
): Record<string, unknown> {
  const aliases = { ...COMMON_FIELD_ALIASES, ...(TOOL_FIELD_ALIASES[tool.name] ?? {}) };
  let renamed: Record<string, unknown> | null = null;
  for (const [alias, target] of Object.entries(aliases)) {
    const current = renamed ?? input;
    if (!Object.prototype.hasOwnProperty.call(current, alias)) continue;
    if (isDeclaredField(tool, alias)) continue;
    if (!isDeclaredField(tool, target)) continue;
    if (Object.prototype.hasOwnProperty.call(current, target)) continue;
    renamed = renamed ?? { ...input };
    renamed[target] = renamed[alias];
    delete renamed[alias];
  }
  return renamed ?? input;
}

/**
 * 선언 안 된 최상위 키는 **그 키만** 버린다. (2026-09-04)
 *
 * 예전에는 표식 전체를 버렸다. 그 판단의 근거는 "지어낸 키가 실행 경로로 들어가면
 * 안 된다" 였는데, 키를 버리면 그 걱정은 그대로 없어진다 — 실행기는 남은 필드만
 * 본다. 반대로 표식을 통째로 버리면 사용자는 카드를 아예 못 받는다.
 *
 * 확인 카드 본문(`formatCanonicalConfirmation`)은 **선언된 필드만** 적으므로,
 * 버린 키는 원래도 사용자에게 보이지 않았다. 즉 이 변경으로 카드가 실제보다 많이
 * 약속하게 되지 않는다.
 */
function dropUndeclaredTopLevelKeys(
  input: Record<string, unknown>,
  tool: AiToolDefinition,
): { input: Record<string, unknown>; droppedKeys: string[] } {
  const droppedKeys = Object.keys(input).filter((key) => !isDeclaredField(tool, key));
  if (droppedKeys.length === 0) return { input, droppedKeys };
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!droppedKeys.includes(key)) kept[key] = value;
  }
  return { input: kept, droppedKeys };
}

/**
 * 필수 필드만으로는 **아무것도 바꾸지 못하는** 도구들. 하나 이상이 남아야 카드다.
 *
 * 목록은 실행기(`amoraAtomicToolOperation.ts`)의 거절 조건에서 그대로 가져왔다.
 * 예: `update_category_budget` 의 required 는 `category` 하나뿐이라, 금액을
 * `amount` 라고 쓴 표식에서 그 키만 버리면 스키마는 통과하지만 사용자가 확인을
 * 누르는 순간 `invalid_category_budget` 로 거절된다. **카드를 눌렀는데 아무것도
 * 저장되지 않는 것은 카드가 안 나오는 것보다 나쁘다**(226행 주석과 같은 이유).
 *
 * 이 검사는 **키를 실제로 버렸을 때만** 돈다. 아무것도 안 버린 입력은 예전과 한
 * 글자도 다르게 판정되지 않는다 — 관대해진 경로에만 값이 있는 검사다.
 */
const EFFECTIVE_CHANGE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  update_category_budget: ["budget", "spent"],
  update_schedule_event: ["date", "time", "title", "memo"],
  update_amora_action: ["title", "description", "due_date", "priority", "status", "href"],
};

function carriesEffectiveChange(
  input: Record<string, unknown>,
  tool: AiToolDefinition,
): boolean {
  const fields = EFFECTIVE_CHANGE_FIELDS[tool.name];
  if (!fields) return true;
  return fields.some((field) => Object.prototype.hasOwnProperty.call(input, field));
}

/**
 * **선택 필드 하나가 틀렸다고 표식을 통째로 버리지 않는다.** (2026-09-04)
 *
 * 스테이징 실측: `add_amora_action` 할 일 요청 3턴 중 1턴이 `pending_action_dropped`
 * 였다. 같은 날 검증기에 후보 입력을 넣어 확인한 결과, 필수값(`title`)은 멀쩡한데
 * **선택 필드 하나** 때문에 표식 전체가 사라지는 경우가 넷이었다:
 *
 *     category_key: "한복"(한글 라벨)   카드 없음
 *     priority: "긴급"                  카드 없음
 *     source: "대화"                    카드 없음
 *     href: "/wedding/actions"          카드 없음
 *
 * 그리고 다섯째는 더 나빴다 — `due_date: "9월 25일"` 은 스키마에 pattern 이 없어
 * **검증을 통과하고 카드까지 나가지만**, 사용자가 확인을 누르면 실행기가
 * `invalid_action_due_date` 로 거절한다(amoraAtomicToolOperation.ts). 카드를 눌렀는데
 * 아무것도 저장되지 않는 것은 카드가 안 나오는 것보다 나쁘다.
 *
 * 그래서 선택 필드만 보정한다. 보정한 값은 **확인 카드 본문에 그대로 보이고**
 * 사용자가 확인하기 전까지는 아무것도 실행되지 않으므로, 틀린 보정은 사용자가
 * 거절할 수 있다. 필수 필드는 손대지 않는다 — 없거나 틀리면 지금처럼 버린다.
 */
const LENIENT_OPTIONAL_FIELD_FALLBACKS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  // 카테고리를 못 고른 것은 "일반"이라고 말할 수 있다. 중요도 기본값은 실행기의
  // 기본값(`priority ?? "medium"`)과 같은 값이라 카드 표시와 저장이 어긋나지 않는다.
  add_amora_action: { category_key: "general", priority: "medium" },
  add_schedule_event: { category_key: "general" },
};

const subSchemaValidators = new WeakMap<object, ValidateFunction | null>();

/** 이 필드 하나가 자기 스키마를 통과하는가. 컴파일할 수 없으면 손대지 않는다. */
function matchesFieldSchema(schema: Record<string, unknown>, value: unknown): boolean {
  let validator = subSchemaValidators.get(schema);
  if (validator === undefined) {
    try {
      validator = ajv.compile(schema);
    } catch {
      validator = null;
    }
    subSchemaValidators.set(schema, validator);
  }
  return validator === null ? true : validator(value) === true;
}

const LOOSE_DATE_WITH_YEAR_RE =
  /^(\d{4})\s*[-.\/년]\s*(\d{1,2})\s*[-.\/월]\s*(\d{1,2})\s*일?$/u;
const LOOSE_DATE_WITHOUT_YEAR_RE = /^(\d{1,2})\s*[-.\/월]\s*(\d{1,2})\s*일?$/u;

function toIsoDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2999) return null;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // 달력에 없는 날짜(2027-02-31)는 여기서 걸린다.
  return formatKoreanDate(iso) === null ? null : iso;
}

/**
 * 느슨하게 쓴 날짜를 `YYYY-MM-DD` 로 되돌린다. 되돌릴 수 없으면 null.
 *
 * 연도가 없으면 **오늘(KST) 이후 가장 가까운 미래**로 읽는다 — 합성 프롬프트가
 * 모델에게 시키는 해석과 같은 규칙이다("연도가 없으면 가장 가까운 미래 날짜").
 */
function repairLooseDate(value: string, now: number): string | null {
  const trimmed = value.trim();
  const withYear = LOOSE_DATE_WITH_YEAR_RE.exec(trimmed);
  if (withYear) {
    return toIsoDate(Number(withYear[1]), Number(withYear[2]), Number(withYear[3]));
  }
  const withoutYear = LOOSE_DATE_WITHOUT_YEAR_RE.exec(trimmed);
  if (!withoutYear) return null;
  const today = ymdInKst(new Date(now));
  const thisYear = Number(today.slice(0, 4));
  const month = Number(withoutYear[1]);
  const day = Number(withoutYear[2]);
  const thisYearIso = toIsoDate(thisYear, month, day);
  if (thisYearIso !== null && thisYearIso >= today) return thisYearIso;
  return toIsoDate(thisYear + 1, month, day);
}

/**
 * 선택 필드만 보정한 입력. 바꿀 것이 없으면 받은 객체를 그대로 돌려준다.
 *
 * 보정은 **없애거나 이미 선언된 값으로 바꾸는 것뿐**이다 — 새 필드를 만들지 않고
 * 필수 필드는 건드리지 않으므로, 보정된 입력은 원래 입력보다 더 많은 것을 바꾸지
 * 않는다. 저장된 입력도 보정 후 값이라, 다시 검증할 때(`resolveAmoraPendingAction`)
 * 같은 값이 그대로 통과한다.
 */
function coerceLenientOptionalFields(
  input: Record<string, unknown>,
  tool: AiToolDefinition,
  now: number,
): Record<string, unknown> {
  const fallbacks = LENIENT_OPTIONAL_FIELD_FALLBACKS[tool.name];
  if (!fallbacks) return input;
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

  let coerced: Record<string, unknown> | null = null;
  const change = (key: string, value: unknown) => {
    coerced = coerced ?? { ...input };
    if (value === undefined) delete coerced[key];
    else coerced[key] = value;
  };

  for (const [key, value] of Object.entries(input)) {
    if (required.has(key)) continue;
    const schema = properties[key];
    if (!isRecord(schema)) continue;
    // 날짜 필드는 스키마에 pattern 이 없어도 `YYYY-MM-DD` 여야 한다 — 실행기가
    // 그 모양만 받는다. 되돌릴 수 있으면 되돌리고, 없으면 뺀다.
    if (DATE_FIELDS.has(key)) {
      if (typeof value === "string" && formatKoreanDate(value.trim()) !== null) {
        if (value !== value.trim()) change(key, value.trim());
        continue;
      }
      const repaired = typeof value === "string" ? repairLooseDate(value, now) : null;
      change(key, repaired !== null && matchesFieldSchema(schema, repaired) ? repaired : undefined);
      continue;
    }
    if (matchesFieldSchema(schema, value)) continue;
    const fallback = fallbacks[key];
    change(
      key,
      fallback !== undefined && matchesFieldSchema(schema, fallback) ? fallback : undefined,
    );
  }
  return coerced ?? input;
}

function validateMarker(
  value: unknown,
  tools: readonly AiToolDefinition[],
  now: number,
): PendingActionMarker | null {
  if (!isRecord(value)) return null;
  if (typeof value.tool !== "string" || !isRecord(value.input)) return null;
  if (!isSafeJsonValue(value.input)) return null;

  const tool = tools.find((candidate) => candidate.name === value.tool);
  if (!tool) return null;
  // 담당/완료 기준은 아직 일정 승인·저장 계약에 없다. 조건만 지운 부분 카드는 내지 않는다.
  if (hasUnsupportedScheduleFields(tool.name, value.input)) return null;
  // 순서가 중요하다. 흔한 별칭을 먼저 되돌리고(`deadline` → `due_date`), 그러고도
  // 남은 선언 밖 키만 버린 뒤, 선택 필드를 보정하고, 마지막에 스키마로 검증한다.
  // 예전에는 선언 밖 키 검사가 맨 앞에 있어서 뜻이 분명한 별칭 하나에 표식이
  // 통째로 사라졌다. 필수 필드가 없거나 틀리면 아래 스키마 검증이 지금처럼 버린다.
  const renamed = renameAliasFields(value.input, tool);
  const pruned = dropUndeclaredTopLevelKeys(renamed, tool);
  if (pruned.droppedKeys.length > 0 && !carriesEffectiveChange(pruned.input, tool)) {
    return null;
  }
  const input = coerceLenientOptionalFields(pruned.input, tool, now);
  // 2026-09-04 스테이징 실측: "어머님 한복 맞추기" 할 일에 모델이 enum 셋 중
  // `/wedding/community/quote-check` 를 골라 카드에 "연결 화면: …quote-check" 가 찍혔다.
  // 카테고리를 알면 실행기의 `defaultActionHref` 가 더 정확하니 카드 단계에서 링크를
  // 비워 둔다 — 카드에도 안 보이고, 적용 때 서버 기본값이 들어간다.
  if (
    tool.name === "add_amora_action"
    && typeof input.category_key === "string"
    && input.category_key.length > 0
    && "href" in input
  ) {
    delete input.href;
  }
  const validator = getValidator(tool);
  if (!validator || validator(input) !== true) return null;

  const confirmation = formatCanonicalConfirmation(tool, input);
  if (!confirmation) return null;

  return { tool: value.tool, input, confirmation };
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

function formatFieldValue(
  key: string,
  value: unknown,
  categoryLabels: Readonly<Record<string, string>>,
): string {
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
      ? categoryLabels[normalized]
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
          .map((nestedKey) => `${FIELD_LABELS[nestedKey] ?? nestedKey}: ${formatFieldValue(nestedKey, item[nestedKey], categoryLabels)}`)
          .join(", ");
        return `${index + 1}) ${fields}`;
      }
      return formatFieldValue(key, item, categoryLabels);
    }).join(" / ");
  }
  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .map((nestedKey) => `${FIELD_LABELS[nestedKey] ?? nestedKey}: ${formatFieldValue(nestedKey, value[nestedKey], categoryLabels)}`)
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
  categoryLabels: Readonly<Record<string, string>> = CATEGORY_LABELS,
  toolLabels: Readonly<Record<string, string>> = TOOL_LABELS,
): string | null {
  const toolLabel = toolLabels[tool.name];
  if (!toolLabel) return null;
  const declaredFields = isRecord(tool.input_schema.properties)
    ? Object.keys(tool.input_schema.properties)
    : [];
  const fieldLines = declaredFields
    .filter((key) =>
      !INTERNAL_CONFIRMATION_FIELDS.has(key)
      && Object.prototype.hasOwnProperty.call(input, key)
    )
    .map((key) => `- ${FIELD_LABELS[key] ?? key}: ${formatFieldValue(key, input[key], categoryLabels)}`);

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
/**
 * 2026-09-03: 문구를 **다음 행동을 지목하는** 형태로 바꾼다.
 *
 * 옛 문구는 "하나씩 말씀해 주시면" 이라고만 해서, 남은 요청이 어떻게 되는지를
 * 말하지 않았다. 사용자는 나머지를 잃었다고 읽고 대화를 처음부터 다시 쓴다.
 * 같은 날 `buildAmoraPendingActionPrompt` 에도 같은 순서(첫 건만 표식, 나머지는
 * 본문에 적고 이어서 제안)를 적어 모델이 애초에 표식을 하나만 내게 했다.
 * 서버의 1표식 원칙 자체는 그대로다.
 */
const MULTI_ACTION_REPLACEMENT =
  "한 번에 여러 가지를 바꾸는 건 아직 어려워요. 먼저 바꾸고 싶은 것 한 가지만 말씀해 주시면 바로 확인 카드로 만들어 드리고, 나머지는 이어서 도와드릴게요.";

/**
 * 문구를 바꾸기 전(2026-09-03 이전)에 대화 이력에 쌓인 같은 성격의 안내.
 *
 * `isAmoraFailedProposalNotice` 는 **저장된 지난 턴**에도 걸린다. 상수만 바꾸면
 * 이미 DB 에 있는 옛 안내가 걸러지지 않고 프로바이더 이력으로 되돌아간다 —
 * 그러면 이 파일이 막으려던 모양 학습이 그대로 살아난다.
 */
/**
 * 첫 건을 카드로 냈을 때 **나머지가 어떻게 되는지** 알리는 서버 소유 한 줄.
 *
 * 모델이 쓴 본문은 표식이 있으면 서버 확인문으로 통째로 갈아치워지므로, 이 말을
 * 서버가 하지 않으면 사용자는 나머지 요청이 사라진 줄 안다. 계약문이 모델에게
 * 시키는 말("이 확인이 끝나면 이어서 제안")과 같은 순서를 그대로 적는다.
 */
function buildRemainingProposalNotice(count: number): string {
  return `나머지 ${count}건은 이 확인이 끝나면 이어서 제안할게요.`;
}

const LEGACY_MULTI_ACTION_REPLACEMENT =
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
/**
 * **표식을 틀리게 쓴 토큰은 지운다.**
 *
 * 2026-09-03 실측: 모델이 `[pending_action]{…}[/pending_action]` 대신
 * `[ pending_action 필요 ]` 라고 썼다. 위 추출기도 바로 위 잔여 제거기도 정확한
 * 모양만 보므로 카드가 0개가 되고, **그 내부 표식이 화면에 그대로 나갔다** —
 * 608행 주석이 예고한 실패가 다른 어형으로 다시 일어났다.
 *
 * 넓히는 것은 **지우는 쪽뿐이다.** 대괄호 한 쌍 안에 `pending_action`(대소문자·
 * 공백·밑줄/하이픈 변형)이 들어 있으면 지운다. 유효 페이로드 추출 규칙
 * (`PENDING_ACTION_PAIR_RE`)은 한 글자도 넓히지 않았다 — 근사 JSON 을 카드로
 * 만들면 사용자가 확인한 적 없는 변경이 확인 버튼을 얻는다.
 *
 * 정상 본문의 대괄호(`[참고]`, 마크다운 링크, `[etiquette:4]`)는 이 낱말을 담지
 * 않으므로 건드리지 않는다. `[^\[\]]*` 라 매치는 대괄호 한 쌍 안에 갇힌다.
 */
const PENDING_ACTION_MALFORMED_TAG_RE =
  /[ \t]*\[[^\[\]]*pending[\s_-]*action[^\[\]]*\][ \t]*/giu;

/**
 * 문자열 머리에서 괄호가 맞는 JSON 객체 하나를 잘라낸다(문자열 안의 괄호는 무시).
 * 닫는 표식이 없는 카드를 살릴 때만 쓴다. 객체가 끝나기 전에 문자열이 끝나면 null.
 */
function extractLeadingBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1 || text.slice(0, start).trim().length > 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length && index - start <= MAX_PENDING_ACTION_JSON_CHARS; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function stripMalformedPendingActionTags(text: string): {
  text: string;
  removedAny: boolean;
} {
  let removedAny = false;
  const stripped = text.replace(
    PENDING_ACTION_MALFORMED_TAG_RE,
    (match: string, offset: number, whole: string) => {
      removedAny = true;
      // 앞뒤 공백 정리. 줄 끝·줄 시작에 붙어 있으면 통째로 없애고, 문장 가운데면
      // 앞뒤 낱말이 붙지 않게 한 칸만 남긴다.
      const before = whole.slice(0, offset);
      const after = whole.slice(offset + match.length);
      return before.length === 0
        || before.endsWith("\n")
        || after.length === 0
        || after.startsWith("\n")
        ? ""
        : " ";
    },
  );
  return { text: stripped, removedAny };
}

/**
 * **대괄호 표식 없이 원시 JSON 페이로드만 나간 경우.** (2026-09-04)
 *
 * 스테이징 X3 실측: 모델이 답변 끝에 표식을 빼고
 * `{"tool":"add_amora_action","input":{…}}` 만 적었다. 위의 제거기들은 전부
 * 대괄호를 보므로 아무것도 못 잡았고, **내부 계약 모양이 사용자 화면에 그대로
 * 나갔다.** 카드도 없었다.
 *
 * 넓히는 것은 **지우는 쪽뿐이다.** 여기서 카드를 만들지는 않는다 — 그러면
 * 표식 규칙이 사실상 사라지고, 사용자가 붙여 넣은 JSON 이 카드가 될 수 있다.
 *
 * 오탐을 막으려고 네 가지를 모두 요구한다.
 *  1. 중괄호가 **균형 잡힌** 하나의 JSON 객체로 파싱될 것(문자열 안의 괄호와
 *     이스케이프를 세면서 끝을 찾는다). 정규식으로 여는 괄호부터 마지막 닫는
 *     괄호까지 잡으면 문장 속 중괄호가 함께 걸린다.
 *  2. 최상위 키가 `tool` 과 `input` **둘뿐**일 것. 사용자가 붙여 넣은 견적 JSON 은
 *     다른 키를 갖는다.
 *  3. `tool` 이 **이번 턴에 허용된 도구 이름**일 것. 모르는 이름은 우리 계약이 아니다.
 *  4. `input` 이 객체일 것.
 */
const UNTAGGED_PENDING_ACTION_START_RE = /\{\s*"(?:tool|input)"\s*:/gu;

/** `start` 의 여는 중괄호부터 짝이 맞는 닫는 중괄호 다음 자리. 못 찾으면 null. */
function findBalancedJsonObjectEnd(text: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  const limit = Math.min(text.length, start + MAX_PENDING_ACTION_JSON_CHARS);
  for (let index = start; index < limit; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") { depth += 1; continue; }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
      if (depth < 0) return null;
    }
  }
  return null;
}

function isUntaggedPendingActionPayload(
  slice: string,
  allowedToolNames: ReadonlySet<string>,
): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return false;
  }
  if (!isRecord(parsed)) return false;
  if (Object.keys(parsed).some((key) => key !== "tool" && key !== "input")) return false;
  return typeof parsed.tool === "string"
    && allowedToolNames.has(parsed.tool)
    && isRecord(parsed.input);
}

function stripUntaggedPendingActionPayloads(
  text: string,
  allowedToolNames: ReadonlySet<string>,
): { text: string; removedAny: boolean } {
  if (allowedToolNames.size === 0 || !text.includes('"tool"')) {
    return { text, removedAny: false };
  }
  let kept = "";
  let cursor = 0;
  let removedAny = false;
  UNTAGGED_PENDING_ACTION_START_RE.lastIndex = 0;
  for (
    let match = UNTAGGED_PENDING_ACTION_START_RE.exec(text);
    match !== null;
    match = UNTAGGED_PENDING_ACTION_START_RE.exec(text)
  ) {
    const start = match.index;
    if (start < cursor) continue;
    const end = findBalancedJsonObjectEnd(text, start);
    if (end === null) continue;
    if (!isUntaggedPendingActionPayload(text.slice(start, end), allowedToolNames)) continue;
    // 같은 줄에 붙은 앞뒤 공백까지 걷어낸다. 남기면 빈 줄에 공백만 뜬다.
    let from = start;
    while (from > 0 && (text[from - 1] === " " || text[from - 1] === "\t")) from -= 1;
    let to = end;
    while (to < text.length && (text[to] === " " || text[to] === "\t")) to += 1;
    // 줄 끝·줄 시작에 붙어 있으면 통째로 없애고, 문장 가운데면 앞뒤 낱말이
    // 붙지 않게 한 칸만 남긴다(`stripMalformedPendingActionTags` 와 같은 규칙).
    const atLineStart = from === 0 || text[from - 1] === "\n";
    const atLineEnd = to === text.length || text[to] === "\n";
    kept += text.slice(cursor, from) + (atLineStart || atLineEnd ? "" : " ");
    removedAny = true;
    cursor = to;
    UNTAGGED_PENDING_ACTION_START_RE.lastIndex = to;
  }
  if (!removedAny) return { text, removedAny: false };
  return { text: kept + text.slice(cursor), removedAny: true };
}

function cleanPendingActionTags(
  text: string,
  allowedToolNames: ReadonlySet<string>,
): {
  cleanText: string;
  payloads: string[];
  hadPendingActionTag: boolean;
  /** 카드가 못 나온 모양(진단용, 서버 로그에만). */
  dropShapes: string[];
  /** 여는 표식 뒤에 JSON 이 없었을 때 그 뒤 80자(진단용, 서버 로그에만). */
  droppedTailHead: string | null;
} {
  const payloads: string[] = [];
  // 2026-09-06: 스테이징 rf1 R9·페르소나 p3 T13·p6 T12·p7 T11 이 전부 payloadHeads: []
  // 로 떨어졌다 — 표식은 있었는데 **어떤 모양이었는지** 로그에 없어 고칠 수 없었다.
  // 모양(열림만·닫힘만·틀린 표식·원시 JSON)과 열린 표식 뒤 머리 80자를 남긴다.
  const dropShapes: string[] = [];
  let droppedTailHead: string | null = null;
  const withoutCompleteTags = text.replace(
    PENDING_ACTION_PAIR_RE,
    (_match, payload: string) => {
      payloads.push(payload);
      return "";
    },
  );
  const danglingTagIndex = withoutCompleteTags.search(PENDING_ACTION_ANY_TAG_RE);
  // 2026-09-05 페르소나 실측(p3 T13, p7 T11, p6 T12, p4 F3): 모델이 여는 표식과 JSON 은
  // 썼는데 닫는 표식을 안 쓰거나 출력이 거기서 끝나 payload 가 0개로 잡혔다 — 카드는
  // 사라지고 "다시 요청해주세요" 만 남았다. 여는 표식 뒤에 **괄호가 맞는 JSON 객체**가
  // 통째로 있으면 그것을 payload 로 받는다. 검증은 아래 validateMarker 가 똑같이 한다.
  if (danglingTagIndex !== -1) {
    const tail = withoutCompleteTags.slice(danglingTagIndex);
    const isOpenTag = new RegExp(`^${PENDING_ACTION_OPEN_TAG}`, "i").test(tail);
    if (isOpenTag) {
      const afterTag = tail.replace(new RegExp(`^${PENDING_ACTION_OPEN_TAG}`, "i"), "");
      const salvaged = extractLeadingBalancedJsonObject(afterTag);
      if (salvaged !== null) payloads.push(salvaged);
      else {
        dropShapes.push("open_tag_without_json");
        droppedTailHead = Array.from(afterTag.trim()).slice(0, 80).join("");
      }
    } else {
      dropShapes.push("close_tag_only");
    }
  }
  const withoutDanglingTag = danglingTagIndex === -1
    ? withoutCompleteTags
    : withoutCompleteTags.slice(0, danglingTagIndex);
  // 정확한 표식을 다 걷어낸 뒤 남은 것은 **틀리게 쓴 표식뿐이다.** 그것도 지운다.
  const malformed = stripMalformedPendingActionTags(withoutDanglingTag);
  // 이력에만 붙이는 내부 표시를 **모델이 베껴 답변에 썼다**(2026-09-04 스테이징에서
  // 두 턴). 사용자 화면에 "[미확인 제안 — 저장된 값 아님]" 이 그대로 나갔다 —
  // 무슨 말인지 알 수 없는 데다, 카드도 없는 턴이라 누를 것도 없었다.
  // 이력에 되붙이는 쪽(`buildAmoraHistoryContent`)은 그대로 두고 여기서만 지운다.
  const withoutHistoryNote = malformed.text
    .split(UNCONFIRMED_PROPOSAL_HISTORY_NOTE)
    .join("");
  // 대괄호를 아예 안 쓴 원시 페이로드도 지운다. 지우면 카드 없는 턴이 되므로
  // 아래 `hadPendingActionTag` 를 함께 켜서 안내가 붙게 한다.
  const untagged = stripUntaggedPendingActionPayloads(
    withoutHistoryNote,
    allowedToolNames,
  );
  if (malformed.removedAny) dropShapes.push("malformed_tag");
  if (untagged.removedAny) dropShapes.push("untagged_payload");
  return {
    cleanText: untagged.text.replace(/\n{3,}/g, "\n\n").trim(),
    payloads,
    dropShapes,
    droppedTailHead,
    // 틀리게 썼어도 모델이 변경을 의도했다는 뜻이다. 카드가 못 나온 사실을
    // 사용자에게 알리는 경로(`droppedPendingActionTag`)가 이 값을 본다.
    hadPendingActionTag:
      payloads.length > 0
      || danglingTagIndex !== -1
      || malformed.removedAny
      || untagged.removedAny,
  };
}

export function extractAmoraPendingAction({
  text,
  allowedTools,
  now,
  createActionId,
  knownScheduleEventIds,
}: ExtractPendingActionInput): {
  cleanText: string;
  pendingAction: StoredAmoraPendingAction | null;
  /** 아직 승인되지 않은 다음 요청. 별도 서버 metadata로만 보존한다. */
  remainingActions?: AmoraQueuedAction[];
  hadPendingActionTag: boolean;
  /** 표식은 있었지만 버린 이유가 "다시 보내면 되는" 종류가 아닐 때만 채운다. */
  dropReason?: "unknown_schedule_event" | "unsupported_schedule_fields";
  /**
   * 검증에서 버려진 표식의 원문 머리(진단용). 2026-09-04 실측: "2027년 3월 10일 드레스
   * 투어 일정 추가해줘" 가 2/2 로 카드 없이 끝났는데(본문은 카드 흉내), 서버에 원문이
   * 안 남아 어느 필드가 틀렸는지 알 길이 없었다. 라우트가 서버 로그에만 남긴다 —
   * DB 메타데이터에는 넣지 않는다.
   */
  droppedPayloadHeads?: string[];
  /** 카드가 못 나온 모양(진단용, 서버 로그에만). 카드가 나간 턴에는 없다. */
  droppedShapes?: string[];
  /** 여는 표식 뒤에 JSON 이 없었을 때 그 뒤 80자(진단용, 서버 로그에만). */
  droppedTailHead?: string | null;
} {
  const {
    cleanText: strippedText, payloads, hadPendingActionTag, dropShapes, droppedTailHead,
  } = cleanPendingActionTags(
      text,
      new Set(allowedTools.map((tool) => tool.name)),
    );
  // 카드가 안 나오는 모든 경로에서 **가짜 확인문을 먼저 걷어낸다.** 라우트가 따로
  // 부르게 만들면 언젠가 빠뜨린다 — 이 저장소는 그 방식으로 여러 번 당했다.
  const cleanText = stripForgedConfirmation(strippedText);
  // **서로 다른** 표식만 센다. 똑같은 표식을 두 번 쓴 것은 모델이 제 말을 반복한
  // 것이고, 사용자에게 "하나씩 말해달라" 고 하면 엉뚱한 말이 된다 — 사용자는
  // 하나만 부탁했으니까. (그동안은 그 경우에도 카드가 통째로 사라졌다.)
  const distinctPayloads = [...new Set(payloads)].filter(
    (payload) => payload.length <= MAX_PENDING_ACTION_JSON_CHARS,
  );
  const droppedPayloadHeads = distinctPayloads
    .slice(0, 2)
    .map((payload) => Array.from(payload).slice(0, 400).join(""));
  if (distinctPayloads.length === 0) {
    return {
      cleanText,
      pendingAction: null,
      hadPendingActionTag,
      droppedShapes: dropShapes,
      droppedTailHead,
    };
  }

  // 2026-09-04: 표식이 둘 이상이면 **전부** 버리던 것을 첫 건만 살리는 것으로 바꾼다.
  //
  // 전부 버리는 쪽을 골랐던 이유는 "나머지가 조용히 사라지면 사용자는 둘 다 된 줄
  // 안다" 였다. 그 걱정은 안내로 없앨 수 있고(아래 `buildRemainingProposalNotice`),
  // 카드를 0개로 만드는 손해는 없앨 수 없다 — 실제로 사용자는 세 건을 부탁하고
  // 아무것도 못 받았다. 확인 없이는 무엇도 실행되지 않으므로 첫 건 카드는 안전하다.
  const validMarkers: PendingActionMarker[] = [];
  const operationKeys = new Set<string>();
  for (const payload of distinctPayloads) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    if (isRecord(parsed) && typeof parsed.tool === "string" && isRecord(parsed.input)
      && allowedTools.some(tool => tool.name === parsed.tool)
      && hasUnsupportedScheduleFields(parsed.tool, parsed.input)) {
      // 일부 일정 조건이 사라지면 같은 답변의 다른 카드만 실행하도록 넘기지 않는다.
      return { cleanText: UNSUPPORTED_SCHEDULE_FIELDS_NOTICE, pendingAction: null,
        hadPendingActionTag, dropReason: "unsupported_schedule_fields" };
    }
    const candidate = validateMarker(parsed, allowedTools, now);
    if (candidate) {
      const key = getAmoraToolOperationIdentity(candidate.tool, candidate.input).operationKey;
      if (!operationKeys.has(key)) {
        operationKeys.add(key);
        validMarkers.push(candidate);
      }
    }
  }
  if (validMarkers.length > AMORA_MAX_QUEUED_ACTIONS) {
    return {
      cleanText: `한 번에 ${AMORA_MAX_QUEUED_ACTIONS}건까지 확인할 수 있어요. 먼저 처리할 항목을 나눠 말씀해 주세요. 아직 반영한 항목은 없어요.`,
      pendingAction: null,
      hadPendingActionTag,
      droppedShapes: [...dropShapes, "too_many_actions"],
    };
  }
  const marker = validMarkers[0] ?? null;
  const remainingProposalCount = Math.max(0, validMarkers.length - 1);
  if (!marker) {
    // 통과한 표식이 하나도 없다. 여러 건이었다면 다음에 무엇을 하면 되는지
    // 지목하는 안내를 남긴다(그러지 않으면 사용자는 무엇을 잃었는지 모른다).
    return {
      cleanText: distinctPayloads.length > 1 ? MULTI_ACTION_REPLACEMENT : cleanText,
      pendingAction: null,
      hadPendingActionTag,
      droppedPayloadHeads,
      droppedShapes: [...dropShapes, "payload_rejected"],
    };
  }

  if (knownScheduleEventIds) {
    if (validMarkers.some((item) => SCHEDULE_TARGET_TOOLS.has(item.tool)
      && (typeof item.input.event_id !== "string" || !knownScheduleEventIds.has(item.input.event_id)))) {
      return {
        cleanText: [cleanText.trim(), UNKNOWN_SCHEDULE_EVENT_NOTICE]
          .filter((part) => part.length > 0)
          .join("\n\n"),
        pendingAction: null,
        hadPendingActionTag,
        dropReason: "unknown_schedule_event",
      };
    }
  }

  const actionId = createActionId();
  if (!ACTION_ID_RE.test(actionId)) {
    return { cleanText, pendingAction: null, hadPendingActionTag };
  }
  const identity = getAmoraToolOperationIdentity(marker.tool, marker.input);
  return {
    cleanText: remainingProposalCount > 0
      ? [
          marker.confirmation,
          buildRemainingProposalNotice(remainingProposalCount),
        ].join("\n\n")
      : marker.confirmation,
    hadPendingActionTag,
    ...(validMarkers.length > 1 ? {
      remainingActions: validMarkers.slice(1).map((item) => ({ tool: item.tool, input: item.input })),
    } : {}),
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
  if (typeof content !== "string") return false;
  // "한 번에 두 가지" 안내도 같은 성격이다 — 카드를 못 낸 턴이고, 이력에 남으면
  // 모델이 그 모양을 배운다. 사용자가 안내대로 하나씩 나눠 말해도 카드가 점점
  // 안 나오고 "확인해 주시면 적용할게요" 같은 누를 것 없는 말만 하게 된다
  // (2026-08-24 감사). 위조 확인문만 거르던 것을 둘 다 거른다.
  return content.includes(FORGED_CONFIRMATION_REPLACEMENT)
    || content.includes(MULTI_ACTION_REPLACEMENT)
    || content.includes(LEGACY_MULTI_ACTION_REPLACEMENT)
    // 2026-09-03: 서버가 붙이는 "반영되지 않았어요" 안내도 카드를 못 낸 턴의
    // 표시다. 표식을 냈다가 버려진 턴과 거짓 저장 주장을 지운 턴이 여기 해당한다.
    // 그 턴이 이력에 남으면 모델은 "약속만 하고 표식은 없는 아모라 턴"을 배운다 —
    // 위 실측이 말하는 3연속 0/10 이 정확히 그 모양이다.
    || content.includes(SERVER_OWNED_UNVERIFIED_NOTICE)
    || content.includes(SERVER_OWNED_MISSING_CARD_NOTICE);
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
  }, allowedTools, now);
  if (!marker || typeof value.confirmation !== "string") return null;
  if (value.confirmation !== marker.confirmation) {
    const tool = allowedTools.find((candidate) => candidate.name === marker.tool);
    // 예단·폐백 이름과 맞춤 항목 문구를 고치기 전의 문장도 검증된 입력으로 전부 재구성한다.
    // 일부 문자열 교체·부분 일치는 허용하지 않고, 사용자가 본 이전 문장을 그대로 유지한다.
    const legacyConfirmation = tool
      ? formatCanonicalConfirmation(tool, marker.input, LEGACY_CATEGORY_LABELS, LEGACY_TOOL_LABELS)
      : null;
    if (value.confirmation !== legacyConfirmation) return null;
  }
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
    confirmation: value.confirmation,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  };
}

/**
 * 이 길이 이상 겹치는 꼬리만 두 번째부터 앞자리를 가리킨다.
 *
 * 가리키는 문장 자체가 40자 남짓이라 짧은 겹침까지 접으면 오히려 길어진다.
 */
const SHARED_FIELD_DESCRIPTION_MIN_CHARS = 80;

/** 두 문자열이 뒤에서부터 몇 글자나 같은가. */
function commonSuffixLength(left: string, right: string): number {
  let length = 0;
  while (
    length < left.length
    && length < right.length
    && left[left.length - 1 - length] === right[right.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}

type SharedDescriptionState = {
  anchors: { description: string; label: string }[];
};

/**
 * 앞서 통째로 실린 설명과 **꼬리가 같으면** 그 자리를 가리킨다.
 *
 * 처음엔 문자열이 정확히 같을 때만 접었는데 **한 건도 접히지 않았다.**
 * 카테고리 20개 풀이를 공유하는 세 설명이 앞머리만 서로 달랐기 때문이다
 * ("변경할 카테고리. …" / "카테고리. …" / "관련 카테고리 (선택). … general=일반, …").
 * 꼬리 기준으로 바꾸니 실제로 접힌다 — 이 함수가 헛도는지는 합성 길이 테스트가 잰다.
 *
 * 자르는 자리는 **공백 다음**으로 맞춘다. 겹치는 꼬리가 낱말 가운데서 시작하면
 * 앞머리에 조각난 낱말이 남기 때문이다.
 */
function foldRepeatedDescription(
  description: string,
  label: string,
  state: SharedDescriptionState,
): string {
  if (description.length < SHARED_FIELD_DESCRIPTION_MIN_CHARS) return description;
  for (const anchor of state.anchors) {
    let start = description.length
      - commonSuffixLength(description, anchor.description);
    if (start > 0 && description[start - 1] !== " ") {
      const boundary = description.indexOf(" ", start);
      if (boundary === -1) continue;
      start = boundary + 1;
    }
    if (description.length - start < SHARED_FIELD_DESCRIPTION_MIN_CHARS) continue;
    const folded = `${description.slice(0, start)}(${anchor.label})`;
    if (folded.length >= description.length) continue;
    return folded;
  }
  state.anchors.push({ description, label });
  return description;
}

/**
 * 계약문에 넣을 한 도구의 입력 필드 설명.
 *
 * 이름을 안 알려주면 모델이 지어낸다. 2026-08-22 스테이징 실측에서 표식 10개가
 * 전부 지어낸 키 때문에 사라졌다(`start_time`·`end_time`·`location`, 그리고
 * `budget` 대신 `amount`). 2026-09-04 부터 서버는 지어낸 키를 **그 키만** 버리므로
 * 표식이 통째로 사라지지는 않는다(`dropUndeclaredTopLevelKeys`). 그래도 지어낸
 * 자리에 담긴 값은 사라지니, 이름을 정확히 알려주는 것이 여전히 첫 방어다.
 * 값이 정해진 필드는 값 목록까지 준다. 같은 함정이 enum 에서 반복되기 때문이다.
 * (예외: 설명이 이미 `키=풀이` 로 모든 값을 적고 있으면 목록을 두 번 적지 않는다.)
 */
function describeToolInputFields(
  tool: AiToolDefinition,
  sharedDescriptions?: SharedDescriptionState,
): string {
  return describeSchemaFields(tool.input_schema, tool.name, sharedDescriptions);
}

function describeSchemaFields(
  inputSchema: Record<string, unknown>,
  fieldPath: string,
  sharedDescriptions?: SharedDescriptionState,
): string {
  const properties = isRecord(inputSchema.properties)
    ? inputSchema.properties
    : {};
  const required = new Set(
    Array.isArray(inputSchema.required)
      ? (inputSchema.required as unknown[]).filter(
          (name): name is string => typeof name === "string",
        )
      : [],
  );
  const fields = Object.entries(properties).map(([name, rawSchema]) => {
    const schema = isRecord(rawSchema) ? rawSchema : {};
    let type = typeof schema.type === "string" ? schema.type : "값";
    // 변경 도구는 provider tools에 없으므로 배열 안의 필드도 이 계약에서 알려준다.
    if (type === "array" && isRecord(schema.items)) {
      const items = schema.items;
      type = isRecord(items.properties)
        ? `array<{${describeSchemaFields(items, `${fieldPath}.${name}[]`, sharedDescriptions)}}>`
        : `array<${typeof items.type === "string" ? items.type : "값"}>`;
    } else if (type === "object" && isRecord(schema.properties)) {
      type = `object<{${describeSchemaFields(schema, `${fieldPath}.${name}`, sharedDescriptions)}}>`;
    }
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
    // 2026-09-03 카테고리 20개 풀이(352자)가 update_task_status·add_schedule_event·
    // toggle_checklist_item 에서 세 번 실려 700자를 먹었다. 합성 프롬프트는
    // 상한(48,000자)에 이미 붙어 있어서, 그 700자만큼이 저장 문맥 꼬리에서 조용히
    // 잘려 나간다. 두 번째부터는 처음 실린 자리를 가리킨다.
    const shownDescription = sharedDescriptions
      ? foldRepeatedDescription(
          description,
          `위 ${fieldPath}의 ${name} 설명과 같음`,
          sharedDescriptions,
        )
      : description;
    // 설명이 enum 값을 **하나도 빠짐없이** `키=풀이` 로 적고 있으면 값 목록을 따로
    // 붙일 이유가 없다(같은 20개를 두 번 적는 셈이다). 접힌 설명은 값이 앞자리에만
    // 있으므로 목록을 그대로 둔다 — 접힌 자리에서 값을 못 찾게 하지 않는다.
    const enumValuesSpelledOut = enumValues.length > 0
      && shownDescription === description
      && enumValues.every((value) => description.includes(`${String(value)}=`));
    const base = enumValues.length > 0 && !enumValuesSpelledOut
      ? `${type}: ${enumValues.map(String).join("|")}`
      : type;
    const detail = shownDescription ? `${base} — ${shownDescription}` : base;
    return `${name}${required.has(name) ? "*" : ""}(${detail})`;
  });
  return fields.length > 0 ? fields.join(", ") : "(입력 없음)";
}

/**
 * 화면에 아직 적용되지 않은 변경 카드가 떠 있는지 본다.
 *
 * 2026-08-25 운영 실측. 카드가 뜬 뒤 사용자가 버튼 대신 말로 승인하면
 * (`응`, `네 적용해줘`, `그렇게 해줘`, `좋아 그걸로 하자` — 4/4 전부)
 * 아모라가 카드를 모른 채 답했다. 최악은 이것이다:
 *
 *   사용자: 좋아 그걸로 하자
 *   아모라: 좋아요. 그 선택으로 진행할게요.
 *
 * 아무것도 반영되지 않았다(DB 확인 — 그 카테고리는 키조차 없었다).
 * 클라이언트는 **버튼 클릭에서만** confirmedActionId 를 보내므로, 말로 한
 * 승인은 평범한 대화 턴으로 들어온다.
 *
 * 카드의 자기 id 를 기대값으로 넘겨 `resolveAmoraPendingAction` 을 그대로
 * 태운다. 만료·서명·도구 허용까지 같은 검증을 받되 확인 id 만 요구하지 않는다.
 * 이건 실행 권한이 아니라 **읽기 신호**다 — 실제 적용은 여전히 서버가 발급한
 * action_id 를 받아야 한다.
 */
export function describeUnconfirmedAmoraPendingAction({
  value,
  allowedTools,
  now,
}: Omit<ResolvePendingActionInput, "confirmedActionId">): StoredAmoraPendingAction | null {
  if (!isRecord(value) || typeof value.actionId !== "string") return null;
  return resolveAmoraPendingAction({
    value,
    confirmedActionId: value.actionId,
    allowedTools,
    now,
  });
}

/** `_id`로 끝나는 입력 필드를 가진 도구인가. */
function declaresIdField(tool: AiToolDefinition): boolean {
  const properties = isRecord(tool.input_schema.properties)
    ? tool.input_schema.properties
    : {};
  return Object.keys(properties).some((name) => name.endsWith("_id"));
}

export function buildAmoraPendingActionPrompt(
  supportedTools: readonly AiToolDefinition[],
): string {
  // 같은 설명을 두 번째부터 접으려면 도구 줄을 **먼저** 만들어야 한다 — 처음 실린
  // 자리가 기준이 된다. 순서는 supportedTools 그대로라 같은 입력에 같은 결과다.
  const sharedDescriptions: SharedDescriptionState = { anchors: [] };
  const toolLines = supportedTools.map(
    (tool) => `  · ${tool.name}: ${describeToolInputFields(tool, sharedDescriptions)}`,
  );
  const supports = (name: string): boolean =>
    supportedTools.some((tool) => tool.name === name);
  const declaresMemoField = supportedTools.some((tool) =>
    isRecord(tool.input_schema.properties)
    && Object.keys(tool.input_schema.properties).includes("memo"));
  // 채워진 예시가 실린 턴에서는 형식 줄의 빈 자리표시자가 같은 말을 두 번 한다.
  // 프롬프트는 상한(48,000자)에 붙어 있어 그 중복이 곧 저장 문맥 꼬리를 밀어낸다.
  const markerShapeExample = supports("add_schedule_event")
    ? "표식 안은 **JSON** — 위 예시 모양 그대로."
    : "표식은 **JSON**: [pending_action]{\"tool\":\"허용 도구명\",\"input\":{\"필드명\":\"값\"}}[/pending_action].";
  return [
    "[서버 발급 후속 확인 계약]",
    "- 변경 한 건마다 pending_action 표식을 **반드시 정확히 하나** 내세요. 표식 없는 질문은 실행 불가.",
    // 2026-09-03: 옛 문장은 "첫 번째 건만 표식으로 내고" 였다. 모델이 그걸
    // **능력 부정**으로 옮겨 적었다 — 일정 3건을 한 번에 부탁하면 "한 번에 하나만
    // 등록할 수 있어요" 라고 답하고 표식을 아예 안 냈다(스테이징 일괄 등록 카드 0건).
    // 하나만 내라는 것은 표식 형식 제약이지 제품의 한계가 아니다.
    "- 여러 요청은 **첫 번째 건의 표식은 이번 답변에 반드시 내고**, 나머지도 이번 답변에 각각 표식으로 내세요(최대 10건). 서버가 순서대로 한 건씩 확인받고 성공 뒤 다음 카드를 냅니다. 실패·미확인은 완료가 아닙니다. \"한 번에 하나만 등록할 수 있어요\"처럼 말하지 마세요.",
    ...(supports("apply_budget_plan") ? [
      "- 예산은 배분 전체를 한 표식의 `apply_budget_plan` input.allocations에 담으세요. 총액만 요청하면 배분 생성 금지.",
      "- 묶음 분할 금지. 표준 분야 밖은 category:\"custom\", label:사용자 원명칭, budget:원 단위 금액. 명시 저장 요청과 모든 금액이 있으면 표식을 내세요.",
    ] : []),
    `- input(\`*\` 필수): 필수 누락은 카드 없음. ${declaresMemoField ? "memo 등 " : ""}선언된 필드만 저장됩니다.`,
    ...toolLines,
    // 필드 이름만 알려주고 이 줄을 빼면, 예전엔 다른 지어낸 키에 걸려 버려지던
    // 표식이 이제는 스키마를 통과해 **지어낸 id로 카드가 나간다.** 그래서 출처를
    // 못 박는다.
    //
    // 이 줄은 원래 "식별자는 프롬프트 문맥에 아예 없으니 되물어라" 였다. 그 전제가
    // 낡았다 — 체크리스트 id 는 2026-08-23 오전에, 일정 id 는 같은 날 실어졌다.
    // 낡은 채로 두었더니 아모라가 **정확한 항목 이름을 듣고도** "항목 ID를 알 수
    // 없다"며 사용자에게 화면에서 ID를 읽어오라고 되물었다. 사용자는 그런 걸
    // 모른다. 되묻기를 없애는 것이 아니라, 되물을 이유가 없을 때 되묻지 않게 한다.
    // 2026-09-03: `_id` 필드가 하나도 없는 턴(예산 도구만 열린 턴)에도 이 200자가
    // 실렸다. 가리킬 대상이 없는 지시라 지면만 먹는다 — 프롬프트가 상한에 붙어
    // 있는 동안에는 그 자리가 저장 문맥 꼬리를 밀어낸다.
    ...(supportedTools.some(declaresIdField) ? [
      "- `_id`로 끝나는 필드는 **위 문맥에 적힌 값만** 쓰세요. 일정 id는 `### 등록된 일정`의 각 줄 앞(`evt_…=`)에, 체크리스트 항목 id는 카테고리 줄의 `⬜`·`✅` 바로 뒤(`invitation_02=`)에 있습니다. 문맥에 그 항목이 있으면 되묻지 말고 그 id로 표식을 내세요. 문맥에 없는 항목이면 지어내지 말고 표식 없이 어느 항목인지 되물으세요.",
    ] : []),
    // 2026-09-03: 행동 카드는 **도구를 부르며 시키는 문장이 계약문 어디에도 없었다.**
    // 이름이 나오는 곳은 위 필드 목록 줄 하나뿐이라, 모델은 그 도구가 언제 쓰이는지
    // 배운 적이 없다(스테이징 행동 카드 0건). 일정·예산에는 그런 문장이 있다.
    // 필수 필드가 `title` 하나라는 것도 여기서 못 박는다 — 선택 필드 6개를 앞에 두고
    // 모델이 "무엇으로 채울지 모르겠으니 되묻자" 로 도망쳤다.
    //
    // 2026-09-04 이 줄을 줄였다. "확실할 때만 넣고 아니면 빼세요" 는 선택 필드 하나가
    // 카드를 통째로 날리던 시절의 경고인데, 이제 서버가 그 필드만 보정한다
    // (`coerceLenientOptionalFields`). 같은 자리를 일정 줄에 내준다.
    ...(supports("add_amora_action") ? [
      "- 할 일·투두·챙길 것을 추가해 달라는 요청에는 `add_amora_action` 표식을 이번 답변에 내세요. 필요한 값은 `title` 하나이고, 마감일을 함께 말했으면 `due_date` 에 넣습니다. 마감일·카테고리가 있다고 되묻지 마세요.",
    ] : []),
    // 2026-09-04 스테이징 실측: 날짜·제목이 다 적힌 일정 3건 요청에 표식이 **0개**
    // 나왔다. 답변은 "세 일정 모두 2026년 날짜로 확인했어요 … 우선 9월 10일 일정을
    // 등록할까요?" — 값을 다 알아냈으면서 물어보기만 했다. 같은 날 도구 지시 쪽에
    // "값이 다 있으면 첫 건 표식" 을 적었는데도 그랬다.
    //
    // 행동 카드는 같은 문제를 **도구를 지목한 계약 줄**로 풀었고(2026-09-03) 그 뒤
    // 카드가 나오기 시작했다. 일정에는 그 줄이 없었다 — 이름이 나오는 곳은 위
    // 필드 목록 한 줄뿐이었다. 연도 해석까지 여기서 못 박는다: 모델이 연도를
    // 확인받으려고 표식을 미루는 것이 관측된 모양이다.
    // 2026-09-04 라이브 4/4: 값이 다 적힌 일괄 요청에도 표식이 0개였고, 답변은
    // "먼저 9월 10일 일정부터 등록할까요?" 였다. 위 줄("표식을 내세요")만으로는
    // 모델이 **무엇을 적어야 하는지** 본 적이 없다 — 이름과 필드는 서로 다른 줄에
    // 흩어져 있고, 아래 형식 줄은 값이 비어 있는 자리표시자였다. 채워진 것을 하나
    // 보여준다. 자리는 같은 계약문에서 만든다: 이 줄이 `date`·`title` 을 눈으로
    // 보여주므로 위 줄의 필드 나열과 아래 형식 줄의 빈 자리표시자를 걷어낸다.
    ...(supports("add_schedule_event") ? [
      "- 일정 등록 요청에는 `add_schedule_event` 표식을 이번 답변에 내세요. 연도가 없으면 가장 가까운 미래로 넣습니다. 여러 건은 위 순차 확인 규칙을 따르세요.",
      "- 표식은 이 모양 그대로, 값만 바꿔 쓰세요: [pending_action]{\"tool\":\"add_schedule_event\",\"input\":{\"date\":\"2026-09-10\",\"title\":\"신혼집 지역 정하기\"}}[/pending_action]",
    ] : []),
    // 같은 공백이 `log_wedding_event` 에도 있었다. 다만 이 도구는 8종 준비 일정
    // 전용이라, 범위를 함께 못 박지 않으면 일반 일정까지 이쪽으로 끌어온다
    // (단건 일정 카드는 지금 잘 나가는 경로다 — 건드리지 않는다).
    ...(supports("log_wedding_event") ? [
      "- `log_wedding_event`는 위 `moment_type` 8종에 해당하는 준비 일정에만 쓰세요. 종류와 날짜가 정해졌으면 이번 답변에 표식을 내고, 8종에 없는 일정이면 이 도구를 쓰지 마세요.",
    ] : []),
    // 2026-09-03 라이브 실측: 모델이 `[ pending_action 필요 ]` 라고 우리말 자리표시자를
    // 냈고 잔여 제거기가 그것을 지웠다 — 사용자에게는 카드도 본문도 없는 턴이 됐다.
    // 옛 줄은 `{...}` 라는 자리표시자 한 줄뿐이라 "여기에 필요한 말을 적어라" 로 읽혔다.
    // 바로 아래 [mediation] 규칙("마커 안은 평문 문장만")이 위치상 이 표식에도
    // 읽히던 것까지 여기서 끊는다.
    `- ${markerShapeExample} \`[ pending_action 필요 ]\`는 무효. 평문 마커는 [mediation] 전용.`,
    "- 모호한 필수값만 질문하세요. 서버가 tool/input을 검증해 확인 문구를 만듭니다.",
    // 윗줄의 "모호하면 되물어라" 를 모델이 **선택 필드까지** 적용했다. 필수 1개·선택
    // 6개인 도구에서는 그게 곧 영원한 되묻기다.
    // 2026-09-04: 꼬리("확실하지 않은 것은 빼세요")를 뗐다. 선택 필드가 목록 밖
    // 값이거나 날짜 모양이 아니면 이제 서버가 그 필드만 보정하거나 뺀다
    // (`coerceLenientOptionalFields`) — 모델에게 시킬 이유가 없는 말이 됐다.
    // 되묻기로 도망가지 말라는 앞부분은 그대로 둔다.
    "- 선택 필드는 생략 가능. 사용자 말에 필수값(`*`)이 있으면 바로 표식을 내세요.",
    // 표식 없이 값만 나열하고 "등록할까요?" 로 끝난 답변이 라이브에서 반복됐다.
    // 사용자 화면에는 누를 것이 없다.
    "- 서버가 표식을 제거하고 목록·버튼을 만듭니다.",
    "- 서버 발급의 정확한 action_id를 사용자가 바로 다음 공유 요청으로 확인해야 실행됩니다.",
    // 이 계약이 붙은 턴은 제안이 실제로 가능한 턴이다. 그런데 직전 턴에서
    // 도구가 빈 결과를 냈거나 이미 표식을 한 번 낸 뒤면, 모델이 "도구가 없다"·
    // "이 환경에서는 안 된다"며 기능 부재를 선언하는 일이 관측된다
    // (2026-07-25 실계정 E2E: 같은 문장도 첫 턴이면 표식 발화, 뒤 턴이면 거절).
    // 사용자는 이걸 버그가 아니라 제품이 원래 안 되는 것으로 받아들인다.
    "- **기능이 없다고 말하지 마세요.** 앞선 턴에서 다른 도구가 빈 결과를 냈거나 표식을 냈어도 이번 제안은 가능합니다.",
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
