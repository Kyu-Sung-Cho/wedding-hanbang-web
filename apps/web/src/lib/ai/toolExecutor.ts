import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolExecutionResult } from "@/types/database.types";
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

export { CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";

function getAdminClient() {
  return createAdminClient();
}

// Mutation audit:
// - Assignment/delete tools converge on the same state when repeated.
// - Create/append tools need both this request ledger and a domain strategy.
//   Booking has a database uniqueness invariant; custom categories and wedding
//   moments are semantic upserts. General schedule events and action cards can
//   legitimately share content, so only the request ledger deduplicates them.
// - search_vendors writes best-effort search telemetry only; it is intentionally
//   treated as a read because suppressing a live catalog result on log failure
//   would be worse than an at-least-once analytics count.
const IDEMPOTENT_ASSIGNMENT_TOOLS = [
  "update_budget",
  "update_wedding_date",
  "update_task_status",
  "update_venue",
  "update_category_budget",
  "apply_budget_plan",
  "delete_category",
  "reset_category",
  "update_schedule_event",
  "delete_schedule_event",
  "toggle_checklist_item",
  "update_amora_action",
  "cancel_booking",
] as const;

const CREATE_OR_APPEND_TOOLS = [
  "add_custom_category",
  "add_schedule_event",
  "add_amora_action",
  "log_wedding_event",
  "create_booking",
] as const;

const MUTATING_TOOLS = new Set<string>([
  ...IDEMPOTENT_ASSIGNMENT_TOOLS,
  ...CREATE_OR_APPEND_TOOLS,
]);

type DurableToolClaim =
  | { action: "acquired" }
  | { action: "completed"; result: unknown }
  | { action: "in_progress" | "uncertain" | "conflict" };

// One execution context is retained across all model tool rounds. Caching the
// promise closes the same-process/concurrent duplicate window before the
// durable ledger response has even returned.
const executionCache = new WeakMap<
  ExecutionContext,
  Map<string, Promise<ToolExecutionResult>>
>();

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite tool input");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported tool input value");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function failureResult(
  toolName: string,
  toolInput: Record<string, unknown>,
  errorCode: string,
  displayMessage: string
): ToolExecutionResult {
  return {
    toolName,
    toolInput,
    toolOutput: {
      error: errorCode,
      retryable: false,
      requires_state_review: errorCode === "TOOL_EXECUTION_UNCERTAIN",
    },
    success: false,
    displayMessage,
  };
}

function durableResultPayload(result: ToolExecutionResult): Record<string, unknown> {
  // toolInput may contain a free-text memo. The ledger already stores a digest,
  // so persisting the raw input would add avoidable personal-data retention.
  return {
    toolName: result.toolName,
    toolOutput: result.toolOutput,
    success: result.success,
    displayMessage: result.displayMessage,
  };
}

function hydrateDurableResult(
  value: unknown,
  toolName: string,
  toolInput: Record<string, unknown>
): ToolExecutionResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stored = value as Record<string, unknown>;
  if (
    stored.toolName !== toolName ||
    !stored.toolOutput ||
    typeof stored.toolOutput !== "object" ||
    Array.isArray(stored.toolOutput) ||
    typeof stored.success !== "boolean" ||
    typeof stored.displayMessage !== "string"
  ) {
    return null;
  }
  return {
    toolName,
    toolInput,
    toolOutput: stored.toolOutput as Record<string, unknown>,
    success: stored.success,
    displayMessage: stored.displayMessage,
  };
}

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolExecutionResult> {
  if (!MUTATING_TOOLS.has(toolName)) {
    try {
      return await executeToolOnce(toolName, toolInput, context);
    } catch (error) {
      return {
        toolName,
        toolInput,
        toolOutput: { error: String(error) },
        success: false,
        displayMessage: "처리 중 오류가 발생했습니다.",
      };
    }
  }

  if (!context.requestKey) {
    return failureResult(
      toolName,
      toolInput,
      "IDEMPOTENCY_CONTEXT_MISSING",
      "안전한 요청 식별자를 확인하지 못해 변경을 적용하지 않았습니다."
    );
  }

  let canonicalInput: string;
  try {
    canonicalInput = canonicalJson(toolInput);
  } catch {
    return failureResult(
      toolName,
      toolInput,
      "INVALID_TOOL_INPUT",
      "도구 입력 형식이 올바르지 않아 변경을 적용하지 않았습니다."
    );
  }

  const inputDigest = sha256(canonicalInput);
  const operationKey = sha256(`${toolName}\n${canonicalInput}`);
  const cacheKey = `${context.requestKey}:${operationKey}`;
  let contextCache = executionCache.get(context);
  if (!contextCache) {
    contextCache = new Map();
    executionCache.set(context, contextCache);
  }

  const existing = contextCache.get(cacheKey);
  if (existing) return existing;

  const execution = executeMutatingToolWithLedger({
    toolName,
    toolInput,
    context,
    inputDigest,
    operationKey,
  });
  contextCache.set(cacheKey, execution);
  return execution;
}

