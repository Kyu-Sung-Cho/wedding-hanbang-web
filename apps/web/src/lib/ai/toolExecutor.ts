import { getJourneyProgressCounts } from "@hanbang/shared";
import type { ToolExecutionResult } from "@/types/database.types";
import {
  RETIRED_AMORA_ACTION_TOOL_NAMES,
  RETIRED_AMORA_MUTATION_TOOL_NAMES,
  RETIRED_EXTERNAL_PLACE_TOOL_NAMES,
  RETIRED_PRODUCT_TOOL_NAMES,
  RETIRED_UNTRUSTED_TOOL_NAMES,
  RETIRED_VENDOR_BOOKING_TOOL_NAMES,
  WEDDING_TOOLS,
} from "@/lib/ai/tools";
import { executeGetMarketPrice } from "@/lib/ai/tools/marketPriceTools";
import {
  executeGetScheduleEvents,
  executeGetScheduleSummary,
} from "@/lib/ai/tools/scheduleTools";
import {
  CATEGORY_LABELS,
} from "@/lib/ai/tools/planningConstants";
import {
  formatWon,
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

  return null;
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

function retiredReadOnlyBoundaryResult(
  toolName: string,
  error: "retired_amora_mutation_tool" | "retired_external_place_tool",
): ToolExecutionResult {
  return {
    toolName,
    toolInput: {},
    toolOutput: { error },
    success: false,
    displayMessage:
      error === "retired_amora_mutation_tool"
        ? "아모라는 기록을 변경하지 않습니다. 일정·체크리스트·예식 정보는 해당 화면에서 직접 기록해 주세요."
        : "아모라는 외부 장소 검색을 제공하지 않습니다. 공식 지도나 업체 채널에서 직접 확인해 주세요.",
  };
}

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolExecutionResult> {
  if (RETIRED_AMORA_MUTATION_TOOL_NAMES.has(toolName)) {
    return retiredReadOnlyBoundaryResult(toolName, "retired_amora_mutation_tool");
  }
  if (RETIRED_EXTERNAL_PLACE_TOOL_NAMES.has(toolName)) {
    return retiredReadOnlyBoundaryResult(toolName, "retired_external_place_tool");
  }

  context.signal?.throwIfAborted();

  try {
    if (RETIRED_PRODUCT_TOOL_NAMES.has(toolName)) {
      return {
        toolName,
        toolInput: {},
        toolOutput: { error: "retired_product_tool" },
        success: false,
        displayMessage:
          "견적 체크 기능은 현재 신규 제공하지 않습니다. 업체 견적서·계약서 원문에서 확인할 질문은 정리해드릴 수 있어요.",
      };
    }

    if (RETIRED_AMORA_ACTION_TOOL_NAMES.has(toolName)) {
      return {
        toolName,
        toolInput: {},
        toolOutput: { error: "retired_amora_actions" },
        success: false,
        displayMessage:
          "별도 아모라 행동 기능은 종료되었습니다. 준비 항목은 체크리스트에, 날짜가 있는 약속은 일정에 직접 기록해 주세요.",
      };
    }

    if (RETIRED_VENDOR_BOOKING_TOOL_NAMES.has(toolName)) {
      return {
        toolName,
        toolInput: {},
        toolOutput: { error: "retired_vendor_booking_tool" },
        success: false,
        displayMessage:
          "아모라의 업체 탐색·예약 도구는 종료되었습니다. 이전 상담 요청은 과거 기록일 뿐 계약·결제 증빙이 아니며, 아모라가 업체 조회나 예약을 대신하지 않습니다.",
      };
    }

    const validation = validateToolInput(toolName, toolInput);
    if (validation) return invalidToolInputResult(toolName, validation);

    if (RETIRED_UNTRUSTED_TOOL_NAMES.has(toolName)) {
      return {
        toolName,
        toolInput: {},
        toolOutput: { error: "retired_untrusted_tool" },
        success: false,
        displayMessage:
          "확인되지 않은 가정으로 결정을 대신하거나 대화에서 금액 기록을 바꾸는 기능은 제공하지 않습니다. 금액은 예산 화면에서 원문을 확인해 직접 저장해 주세요.",
      };
    }

    switch (toolName) {
      case "get_budget_summary":
        return executeGetBudgetSummary(context);
      case "get_schedule_summary":
        return executeGetScheduleSummary(context);
      case "get_wedding_info":
        return executeGetWeddingInfo(context);
      case "get_schedule_events":
        return executeGetScheduleEvents(toolInput, context);
      case "get_market_price":
        return executeGetMarketPrice(toolInput);
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

function executeGetBudgetSummary(ctx: ExecutionContext): ToolExecutionResult {
  const total = ctx.weddingContext.budget;
  const progress = ctx.weddingContext.progress;

  const readAmount = (record: Record<string, unknown>, field: string): number | null => {
    const value = record[field];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  };
  const categories = Object.entries(progress).flatMap(([key, value]) => {
    if (key.startsWith("__") || typeof value !== "object" || value === null || Array.isArray(value)) {
      return [];
    }

    const p = value as Record<string, unknown>;
    const plannedBudget = readAmount(p, "budget");
    const contractedTotal = readAmount(p, "contractedTotal");
    const paidToDate = readAmount(p, "paidToDate");
    const nextPaymentAmount = readAmount(p, "nextPaymentAmount");
    const nextPaymentDate = typeof p.nextPaymentDate === "string" ? p.nextPaymentDate : null;
    const hasUserRecord = ["budget", "contractedTotal", "paidToDate", "nextPaymentAmount", "nextPaymentDate"]
      .some((field) => Object.prototype.hasOwnProperty.call(p, field));
    if (!hasUserRecord) return [];

    const label = CATEGORY_LABELS[key] ?? (typeof p.label === "string" ? p.label : key);

    return [{
      key,
      label,
      planned_budget: plannedBudget,
      contracted_total: contractedTotal,
      paid_to_date: paidToDate,
      next_payment_amount: nextPaymentAmount,
      next_payment_date: nextPaymentDate,
      source: "user_entered_unverified",
    }];
  });

  const legacyUnclassifiedCount = Object.entries(progress).filter(([key, value]) => {
    if (key.startsWith("__") || typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return ["spent", "cost", "payer"].some((field) => Object.prototype.hasOwnProperty.call(record, field));
  }).length;
  const totalPlannedByCategory = categories.reduce((sum, category) => sum + (category.planned_budget ?? 0), 0);
  const totalContracted = categories.reduce((sum, category) => sum + (category.contracted_total ?? 0), 0);
  const totalPaidToDate = categories.reduce((sum, category) => sum + (category.paid_to_date ?? 0), 0);
  const hasTotalBudget = Number.isFinite(total) && total > 0;
  const totalLabel = hasTotalBudget ? `전체 계획 예산 ${formatWon(total)}` : "전체 계획 예산 미정";
  const recordLabel = categories.length === 0
    ? "금액 기록 없음(임의 추정 없음)"
    : `항목 계획 ${formatWon(totalPlannedByCategory)} / 계약 총액 ${formatWon(totalContracted)} / 누적 납부 ${formatWon(totalPaidToDate)}`;
  const legacyLabel = legacyUnclassifiedCount > 0
    ? ` / 이전 미분류 기록 ${legacyUnclassifiedCount}개는 합계 제외`
    : "";

  return {
    toolName: "get_budget_summary",
    toolInput: {},
    toolOutput: {
      total_budget: total,
      total_planned_by_category: totalPlannedByCategory,
      total_contracted: totalContracted,
      total_paid_to_date: totalPaidToDate,
      legacy_unclassified_count: legacyUnclassifiedCount,
      categories,
      interpretation_boundary: "user_entered_records_not_quote_or_contract_verification",
    },
    success: true,
    displayMessage: `${totalLabel} / ${recordLabel}${legacyLabel}`,
  };
}

function executeGetWeddingInfo(ctx: ExecutionContext): ToolExecutionResult {
  const { weddingDate, budget, venue, progress } = ctx.weddingContext;

  let dDay: number | null = null;
  if (weddingDate) {
    dDay = ddayInKst(weddingDate);
  }

  const progressCounts = getJourneyProgressCounts(progress);
  const progressPercent = progressCounts.total > 0
    ? Math.round((progressCounts.done / progressCounts.total) * 100)
    : 0;
  const weddingDateLabel = dDay === null
    ? "날짜 형식 확인 필요"
    : dDay === 0
      ? "D-Day"
      : dDay > 0
        ? `D-${dDay}`
        : `D+${Math.abs(dDay)}`;

  return {
    toolName: "get_wedding_info",
    toolInput: {},
    toolOutput: {
      wedding_date: weddingDate,
      d_day: dDay,
      venue,
      total_budget: budget,
      progress_percent: progressPercent,
      completed_count: progressCounts.done,
      total_categories: progressCounts.categoryCount,
      total_checklist_items: progressCounts.total,
    },
    success: true,
    displayMessage: weddingDate
      ? `결혼 예정일: ${weddingDate} (${weddingDateLabel}) / 예산: ${formatWon(budget)} / 시작한 항목 완료율: ${progressPercent}%`
      : `결혼 예정일 미설정 / 예산: ${formatWon(budget)}`,
  };
}
