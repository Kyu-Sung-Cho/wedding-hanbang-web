import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolExecutionResult } from "@/types/database.types";
import {
  MODEL_DISABLED_DESTRUCTIVE_TOOL_NAMES,
  MODEL_DISABLED_EXTERNAL_TOOL_NAMES,
  MODEL_MUTATING_TOOL_NAMES,
  WEDDING_TOOLS,
} from "@/lib/ai/tools";
import {
  executeAnalyzeContractReadiness,
  executeSimulateGuestGuarantee,
} from "@/lib/ai/tools/riskSupportTools";
import {
  executeAnalyzeQuoteWithTrustEngine,
  executeGetMarketPrice,
} from "@/lib/ai/tools/quoteMarketTools";
import { executeSearchNearbyPlaces } from "@/lib/ai/tools/placeSearchTools";
import {
  executeCheckVendorAvailability,
  executeGetVendorDetail,
  executeRecommendVendors,
  executeSearchVendors,
} from "@/lib/ai/tools/vendorTools";
import {
  executeCancelBooking,
  executeCreateBooking,
  executeGetAvailableSlots,
  executeGetMyBookings,
} from "@/lib/ai/tools/bookingTools";
import {
  executeAddScheduleEvent,
  executeDeleteScheduleEvent,
  executeGetScheduleEvents,
  executeGetScheduleSummary,
  executeLogWeddingEvent,
  executeToggleChecklistItem,
  executeUpdateScheduleEvent,
} from "@/lib/ai/tools/scheduleTools";
import {
  executeAddAmoraAction,
  executeGetAmoraActions,
  executeUpdateAmoraAction,
} from "@/lib/ai/tools/amoraActionTools";
import {
  CATEGORY_LABELS,
  CATEGORY_RATIOS,
  STATUS_LABELS,
} from "@/lib/ai/tools/planningConstants";
import { patchJourneyProgress } from "@/lib/ai/tools/progressTools";
import {
  formatWon,
  requireDestructiveConfirmation,
  subjectParticle,
  type ToolExecutionContext as ExecutionContext,
} from "@/lib/ai/tools/toolTypes";

function safeToolExecutionErrorCode(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "tool_request_aborted";
  const record = error && typeof error === "object"
    ? error as { name?: unknown; status?: unknown; code?: unknown }
    : {};
  const cleanToken = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
    return cleaned || null;
  };
  const parts = ["tool_execution_failed"];
  const name = cleanToken(record.name);
  const code = cleanToken(record.code);
  const status = typeof record.status === "number" && Number.isSafeInteger(record.status)
    ? record.status
    : null;
  if (name) parts.push(`name_${name}`);
  if (status !== null) parts.push(`status_${status}`);
  if (code) parts.push(`code_${code}`);
  return parts.join(":").slice(0, 240);
}
import { ddayInKst } from "@/lib/utils/kstDate";

export { CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";

function getAdminClient() {
  return createAdminClient();
}

type RuntimeInputSchema = {
  type?: "object" | "array" | "string" | "number" | "boolean";
  properties?: Record<string, RuntimeInputSchema>;
  required?: string[];
  items?: RuntimeInputSchema;
  enum?: unknown[];
};

type ToolInputValidationError = {
  code: string;
  path: string;
};

const MAX_TOOL_INPUT_DEPTH = 6;
const MAX_TOOL_INPUT_NODES = 250;
const MAX_TOOL_OBJECT_KEYS = 50;
const MAX_TOOL_ARRAY_ITEMS = 50;
const MAX_TOOL_STRING_LENGTH = 2_000;
const MAX_TOOL_TOTAL_STRING_LENGTH = 20_000;
const MAX_TOOL_KEY_LENGTH = 64;
const MAX_WON_AMOUNT = 10_000_000_000;
const MAX_MANWON_AMOUNT = 1_000_000;

const MUTATION_ACTION_PATTERN =
  /(추가|등록|변경|바꿔|수정|설정|저장|반영|완료|취소|삭제|초기화|업데이트|옮겨|미뤄|당겨|잡아|넣어|체크|해제|기록|update|change|set|add|save|delete|cancel)/i;
const MUTATION_TOPIC_BY_TOOL: Record<string, RegExp> = {
  update_budget: /(예산|비용|금액)/i,
  update_wedding_date: /(결혼|예식|웨딩).*(날짜|일정)|(날짜|일정).*(결혼|예식|웨딩)/i,
  update_task_status: /(준비|할 일|할일|체크|상태|진행|완료)/i,
  update_venue: /(예식장|웨딩홀|장소|venue)/i,
  update_category_budget: /(예산|비용|지출|금액)/i,
  apply_budget_plan: /(예산|배분|비용|금액)/i,
  add_custom_category: /(예산|항목|카테고리)/i,
  add_schedule_event: /(일정|스케줄|캘린더|날짜)/i,
  update_schedule_event: /(일정|스케줄|캘린더|날짜|시간)/i,
  toggle_checklist_item: /(체크|할 일|할일|준비)/i,
  add_amora_action: /(아모라|액션|할 일|할일)/i,
  log_wedding_event: /(기록|이벤트|일정|상견례|청첩장)/i,
  update_amora_action: /(아모라|액션|할 일|할일)/i,
};

function hasExplicitMutationIntent(toolName: string, userText: string | undefined): boolean {
  const topic = MUTATION_TOPIC_BY_TOOL[toolName];
  const text = userText?.trim() ?? "";
  return Boolean(topic && text.length > 0 && topic.test(text) && MUTATION_ACTION_PATTERN.test(text));
}

const WON_MONEY_FIELDS = new Set([
  "total_budget",
  "budget",
  "spent",
  "price_min",
  "price_max",
]);

const MANWON_MONEY_FIELDS = new Set([
  "contract_amount",
  "deposit_amount",
  "quote_price",
]);

const TOOL_SCHEMA_BY_NAME = new Map(
  WEDDING_TOOLS.map((tool) => [tool.name, tool.input_schema as RuntimeInputSchema])
);

function validationError(code: string, path: string): ToolInputValidationError {
  return { code, path };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inspectToolPayload(
  value: unknown,
  path: string,
  depth: number,
  state: { nodes: number; stringLength: number; seen: WeakSet<object> }
): ToolInputValidationError | null {
  state.nodes += 1;
  if (state.nodes > MAX_TOOL_INPUT_NODES) {
    return validationError("payload_too_complex", path);
  }
  if (depth > MAX_TOOL_INPUT_DEPTH) {
    return validationError("payload_too_deep", path);
  }

  if (typeof value === "string") {
    if (value.length > MAX_TOOL_STRING_LENGTH) {
      return validationError("string_too_long", path);
    }
    state.stringLength += value.length;
    if (state.stringLength > MAX_TOOL_TOTAL_STRING_LENGTH) {
      return validationError("payload_text_too_long", path);
    }
    return null;
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    return validationError("number_not_finite", path);
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_TOOL_ARRAY_ITEMS) {
      return validationError("array_too_long", path);
    }
    if (state.seen.has(value)) return validationError("cyclic_payload", path);
    state.seen.add(value);
    for (let index = 0; index < value.length; index += 1) {
      const error = inspectToolPayload(value[index], `${path}[${index}]`, depth + 1, state);
      if (error) return error;
    }
    return null;
  }

  if (value !== null && typeof value === "object") {
    if (!isPlainRecord(value)) return validationError("unsafe_object", path);
    if (state.seen.has(value)) return validationError("cyclic_payload", path);
    state.seen.add(value);

    const entries = Object.entries(value);
    if (entries.length > MAX_TOOL_OBJECT_KEYS) {
      return validationError("object_too_large", path);
    }
    for (const [key, nestedValue] of entries) {
      const keyPath = `${path}.${key}`;
      if (key.startsWith("__")) return validationError("reserved_key", keyPath);
      if (key.length > MAX_TOOL_KEY_LENGTH) return validationError("key_too_long", keyPath);
      const error = inspectToolPayload(nestedValue, keyPath, depth + 1, state);
      if (error) return error;
    }
  }

  return null;
}

function validateNumberField(
  fieldName: string,
  value: number,
  path: string
): ToolInputValidationError | null {
  if (WON_MONEY_FIELDS.has(fieldName)) {
    if (value < 0) return validationError("money_negative", path);
    if (!Number.isSafeInteger(value)) return validationError("money_not_integer", path);
    if (value > MAX_WON_AMOUNT) return validationError("money_too_large", path);
  }

  if (MANWON_MONEY_FIELDS.has(fieldName)) {
    if (value < 0) return validationError("money_negative", path);
    if (!Number.isSafeInteger(value)) return validationError("money_not_integer", path);
    if (value > MAX_MANWON_AMOUNT) return validationError("money_too_large", path);
  }

  if (fieldName === "meal_price") {
    if (value < 0) return validationError("money_negative", path);
    // 식대는 도구 계약상 만원 단위 소수 한 자리(예: 7.5만원)를 허용한다.
    if (!Number.isInteger(value * 10)) return validationError("money_precision_invalid", path);
    if (value > 1_000) return validationError("money_too_large", path);
  }

  const integerBounds: Record<string, readonly [number, number]> = {
    limit: [1, 20],
    day: [0, 6],
    estimated_guests: [0, 10_000],
    guaranteed_guests: [0, 10_000],
    confirmed_rsvp_guests: [0, 10_000],
  };
  const bounds = integerBounds[fieldName];
  if (bounds) {
    if (!Number.isSafeInteger(value)) return validationError("number_not_integer", path);
    if (value < bounds[0] || value > bounds[1]) {
      return validationError("number_out_of_range", path);
    }
  }

  if (fieldName === "no_show_rate_percent" && (value < 0 || value > 100)) {
    return validationError("number_out_of_range", path);
  }

  return null;
}

function validateAgainstSchema(
  value: unknown,
  schema: RuntimeInputSchema,
  path: string,
  fieldName = ""
): ToolInputValidationError | null {
  if (schema.enum && !schema.enum.some((allowed) => Object.is(allowed, value))) {
    return validationError("value_not_allowed", path);
  }

  switch (schema.type) {
    case "object": {
      if (!isPlainRecord(value)) return validationError("type_mismatch", path);
      const properties = schema.properties ?? {};
      const required = new Set(schema.required ?? []);

      for (const requiredKey of required) {
        if (!Object.prototype.hasOwnProperty.call(value, requiredKey)) {
          return validationError("required_field_missing", `${path}.${requiredKey}`);
        }
        const requiredValue = value[requiredKey];
        if (typeof requiredValue === "string" && requiredValue.trim().length === 0) {
          return validationError("required_string_empty", `${path}.${requiredKey}`);
        }
      }

      for (const [key, nestedValue] of Object.entries(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          return validationError("unexpected_field", `${path}.${key}`);
        }
        const error = validateAgainstSchema(nestedValue, properties[key], `${path}.${key}`, key);
        if (error) return error;
      }
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) return validationError("type_mismatch", path);
      if (!schema.items) return null;
      for (let index = 0; index < value.length; index += 1) {
        const error = validateAgainstSchema(value[index], schema.items, `${path}[${index}]`, fieldName);
        if (error) return error;
      }
      return null;
    }
    case "string":
      return typeof value === "string" ? null : validationError("type_mismatch", path);
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return validationError("type_mismatch", path);
      }
      return validateNumberField(fieldName, value, path);
    case "boolean":
      return typeof value === "boolean" ? null : validationError("type_mismatch", path);
    default:
      return validationError("unsupported_schema", path);
  }
}