async function executeMutatingToolWithLedger({
  toolName,
  toolInput,
  context,
  inputDigest,
  operationKey,
}: {
  toolName: string;
  toolInput: Record<string, unknown>;
  context: ExecutionContext;
  inputDigest: string;
  operationKey: string;
}): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const claimArgs = {
    p_couple_id: context.coupleId,
    p_request_key: context.requestKey!,
    p_operation_key: operationKey,
    p_tool_name: toolName,
    p_input_digest: inputDigest,
  };

  const { data: rawClaim, error: claimError } = await admin.rpc(
    "claim_amora_tool_execution",
    claimArgs
  );
  if (claimError || !rawClaim || typeof rawClaim !== "object") {
    return failureResult(
      toolName,
      toolInput,
      "TOOL_IDEMPOTENCY_UNAVAILABLE",
      "변경 중복 방지 장치를 확인하지 못해 안전하게 중단했습니다."
    );
  }

  const claim = rawClaim as unknown as DurableToolClaim;
  if (claim.action === "completed") {
    return hydrateDurableResult(claim.result, toolName, toolInput) ?? failureResult(
      toolName,
      toolInput,
      "TOOL_LEDGER_RESULT_INVALID",
      "이전 변경 결과를 안전하게 확인하지 못했습니다. 상태를 직접 확인해 주세요."
    );
  }
  if (claim.action === "in_progress") {
    return failureResult(
      toolName,
      toolInput,
      "TOOL_EXECUTION_IN_PROGRESS",
      "같은 변경을 이미 처리 중이라 중복 실행하지 않았습니다."
    );
  }
  if (claim.action === "uncertain") {
    return failureResult(
      toolName,
      toolInput,
      "TOOL_EXECUTION_UNCERTAIN",
      "이전 변경의 완료 여부가 불확실해 다시 실행하지 않았습니다. 현재 상태를 먼저 확인해 주세요."
    );
  }
  if (claim.action !== "acquired") {
    return failureResult(
      toolName,
      toolInput,
      "TOOL_IDEMPOTENCY_CONFLICT",
      "요청 식별자가 다른 변경과 충돌해 적용하지 않았습니다."
    );
  }

  const markExecutionUncertain = async (failureCode: string) => {
    try {
      const { data, error } = await admin.rpc("mark_amora_tool_execution_uncertain", {
        p_couple_id: context.coupleId,
        p_request_key: context.requestKey!,
        p_operation_key: operationKey,
        p_failure_code: failureCode,
      });
      if (error || data !== true) {
        console.error("[amora-tool-ledger] uncertainty marker was not persisted", {
          toolName,
          failureCode,
          error: error?.message ?? null,
          acknowledged: data === true,
        });
      }
    } catch (markerError) {
      console.error("[amora-tool-ledger] uncertainty marker transport failed", {
        toolName,
        failureCode,
        markerError,
      });
    }
  };

  let result: ToolExecutionResult;
  try {
    result = await executeToolOnce(toolName, toolInput, context);
  } catch (error) {
    await markExecutionUncertain(
      error instanceof Error ? error.name : "TOOL_EXECUTION_ERROR"
    );
    return failureResult(
      toolName,
      toolInput,
      "TOOL_EXECUTION_UNCERTAIN",
      "변경 처리 중 결과를 확정하지 못했습니다. 중복 방지를 위해 다시 실행하지 않았습니다."
    );
  }

  const { data: completed, error: completeError } = await admin.rpc(
    "complete_amora_tool_execution",
    {
      p_couple_id: context.coupleId,
      p_request_key: context.requestKey!,
      p_operation_key: operationKey,
      p_result: durableResultPayload(result),
    }
  );
  if (completeError || completed !== true) {
    await markExecutionUncertain("LEDGER_COMPLETION_FAILED");
    return failureResult(
      toolName,
      toolInput,
      "TOOL_EXECUTION_UNCERTAIN",
      "변경 결과 기록을 확정하지 못했습니다. 현재 상태를 먼저 확인해 주세요."
    );
  }

  return result;
}

