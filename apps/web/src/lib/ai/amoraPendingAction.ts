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

function getServerBoundInput(
  tool: AiToolDefinition,
): Record<string, unknown> | null {
  const bound = tool.input_schema["x-amora-bound-input"];
  if (bound === undefined) return {};
  if (tool.name === "add_amora_action") {
    if (
      !isRecord(bound)
      || Object.keys(bound).length !== 5
      || typeof bound.title !== "string"
      || typeof bound.description !== "string"
      || bound.category_key !== "general"
      || bound.priority !== "medium"
      || bound.source !== "chat"
    ) return null;
    return {
      title: bound.title,
      description: bound.description,
      category_key: bound.category_key,
      priority: bound.priority,
      source: bound.source,
    };
  }
  if (
    tool.name !== "add_schedule_event"
    || !isRecord(bound)
    || (Object.keys(bound).length !== 2 && Object.keys(bound).length !== 3)
    || typeof bound.moment_type !== "string"
    || typeof bound.category_key !== "string"
    || (bound.date !== undefined && typeof bound.date !== "string")
  ) return null;
  return {
    ...(typeof bound.date === "string" ? { date: bound.date } : {}),
    moment_type: bound.moment_type,
    category_key: bound.category_key,
  };
}

function validateMarker(
  value: unknown,
  tools: readonly AiToolDefinition[],
): PendingActionMarker | null {
  if (!isRecord(value)) return null;
  if (typeof value.tool !== "string" || !isRecord(value.input)) return null;
  if (!isSafeJsonValue(value.input)) return null;

  const tool = tools.find((candidate) => candidate.name === value.tool);
  if (!tool) return null;
  const fullyBoundAction = tool.name === "add_amora_action"
    && tool.input_schema["x-amora-bound-input"] !== undefined;
  if (!fullyBoundAction && !hasOnlyDeclaredTopLevelKeys(value.input, tool)) return null;
  const serverBoundInput = getServerBoundInput(tool);
  if (!serverBoundInput) return null;
  const effectiveInput = fullyBoundAction
    ? serverBoundInput
    : { ...value.input, ...serverBoundInput };
  if (
    !isSafeJsonValue(effectiveInput)
    || !hasOnlyDeclaredTopLevelKeys(effectiveInput, tool)
  ) return null;
  const validator = getValidator(tool);
  if (!validator || validator(effectiveInput) !== true) return null;

  const confirmation = formatCanonicalConfirmation(tool, effectiveInput);
  if (!confirmation) return null;

  return { tool: value.tool, input: effectiveInput, confirmation };
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
  if (Number.isInteger(value / 10_000)) {
    return `${formatNumber(value / 10_000)}만 원`;
  }
  return `${formatNumber(value)}원`;
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
  const isFirstUseBoundAction = tool.name === "add_amora_action"
    && tool.input_schema["x-amora-bound-input"] !== undefined;
  const declaredFields = isRecord(tool.input_schema.properties)
    ? Object.keys(tool.input_schema.properties)
    : [];
  const fieldLines = declaredFields
    .filter((key) =>
      !INTERNAL_CONFIRMATION_FIELDS.has(key)
      && !(isFirstUseBoundAction && ["category_key", "priority", "source"].includes(key))
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
    "다음 변경을 적용할까요?",
    `- 변경: ${toolLabel}`,
    ...fieldLines,
  ].join("\n");
  return confirmation.length <= MAX_CANONICAL_CONFIRMATION_CHARS
    ? confirmation
    : null;
}

function cleanPendingActionTags(text: string): {
  cleanText: string;
  payloads: string[];
  hadPendingActionTag: boolean;
} {
  const payloads: string[] = [];
  const withoutCompleteTags = text.replace(
    /\[pending_action\]([\s\S]*?)\[\/pending_action\]/gi,
    (_match, payload: string) => {
      payloads.push(payload);
      return "";
    },
  );
  const danglingTagIndex = withoutCompleteTags.search(/\[\/?pending_action\]/i);
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
  const { cleanText, payloads, hadPendingActionTag } = cleanPendingActionTags(text);
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

export function buildAmoraPendingActionPrompt(
  supportedToolNames: readonly string[],
  fullyServerBoundToolNames: readonly string[] = [],
): string {
  return [
    "[서버 발급 후속 확인 계약]",
    "- 사용자의 확인이 필요한 변경을 제안하거나 적용 여부를 물을 때는, 그 답변 안에 pending_action 표식을 **반드시 정확히 하나** 포함하세요. 표식 없이 \"적용할까요?\"만 물으면 사용자가 확인해도 실행할 방법이 없습니다.",
    `- 제안 가능한 변경 도구: ${supportedToolNames.join(", ")}`,
    ...(fullyServerBoundToolNames.length > 0
      ? [
          `- 서버가 입력값을 모두 고정한 도구: ${fullyServerBoundToolNames.join(", ")}. 이 도구는 추가 값을 묻거나 만들지 말고 pending_action 표식 하나만 내세요. 표식 input은 서버가 다시 검증하며, 사용자에게 보이는 확인 카드는 서버가 만듭니다.`,
        ]
      : []),
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