function validateToolSpecificRules(
  toolName: string,
  input: Record<string, unknown>
): ToolInputValidationError | null {
  if (toolName === "delete_category" || toolName === "reset_category") {
    const category = input.category;
    const isKnownCategory = typeof category === "string" &&
      (Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category) || category === "reserve");
    const isCustomCategory = typeof category === "string" && /^custom_[A-Za-z0-9_-]{1,48}$/.test(category);
    if (!isKnownCategory && !isCustomCategory) {
      return validationError("value_not_allowed", "$.category");
    }
  }

  if (toolName === "search_vendors") {
    const min = input.price_min as number | undefined;
    const max = input.price_max as number | undefined;
    if (min !== undefined && max !== undefined && min > max) {
      return validationError("invalid_money_range", "$.price_min");
    }
  }

  if (toolName === "apply_budget_plan") {
    const allocations = input.allocations as Array<Record<string, unknown>>;
    if (allocations.length > 20) return validationError("array_too_long", "$.allocations");
    const categories = allocations.map((allocation) => allocation.category as string);
    if (new Set(categories).size !== categories.length) {
      return validationError("duplicate_category", "$.allocations");
    }
  }

  return null;
}

function validateToolInput(
  toolName: string,
  input: Record<string, unknown>
): ToolInputValidationError | null {
  const structuralError = inspectToolPayload(input, "$", 0, {
    nodes: 0,
    stringLength: 0,
    seen: new WeakSet<object>(),
  });
  if (structuralError) return structuralError;

  const schema = TOOL_SCHEMA_BY_NAME.get(toolName);
  if (!schema) return null;

  const schemaError = validateAgainstSchema(input, schema, "$", "");
  if (schemaError) return schemaError;

  return validateToolSpecificRules(toolName, input);
}

function invalidToolInputResult(
  toolName: string,
  error: ToolInputValidationError
): ToolExecutionResult {
  return {
    toolName,
    toolInput: {},
    toolOutput: {
      error: "invalid_tool_input",
      reason: error.code,
      path: error.path,
    },
    success: false,
    displayMessage: "요청 인자가 올바르지 않아 실행하지 않았습니다.",
  };
}

