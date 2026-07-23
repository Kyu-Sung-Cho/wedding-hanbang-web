import Ajv, { type ValidateFunction } from "ajv";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

const PENDING_ACTION_TTL_MS = 10 * 60 * 1_000;
const MAX_PENDING_ACTION_JSON_CHARS = 4_000;
const MAX_CANONICAL_CONFIRMATION_CHARS = 2_000;
const MAX_JSON_KEY_CHARS = 120;
const ACTION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const UNSAFE_DISPLAY_CONTROL_RE = /[\p{Cc}\u2028\u2029]/u;
const UNSAFE_DISPLAY_FORMAT_RE = /\p{Cf}/u;
const TOOL_LABELS: Readonly<Record<string, string>> = {
  update_budget: "총 결혼 예산 변경",
  update_wedding_date: "결혼 예정일 변경",
  update_task_status: "준비 항목 상태 변경",
  update_venue: "예식장 변경",
  update_category_budget: "카테고리 예산·지출 변경",
  apply_budget_plan: "예산 배분안 적용",
  add_custom_category: "맞춤 예산 항목 추가",
  delete_category: "예산 항목 삭제",
  reset_category: "예산 항목 초기화",
  add_schedule_event: "일정 추가",
  update_schedule_event: "일정 변경",
  delete_schedule_event: "일정 삭제",
  toggle_checklist_item: "체크리스트 상태 변경",
  add_amora_action: "아모라 행동 카드 추가",
  update_amora_action: "아모라 행동 카드 변경",
  log_wedding_event: "웨딩 일정 기억",
  create_booking: "업체 예약 요청",
  cancel_booking: "업체 예약 취소",
};
const FIELD_LABELS: Readonly<Record<string, string>> = {
  total_budget: "총 예산",
  wedding_date: "결혼 예정일",
  category: "카테고리",
  status: "상태",
  venue: "예식장",
  budget: "예산",
  spent: "지출",
  allocations: "카테고리별 배분",
  intake_summary: "배분 근거",
  rationale: "배분 이유",
  label: "항목 이름",
  confirmed: "사용자 확인",
  date: "날짜",
  title: "제목",
  memo: "메모",
  category_key: "관련 카테고리",
  event_id: "일정 식별자",
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
  booking_id: "예약 식별자",
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
    family_greeting: "양가 첫인사",
    sanggyeonrye: "상견례",
    venue_tour: "예식장 투어",
    dress_tour: "드레스 투어",
    studio_shoot: "스튜디오 촬영",
    dress_fitting: "드레스 피팅",
    invitation_meeting: "청첩장 모임",
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
};
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  general: "일반",
  meeting: "상견례",
  venue: "예식장",
  studio: "스튜디오",
  dress: "드레스·턱시도",
  makeup: "메이크업",
  ring: "예물",
  hanbok: "한복",
  yedan: "예단",
  honeymoon: "신혼여행",
  houseware: "혼수",
  housing: "신혼집",
  invitation: "청첩장",
  snap: "본식 스냅·영상",
  shoes: "웨딩 구두",
  bouquet: "부케",
  gift: "답례품",
  mc: "사회·축가",
  ham: "함",
  pyebaek: "폐백",
  reserve: "예비비",
};
const WON_FIELDS = new Set(["total_budget", "budget", "spent"]);
const NESTED_FIELD_ORDER = ["category", "budget", "rationale"] as const;

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  strictNumbers: true,
  coerceTypes: false,
});
const validators = new WeakMap<object, ValidateFunction>();

export interface StoredAmoraPendingAction {
  version: 1;
  actionId: string;
  tool: string;
  input: Record<string, unknown>;
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
    .filter((key) => Object.prototype.hasOwnProperty.call(input, key))
    .map((key) => `- ${FIELD_LABELS[key] ?? key}: ${formatFieldValue(key, input[key])}`);
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
  return {
    cleanText: marker.confirmation,
    hadPendingActionTag,
    pendingAction: {
      version: 1,
      actionId,
      tool: marker.tool,
      input: marker.input,
      confirmation: marker.confirmation,
      issuedAt: now,
      expiresAt: now + PENDING_ACTION_TTL_MS,
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
  if (value.version !== 1 || typeof value.actionId !== "string") return null;
  if (!ACTION_ID_RE.test(value.actionId) || value.actionId !== confirmedActionId) return null;
  if (typeof value.issuedAt !== "number" || typeof value.expiresAt !== "number") return null;
  if (!Number.isInteger(value.issuedAt) || !Number.isInteger(value.expiresAt)) return null;
  if (value.issuedAt > now || value.expiresAt <= now) return null;
  if (value.expiresAt - value.issuedAt !== PENDING_ACTION_TTL_MS) return null;

  const marker = validateMarker({
    tool: value.tool,
    input: value.input,
  }, allowedTools);
  if (!marker || value.confirmation !== marker.confirmation) return null;

  return {
    version: 1,
    actionId: value.actionId,
    tool: marker.tool,
    input: marker.input,
    confirmation: marker.confirmation,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  };
}

export function buildAmoraPendingActionPrompt(
  supportedToolNames: readonly string[],
): string {
  return [
    "[서버 발급 후속 확인 계약]",
    "- 사용자의 확인이 필요한 변경을 제안하거나 적용 여부를 물을 때는, 그 답변 안에 pending_action 표식을 **반드시 정확히 하나** 포함하세요. 표식 없이 \"적용할까요?\"만 물으면 사용자가 확인해도 실행할 방법이 없습니다.",
    `- 제안 가능한 변경 도구: ${supportedToolNames.join(", ")}`,
    "- 표식 형식: [pending_action]{\"tool\":\"도구명\",\"input\":{...}}[/pending_action]",
    "- 모든 입력값이 확정됐을 때만 표식을 쓰세요. 값이 아직 모호하면 표식 없이 값부터 확인하세요. 보이는 확인 문장은 서버가 검증된 tool/input으로 직접 만듭니다.",
    "- 표식은 서버가 제거·검증하며, 사용자가 서버가 발급한 정확한 action_id를 바로 다음 공유 요청으로 확인한 경우에만 실행됩니다.",
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