async function executeToolOnce(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolExecutionResult> {
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
        return await executeSearchNearbyPlaces(toolInput);
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
// intake_summary 는 이 쓰기 경로에서 영구 저장하지 않는다(아래 privacy 메모 참고).
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

  const invalidPlan = (
    !Number.isSafeInteger(totalBudget) ||
    totalBudget < 0 ||
    totalBudget > 1_000_000_000_000 ||
    !Array.isArray(allocations) ||
    allocations.length === 0 ||
    allocations.length > Object.keys(CATEGORY_RATIOS).length ||
    allocations.some((allocation) =>
      !allocation ||
      typeof allocation !== "object" ||
      typeof allocation.category !== "string" ||
      !(allocation.category in CATEGORY_RATIOS) ||
      !Number.isSafeInteger(allocation.budget) ||
      allocation.budget < 0 ||
      allocation.budget > 1_000_000_000_000
    ) ||
    new Set(allocations.map((allocation) => allocation.category)).size !== allocations.length
  );
  if (invalidPlan) {
    return {
      toolName: "apply_budget_plan",
      toolInput: input,
      toolOutput: { error: "invalid_budget_plan" },
      success: false,
      displayMessage: "예산 총액 또는 카테고리 배분 형식이 올바르지 않아 적용하지 않았습니다.",
    };
  }

  // 합계 검증 — 초과 시 차단, 미달 시 잔여분 reserve 로 보강
  const allocSum = allocations.reduce((acc, a) => acc + (Number(a.budget) || 0), 0);
  if (allocSum > totalBudget) {
    return {
      toolName: "apply_budget_plan",
      toolInput: input,
      toolOutput: { error: "budget_allocations_exceed_total", total_budget: totalBudget, allocation_total: allocSum },
      success: false,
      displayMessage: `카테고리 합계(${formatWon(allocSum)})가 총 예산(${formatWon(totalBudget)})을 초과해 적용하지 않았습니다.`,
    };
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
  const { data: updatedProgress, error: budgetPlanError } = await admin.rpc(
    "apply_budget_plan_atomic",
    {
      p_couple_id: ctx.coupleId,
      p_total_budget: totalBudget,
      p_progress_patch: progressPatch,
    }
  );
  if (
    budgetPlanError ||
    !updatedProgress ||
    typeof updatedProgress !== "object" ||
    Array.isArray(updatedProgress)
  ) {
    throw budgetPlanError ?? new Error("apply_budget_plan_atomic returned invalid progress");
  }
  ctx.weddingContext.budget = totalBudget;
  ctx.weddingContext.progress =
    updatedProgress as unknown as ExecutionContext["weddingContext"]["progress"];

  // intake_summary used to be appended to decision_nodes here. That write used
  // non-existent/invalid schema values (`value`, `amora_budget_intake`) and was
  // silently ignored. More importantly, this context has no privacy visibility,
  // so defaulting a private budget interview to shared memory could leak it to
  // the partner. Keep the summary transient until a visibility-aware memory RPC
  // can persist it atomically and idempotently.
  void intakeSummary;

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
  const label = typeof input.label === "string"
    ? input.label.replace(/\s+/g, " ").trim().slice(0, 60)
    : "";
  if (!label) {
    return {
      toolName: "add_custom_category",
      toolInput: input,
      toolOutput: { error: "invalid_category_label" },
      success: false,
      displayMessage: "추가할 카테고리 이름이 필요합니다.",
    };
  }
  for (const field of ["budget", "spent"] as const) {
    if (
      input[field] !== undefined &&
      (typeof input[field] !== "number" || !Number.isFinite(input[field]) || input[field] < 0)
    ) {
      return {
        toolName: "add_custom_category",
        toolInput: input,
        toolOutput: { error: "invalid_category_amount", field },
        success: false,
        displayMessage: "카테고리 금액은 0 이상의 숫자여야 합니다.",
      };
    }
  }

  const progress = ctx.weddingContext.progress as Record<string, unknown>;
  const normalizedLabel = label.toLocaleLowerCase("ko-KR");
  const matchingEntry = Object.entries(progress).find(([candidateKey, candidate]) => {
    if (!candidateKey.startsWith("custom_") || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return false;
    }
    const candidateLabel = (candidate as Record<string, unknown>).label;
    return typeof candidateLabel === "string" &&
      candidateLabel.replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR") === normalizedLabel;
  });
  const deterministicKey = `custom_${sha256(`${ctx.coupleId}\n${normalizedLabel}`).slice(0, 24)}`;
  const key = matchingEntry?.[0] ?? deterministicKey;
  const existing = matchingEntry?.[1] ?? progress[key];
  if (existing !== undefined && (!existing || typeof existing !== "object" || Array.isArray(existing))) {
    throw new Error("Custom category key collision");
  }
  const existingCategory = (existing ?? {}) as Record<string, unknown>;
  if (
    typeof existingCategory.label === "string" &&
    existingCategory.label.replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR") !== normalizedLabel
  ) {
    throw new Error("Custom category digest collision");
  }
  const created = existing === undefined;
  const updates: Record<string, unknown> = {
    ...existingCategory,
    category: key,
    label,
    status: typeof existingCategory.status === "string" ? existingCategory.status : "in_progress",
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
    toolOutput: { key, label, created, ...updates },
    success: true,
    displayMessage: created
      ? `새 카테고리 "${label}"${subjectParticle(label)} 추가되었습니다${desc}.`
      : `기존 카테고리 "${label}"${subjectParticle(label)} 업데이트되었습니다${desc}.`,
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
    dDay = Math.ceil(
      (new Date(weddingDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
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