function trustedConfirmationRequiredResult(toolName: string): ToolExecutionResult {
  return {
    toolName,
    toolInput: {},
    toolOutput: {
      error: "trusted_confirmation_required",
      requires_confirmation: true,
      accepted_confirmation_source: "server_only",
    },
    success: false,
    displayMessage: "보호가 필요한 작업이라 현재 대화에서는 실행할 수 없습니다.",
  };
}

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolExecutionResult> {
  context.signal?.throwIfAborted();

  try {
    const validation = validateToolInput(toolName, toolInput);
    if (validation) return invalidToolInputResult(toolName, validation);

    if (MODEL_DISABLED_DESTRUCTIVE_TOOL_NAMES.has(toolName)) {
      return trustedConfirmationRequiredResult(toolName);
    }

    if (MODEL_DISABLED_EXTERNAL_TOOL_NAMES.has(toolName)) {
      return {
        toolName,
        toolInput: {},
        toolOutput: { error: "external_model_query_disabled" },
        success: false,
        displayMessage: "외부 장소 검색은 개인정보 보호 설정을 보강한 뒤 제공할 예정입니다.",
      };
    }

    // 보안상 opt-in: 호출자가 명시적으로 true를 주지 않으면 mutation은 실행하지 않는다.
    // 현재 채팅 라우트는 모든 모델 mutation을 false로 고정한다.
    if (context.allowMutations !== true && MODEL_MUTATING_TOOL_NAMES.has(toolName)) {
      return {
        toolName,
        toolInput,
        toolOutput: { error: "mutations_not_allowed_in_this_context" },
        success: false,
        displayMessage: "이 상담에서는 공유 정보나 예약을 변경하지 않습니다.",
      };
    }

    if (
      MODEL_MUTATING_TOOL_NAMES.has(toolName) &&
      !hasExplicitMutationIntent(toolName, context.currentUserText)
    ) {
      return {
        toolName,
        toolInput,
        toolOutput: {
          error: "explicit_user_mutation_intent_required",
          accepted_intent_source: "current_user_message_only",
        },
        success: false,
        displayMessage: "현재 사용자 메시지에서 변경 요청을 확인하지 못해 실행하지 않았습니다.",
      };
    }

    switch (toolName) {
      case "update_budget":
        return await executeUpdateBudget(toolInput, context);
      case "update_wedding_date":
        return await executeUpdateWeddingDate(toolInput, context);
      case "update_task_status":
        return await executeUpdateTaskStatus(toolInput, context);
      case "update_venue":
        return await executeUpdateVenue(toolInput, context);
      case "update_category_budget":
        return await executeUpdateCategoryBudget(toolInput, context);
      case "apply_budget_plan":
        return await executeApplyBudgetPlan(toolInput, context);
      case "add_custom_category":
        return await executeAddCustomCategory(toolInput, context);
      case "delete_category":
        return await executeDeleteCategory(toolInput, context);
      case "reset_category":
        return await executeResetCategory(toolInput, context);
      case "get_budget_summary":
        return executeGetBudgetSummary(context);
      case "get_schedule_summary":
        return executeGetScheduleSummary(context);
      case "get_wedding_info":
        return executeGetWeddingInfo(context);
      case "add_schedule_event":
        return await executeAddScheduleEvent(toolInput, context);
      case "update_schedule_event":
        return await executeUpdateScheduleEvent(toolInput, context);
      case "delete_schedule_event":
        return await executeDeleteScheduleEvent(toolInput, context);
      case "toggle_checklist_item":
        return await executeToggleChecklistItem(toolInput, context);
      case "get_schedule_events":
        return executeGetScheduleEvents(toolInput, context);
      case "add_amora_action":
        return await executeAddAmoraAction(toolInput, context);
      case "log_wedding_event":
        return await executeLogWeddingEvent(toolInput, context);
      case "get_amora_actions":
        return await executeGetAmoraActions(toolInput, context);
      case "update_amora_action":
        return await executeUpdateAmoraAction(toolInput, context);
      case "search_vendors":
        return await executeSearchVendors(toolInput, context);
      case "check_vendor_availability":
        return await executeCheckVendorAvailability(toolInput);
      case "recommend_vendors":
        return await executeRecommendVendors(toolInput, context);
      case "get_vendor_detail":
        return await executeGetVendorDetail(toolInput);
      case "get_available_slots":
        return await executeGetAvailableSlots(toolInput);
      case "create_booking":
        return await executeCreateBooking(toolInput, context);
      case "get_my_bookings":
        return await executeGetMyBookings(toolInput, context);
      case "cancel_booking":
        return await executeCancelBooking(toolInput, context);
      case "get_market_price":
        return executeGetMarketPrice(toolInput);
      case "analyze_contract_readiness":
        return executeAnalyzeContractReadiness(toolInput);
      case "simulate_guest_guarantee":
        return executeSimulateGuestGuarantee(toolInput);
      case "search_nearby_places":
        return await executeSearchNearbyPlaces(toolInput, context.signal);
      case "analyze_quote":
        return executeAnalyzeQuoteWithTrustEngine(toolInput);
      default:
        return {
          toolName,
          toolInput,
          toolOutput: {},
          success: false,
          displayMessage: `알 수 없는 도구: ${toolName}`,
        };
    }
  } catch (err) {
    if (context.signal?.aborted) {
      throw context.signal.reason instanceof Error ? context.signal.reason : err;
    }
    // Vendor/DB exceptions can contain request fragments or response bodies.
    // Keep only bounded non-free-text diagnostics in server logs.
    console.error("아모라 도구 실행 실패", {
      toolName,
      errorCode: safeToolExecutionErrorCode(err),
    });
    return {
      toolName,
      toolInput,
      toolOutput: { error: "tool_execution_failed" },
      success: false,
      displayMessage: "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    };
  }
}

async function executeUpdateBudget(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const newBudget = input.total_budget as number;
  const oldBudget = ctx.weddingContext.budget;

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ total_budget: newBudget })
    .eq("couple_id", ctx.coupleId);

  if (error) throw error;

  // 컨텍스트도 업데이트
  ctx.weddingContext.budget = newBudget;

  return {
    toolName: "update_budget",
    toolInput: input,
    toolOutput: { total_budget: newBudget, previous_budget: oldBudget },
    success: true,
    displayMessage: `총 예산이 ${formatWon(oldBudget)}에서 ${formatWon(newBudget)}으로 변경되었습니다.`,
  };
}
async function executeUpdateWeddingDate(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const newDate = input.wedding_date as string;
  const oldDate = ctx.weddingContext.weddingDate;

  // 1) YYYY-MM-DD 포맷 검증
  if (typeof newDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    return {
      toolName: "update_wedding_date",
      toolInput: input,
      toolOutput: {
        error: "invalid_format",
        message: `'wedding_date'는 YYYY-MM-DD 형식이어야 합니다. 받은 값: ${String(newDate)}`,
      },
      success: false,
      displayMessage: `날짜 형식이 잘못되었습니다. 다시 시도해주세요.`,
    };
  }

  // 2) 유효한 달력 날짜인지 (예: 2026-02-31 거부)
  const parsed = new Date(`${newDate}T00:00:00`);
  if (isNaN(parsed.getTime())) {
    return {
      toolName: "update_wedding_date",
      toolInput: input,
      toolOutput: { error: "invalid_date", message: `유효하지 않은 날짜: ${newDate}` },
      success: false,
      displayMessage: `유효하지 않은 날짜입니다: ${newDate}`,
    };
  }

  // 3) 과거 날짜 거부 — AI 연도 추론 실수 방어 (오늘 자정 기준)
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (parsed < todayStart) {
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return {
      toolName: "update_wedding_date",
      toolInput: input,
      toolOutput: {
        error: "past_date_rejected",
        attempted: newDate,
        today: todayIso,
        message: `${newDate}는 오늘(${todayIso}) 이전입니다. 결혼 예정일은 미래 날짜여야 합니다. 사용자에게 정확한 연도를 다시 확인하세요. (예: '내년 3월 12일' → ${now.getFullYear() + 1}-03-12)`,
      },
      success: false,
      displayMessage: `과거 날짜(${newDate})는 결혼 예정일로 설정할 수 없습니다.`,
    };
  }

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ wedding_date: newDate })
    .eq("couple_id", ctx.coupleId);

  if (error) throw error;

  ctx.weddingContext.weddingDate = newDate;

  const dDay = Math.ceil(
    (parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  return {
    toolName: "update_wedding_date",
    toolInput: input,
    toolOutput: { wedding_date: newDate, previous_date: oldDate, d_day: dDay },
    success: true,
    displayMessage: `결혼 예정일이 ${newDate}로 변경되었습니다. (D-${dDay})`,
  };
}

async function executeUpdateTaskStatus(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const category = input.category as string;
  const status = input.status as string;
  const label = CATEGORY_LABELS[category] || category;
  const statusLabel = STATUS_LABELS[status] || status;

  await patchJourneyProgress(ctx, { [category]: { category, status } });

  return {
    toolName: "update_task_status",
    toolInput: input,
    toolOutput: { category, status, label, statusLabel },
    success: true,
    displayMessage: `${label} 상태가 "${statusLabel}"(으)로 변경되었습니다.`,
  };
}

async function executeUpdateCategoryBudget(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const category = input.category as string;
  const label = CATEGORY_LABELS[category] || category;

  const existing = ctx.weddingContext.progress[category] ?? { category, status: "not_started" };
  const updates: Record<string, unknown> = { ...existing, category };
  const changes: string[] = [];

  if (input.budget !== undefined) {
    const newBudget = input.budget as number;
    updates.budget = newBudget;
    changes.push(`예산 ${formatWon(newBudget)}`);
  }
  if (input.spent !== undefined) {
    const newSpent = input.spent as number;
    updates.spent = newSpent;
    changes.push(`지출 ${formatWon(newSpent)}`);
  }

  await patchJourneyProgress(ctx, { [category]: updates });

  return {
    toolName: "update_category_budget",
    toolInput: input,
    toolOutput: { category, label, ...updates },
    success: true,
    displayMessage: `${label} ${changes.join(", ")}(으)로 설정되었습니다.`,
  };
}

// 예산 인터뷰 후 카테고리 일괄 배분 — 가중치 반영된 plan 한 번에 적용.
// allocations 합계가 total_budget 보다 작으면 잔여분은 reserve(예비비)로 자동 배정.
// intake_summary 는 decision_nodes 에 preference 로 저장돼 나중에 vendor 매칭 시 자동 참조됨.
async function executeApplyBudgetPlan(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const totalBudget = input.total_budget as number;
  const allocations = (input.allocations ?? []) as Array<{
    category: string;
    budget: number;
    rationale?: string;
  }>;
  const intakeSummary = (input.intake_summary as string | undefined) ?? "";

  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw new Error("allocations 가 비어 있어 예산 계획을 적용할 수 없습니다.");
  }

  // 합계 검증 — 초과 시 차단, 미달 시 잔여분 reserve 로 보강
  const allocSum = allocations.reduce((acc, a) => acc + (Number(a.budget) || 0), 0);
  if (allocSum > totalBudget) {
    throw new Error(
      `카테고리 합계(${formatWon(allocSum)})가 총 예산(${formatWon(totalBudget)})을 초과합니다.`
    );
  }

  // 잔여분이 있으면 reserve 에 자동 추가
  const remainder = totalBudget - allocSum;
  const finalAllocations = [...allocations];
  if (remainder > 0) {
    const reserveIdx = finalAllocations.findIndex((a) => a.category === "reserve");
    if (reserveIdx >= 0) {
      finalAllocations[reserveIdx] = {
        ...finalAllocations[reserveIdx],
        budget: finalAllocations[reserveIdx].budget + remainder,
      };
    } else {
      finalAllocations.push({
        category: "reserve",
        budget: remainder,
        rationale: "총 예산 잔여분 자동 배정",
      });
    }
  }

  // progress 갱신 — 기존 status/checklist 보존하면서 budget 만 덮어쓰기
  // 카테고리 budget 키만 patch (기존 status/checklist 등은 DB 병합으로 보존)
  const progressPatch: Record<string, unknown> = {};
  for (const alloc of finalAllocations) {
    const existing = (ctx.weddingContext.progress[alloc.category] ?? {
      category: alloc.category,
      status: "not_started",
    }) as Record<string, unknown>;
    progressPatch[alloc.category] = {
      ...existing,
      category: alloc.category,
      budget: alloc.budget,
    };
  }

  const admin = getAdminClient();
  if (!ctx.currentUserId) {
    throw new Error("apply_budget_plan requires an authenticated current user");
  }

  // 총액과 카테고리 patch는 같은 profile/couple row lock 안에서 한 번에 commit한다.
  const { data: applied, error: applyError } = await admin.rpc("apply_amora_budget_plan", {
    p_user_id: ctx.currentUserId,
    p_couple_id: ctx.coupleId,
    p_total_budget: totalBudget,
    p_progress_patch: progressPatch,
  });
  if (applyError) throw applyError;
  if (!applied || typeof applied !== "object" || Array.isArray(applied)) {
    throw new Error("apply_amora_budget_plan returned an invalid result");
  }
  const appliedProgress = (applied as { progress?: unknown }).progress;
  if (!appliedProgress || typeof appliedProgress !== "object" || Array.isArray(appliedProgress)) {
    throw new Error("apply_amora_budget_plan returned invalid progress");
  }
  ctx.weddingContext.budget = totalBudget;
  ctx.weddingContext.progress = appliedProgress as ExecutionContext["weddingContext"]["progress"];

  // intake_summary 를 decision_nodes 에 preference 로 저장 (있을 때만)
  // 다음 vendor 추천 / 갈등 중재 시 system prompt 에 자동 주입됨.
  if (intakeSummary && intakeSummary.trim().length > 0) {
    try {
      await admin.from("decision_nodes").insert({
        couple_id: ctx.coupleId,
        category: "preference",
        decision_type: "considering",
        title: "예산 인터뷰에서 드러난 우선순위",
        value: intakeSummary.trim(),
        reasoning: allocations
          .filter((a) => a.rationale && a.rationale.trim().length > 0)
          .map((a) => `${CATEGORY_LABELS[a.category] ?? a.category}: ${a.rationale}`)
          .join(" / "),
        confidence: 0.85,
        source: "amora_budget_intake",
      });
    } catch (insightErr) {
      // 저장 실패해도 예산 적용 자체는 성공으로 처리 — 사용자 흐름 우선
      console.warn("budget intake summary 저장 실패(무시):", insightErr);
    }
  }

  const lines = finalAllocations
    .filter((a) => a.budget > 0)
    .map((a) => `  • ${CATEGORY_LABELS[a.category] ?? a.category}: ${formatWon(a.budget)}`)
    .join("\n");

  return {
    toolName: "apply_budget_plan",
    toolInput: input,
    toolOutput: {
      total_budget: totalBudget,
      applied_count: finalAllocations.length,
      remainder_to_reserve: remainder,
    },
    success: true,
    displayMessage: `총 예산 ${formatWon(totalBudget)} 기준 카테고리 ${finalAllocations.length}개 배분 적용 완료${remainder > 0 ? ` (잔여 ${formatWon(remainder)} 예비비로 자동 배정)` : ""}.\n${lines}`,
  };
}

// 커스텀 카테고리 추가
async function executeAddCustomCategory(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const label = input.label as string;
  const key = `custom_${Date.now()}`;
  const updates: Record<string, unknown> = {
    category: key,
    label,
    status: "in_progress",
  };
  const changes: string[] = [];

  if (input.budget !== undefined) {
    updates.budget = input.budget as number;
    changes.push(`예산 ${formatWon(input.budget as number)}`);
  }
  if (input.spent !== undefined) {
    updates.spent = input.spent as number;
    changes.push(`지출 ${formatWon(input.spent as number)}`);
  }

  await patchJourneyProgress(ctx, { [key]: updates });

  const desc = changes.length > 0 ? ` (${changes.join(", ")})` : "";
  return {
    toolName: "add_custom_category",
    toolInput: input,
    toolOutput: { key, label, ...updates },
    success: true,
    displayMessage: `새 카테고리 "${label}"${subjectParticle(label)} 추가되었습니다${desc}.`,
  };
}

async function executeDeleteCategory(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const confirmation = requireDestructiveConfirmation(
    "delete_category",
    input,
    "카테고리를 삭제하려면 먼저 사용자 확인이 필요합니다. 삭제할 항목을 다시 확인해주세요."
  );
  if (confirmation) return confirmation;

  const key = input.category as string;
  const isKnown = key in CATEGORY_LABELS;
  const progress = ctx.weddingContext.progress as Record<string, unknown>;
  const label = isKnown
    ? CATEGORY_LABELS[key]
    : (progress[key] as Record<string, unknown>)?.label as string ?? key;

  if (isKnown) {
    // 고정 카테고리: __hidden 리스트에 추가 + progress에서 데이터 제거
    const hiddenList: string[] = (progress.__hidden as string[]) ?? [];
    if (hiddenList.includes(key)) {
      return {
        toolName: "delete_category",
        toolInput: input,
        toolOutput: { deleted: false },
        success: false,
        displayMessage: `"${label}"은(는) 이미 삭제되어 있습니다.`,
      };
    }
    // 고정 카테고리: __hidden 목록에 추가 + 해당 키 제거 (원자적)
    await patchJourneyProgress(ctx, { __hidden: [...hiddenList, key] }, [key]);
  } else {
    // 커스텀 카테고리: progress에서 완전히 제거
    if (!progress[key]) {
      return {
        toolName: "delete_category",
        toolInput: input,
        toolOutput: { deleted: false },
        success: false,
        displayMessage: `"${key}" 카테고리를 찾을 수 없습니다.`,
      };
    }
    await patchJourneyProgress(ctx, {}, [key]);
  }

  return {
    toolName: "delete_category",
    toolInput: input,
    toolOutput: { key, label, deleted: true },
    success: true,
    displayMessage: `"${label}" 카테고리가 삭제되었습니다.`,
  };
}

async function executeResetCategory(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const confirmation = requireDestructiveConfirmation(
    "reset_category",
    input,
    "카테고리 데이터를 초기화하려면 먼저 사용자 확인이 필요합니다. 초기화할 항목을 다시 확인해주세요."
  );
  if (confirmation) return confirmation;

  const key = input.category as string;
  const progress = ctx.weddingContext.progress as Record<string, unknown>;
  const isKnown = key in CATEGORY_LABELS;
  const label = isKnown
    ? CATEGORY_LABELS[key]
    : (progress[key] as Record<string, unknown>)?.label as string ?? key;

  await patchJourneyProgress(ctx, {}, [key]);

  return {
    toolName: "reset_category",
    toolInput: input,
    toolOutput: { key, label, reset: true },
    success: true,
    displayMessage: `"${label}" 카테고리의 데이터가 초기화되었습니다.`,
  };
}

async function executeUpdateVenue(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const venue = input.venue as string;
  const oldVenue = ctx.weddingContext.venue;

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ venue })
    .eq("couple_id", ctx.coupleId);

  if (error) throw error;

  ctx.weddingContext.venue = venue;

  return {
    toolName: "update_venue",
    toolInput: input,
    toolOutput: { venue, previous_venue: oldVenue },
    success: true,
    displayMessage: `예식장이 "${venue}"(으)로 설정되었습니다.`,
  };
}

function executeGetBudgetSummary(ctx: ExecutionContext): ToolExecutionResult {
  const total = ctx.weddingContext.budget;
  const progress = ctx.weddingContext.progress;

  // 실데이터만 보고한다 — 배정은 progress[key].budget(미설정 시 평균 비율 "참고치"로 표시),
  // 지출은 실제 기록된 spent/cost만. 상태 기반 추정(진행중=40% 등)으로 지출을 지어내면
  // 대시보드 실값과 모순되는 숫자를 아모라가 말하게 된다(출처 원칙 위반).
  const categories = Object.entries(CATEGORY_RATIOS).map(([key, ratio]) => {
    const p = (progress[key] ?? {}) as Record<string, unknown>;
    const hasSetBudget = typeof p.budget === "number" && Number.isFinite(p.budget as number);
    const allocated = hasSetBudget ? (p.budget as number) : Math.round(total * ratio);
    const spent =
      typeof p.spent === "number" && Number.isFinite(p.spent as number)
        ? (p.spent as number)
        : typeof p.cost === "number" && Number.isFinite(p.cost as number)
          ? (p.cost as number)
          : 0;

    return {
      key,
      label: CATEGORY_LABELS[key] || key,
      allocated,
      allocated_is_estimate: !hasSetBudget,
      spent,
      status: (p.status as string) || "not_started",
    };
  });

  const totalSpent = categories.reduce((s, c) => s + c.spent, 0);
  const remaining = total - totalSpent;
  const estimateNote = categories.some((c) => c.allocated_is_estimate)
    ? " (예산 미설정 카테고리는 평균 비율 참고치)"
    : "";

  return {
    toolName: "get_budget_summary",
    toolInput: {},
    toolOutput: {
      total_budget: total,
      total_spent: totalSpent,
      remaining,
      categories,
    },
    success: true,
    displayMessage: `총 예산 ${formatWon(total)} / 기록된 지출 ${formatWon(totalSpent)} / 잔여 ${formatWon(remaining)}${estimateNote}`,
  };
}

function executeGetWeddingInfo(ctx: ExecutionContext): ToolExecutionResult {
  const { weddingDate, budget, venue, progress } = ctx.weddingContext;

  let dDay: number | null = null;
  if (weddingDate) {
    dDay = ddayInKst(weddingDate);
  }

  const allKeys = Object.keys(CATEGORY_LABELS);
  const completedCount = allKeys.filter(
    (k) => progress[k]?.status === "completed"
  ).length;

  return {
    toolName: "get_wedding_info",
    toolInput: {},
    toolOutput: {
      wedding_date: weddingDate,
      d_day: dDay,
      venue,
      total_budget: budget,
      progress_percent: Math.round((completedCount / allKeys.length) * 100),
      completed_count: completedCount,
      total_categories: allKeys.length,
    },
    success: true,
    displayMessage: weddingDate
      ? `결혼 예정일: ${weddingDate} (D-${dDay}) / 예산: ${formatWon(budget)} / 진행률: ${Math.round((completedCount / allKeys.length) * 100)}%`
      : `결혼 예정일 미설정 / 예산: ${formatWon(budget)}`,
  };
}
