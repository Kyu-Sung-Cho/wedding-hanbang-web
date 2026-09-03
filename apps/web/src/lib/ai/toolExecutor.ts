import { daysUntilWedding } from "@hanbang/shared";
import { createHash } from "node:crypto";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { resolveStatusByKey } from "@/utils/checklist";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolExecutionResult } from "@/types/database.types";
import {
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
  executeCancelScheduleEvent,
  executeDeleteScheduleEvent,
  executeGetScheduleEvents,
  executeGetScheduleSummary,
  executeLogWeddingEvent,
  executeRestoreScheduleEvent,
  executeToggleChecklistItem,
  executeUpdateScheduleEvent,
} from "@/lib/ai/tools/scheduleTools";
import {
  executeAddAmoraAction,
  executeGetAmoraActions,
  executeUpdateAmoraAction,
} from "@/lib/ai/tools/amoraActionTools";
import {
  AMORA_MAX_TOOL_CALLS_PER_TURN,
  AMORA_MAX_TOOL_FEEDBACK_CHARS_PER_TURN,
} from "@/lib/ai/amoraRequestPolicy";
import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import { mergePlanningChecklist } from "@hanbang/shared/utils";
import { listCustomBudgetCategories } from "@/lib/ai/budgetCustomCategories";
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
} from "@/lib/ai/tools/planningConstants";
import {
  patchJourneyProgress,
  patchJourneyProgressItem,
} from "@/lib/ai/tools/progressTools";
import {
  kstMidnightFromYmd,
  todayKstMidnight,
  ymdInKst,
} from "@/lib/utils/kstDate";
import { isValidScheduleYmd } from "@/utils/scheduleEvents";
import {
  formatWon,
  requireDestructiveConfirmation,
  subjectParticle,
  type ToolExecutionContext as ExecutionContext,
} from "@/lib/ai/tools/toolTypes";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import {
  applyAmoraAtomicToolResultToContext,
  buildAmoraAtomicToolOperation,
} from "@/lib/ai/amoraAtomicToolOperation";
import {
  MAX_WEDDING_BUDGET_WON,
  formatWeddingBudgetCeiling,
  isValidWeddingWonAmount,
} from "@/lib/weddingBudget";

export { CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";

const MAX_WEDDING_AMOUNT_WON = MAX_WEDDING_BUDGET_WON;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidWonAmount(value: unknown): value is number {
  return isValidWeddingWonAmount(value);
}

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
type DurableToolClaim =
  | { action: "acquired" }
  | { action: "completed"; result: unknown }
  | {
      action:
        | "in_progress"
        | "uncertain"
        | "conflict"
        | "stale_context"
        | "stale_attempt"
        | "retry_new_operation_blocked";
    };

// One execution context is retained across all model tool rounds. Caching the
// promise closes the same-process/concurrent duplicate window before the
// durable ledger response has even returned.
const executionCache = new WeakMap<
  ExecutionContext,
  Map<string, Promise<ToolExecutionResult>>
>();

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
  if (toolName === "delete_schedule_event") {
    return failureResult(
      toolName,
      toolInput,
      "legacy_schedule_delete_blocked",
      "일정은 기록 보호를 위해 삭제하지 않아요. 취소 상태로 남겨 주세요.",
    );
  }
  if (!isMutatingTool(toolName)) {
    try {
      return await executeToolOnce(toolName, toolInput, context);
    } catch (error) {
      console.error("[amora-tool] read tool failed", {
        toolName,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return {
        toolName,
        toolInput,
        toolOutput: { error_code: "TOOL_EXECUTION_FAILED" },
        success: false,
        displayMessage: "지금 그 정보를 가져오지 못했어요. 잠시 후 다시 물어봐 주세요.",
      };
    }
  }

  if (
    !context.requestKey
    || !Number.isInteger(context.requestAttemptCount)
    || (context.requestAttemptCount ?? 0) < 1
  ) {
    return failureResult(
      toolName,
      toolInput,
      "IDEMPOTENCY_CONTEXT_MISSING",
      "이번 변경을 안전하게 처리할 준비가 되지 않아서, 아무것도 바꾸지 않았어요. 새 메시지로 다시 말씀해 주세요."
    );
  }

  if (
    context.pendingActionId !== undefined
    && (
      typeof context.pendingActionId !== "string"
      || !UUID_PATTERN.test(context.pendingActionId)
    )
  ) {
    return failureResult(
      toolName,
      toolInput,
      "INVALID_PENDING_ACTION_ID",
      "확인해 주신 그 변경이 맞는지 확인이 되지 않아서, 반영하지 않았어요. 번거롭지만 다시 한 번 말씀해 주세요.",
    );
  }

  const pendingActionId = context.pendingActionId?.toLowerCase();

  let inputDigest: string;
  let operationKey: string;
  try {
    ({ inputDigest, operationKey } = getAmoraToolOperationIdentity(
      toolName,
      toolInput,
    ));
  } catch {
    return failureResult(
      toolName,
      toolInput,
      "INVALID_TOOL_INPUT",
      "제가 정리한 값에 빠지거나 잘못된 부분이 있어서, 반영하지 않았어요. 어떤 값으로 바꿀지 다시 알려주세요."
    );
  }

  const cacheKey = `${context.requestKey}:${operationKey}:${pendingActionId ?? "request"}`;
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
    pendingActionId,
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
  pendingActionId,
}: {
  toolName: string;
  toolInput: Record<string, unknown>;
  context: ExecutionContext;
  inputDigest: string;
  operationKey: string;
  pendingActionId?: string;
}): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const claimArgs = {
    p_couple_id: context.coupleId,
    p_request_key: context.requestKey!,
    p_operation_key: operationKey,
    p_tool_name: toolName,
    p_input_digest: inputDigest,
    p_request_attempt_count: context.requestAttemptCount!,
    ...(context.providerCallIndex !== undefined || pendingActionId !== undefined
      ? {
          p_pending_action_id: pendingActionId ?? null,
          p_provider_call_index: context.providerCallIndex ?? null,
        }
      : {}),
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
      "같은 변경이 두 번 들어가지 않게 확인하는 중에 문제가 생겨서, 아무것도 바꾸지 않고 멈췄어요. 잠시 후 다시 시도해 주세요."
    );
  }

  const claim = rawClaim as unknown as DurableToolClaim;
  if (claim.action === "completed") {
    const replayed = hydrateDurableResult(claim.result, toolName, toolInput);
    if (!replayed) {
      return failureResult(
        toolName,
        toolInput,
        "TOOL_LEDGER_RESULT_INVALID",
        "앞선 변경이 어떻게 끝났는지 확인하지 못했어요. 지금 값이 맞는지 화면에서 먼저 확인해 주세요.",
      );
    }
    applyAmoraAtomicToolResultToContext(replayed, context);
    return replayed;
  }
  if (claim.action === "in_progress") {
    return failureResult(
      toolName,
      toolInput,
      "TOOL_EXECUTION_IN_PROGRESS",
      "같은 변경을 이미 처리하고 있어서, 두 번 넣지 않았어요."
    );
  }
  if (claim.action === "uncertain") {
    return failureResult(
      toolName,
      toolInput,
      "TOOL_EXECUTION_UNCERTAIN",
      "앞선 변경이 끝났는지 확실하지 않아서, 다시 실행하지 않았어요. 지금 값을 먼저 확인해 주세요."
    );
  }
  if (claim.action === "retry_new_operation_blocked") {
    return failureResult(
      toolName,
      toolInput,
      "TOOL_RETRY_NEW_OPERATION_BLOCKED",
      "이 요청은 앞서 보낸 것을 다시 보내는 중이라, 새로운 변경은 반영하지 않았어요. 지금 상태를 확인한 뒤 새 메시지로 말씀해 주세요."
    );
  }
  if (claim.action === "stale_attempt") {
    return failureResult(
      toolName,
      toolInput,
      "TOOL_REQUEST_ATTEMPT_STALE",
      "더 최근 요청이 이미 시작돼서, 이 답변의 변경은 반영하지 않았어요."
    );
  }
  if (claim.action === "stale_context") {
    return failureResult(
      toolName,
      toolInput,
      "TOOL_CONTEXT_STALE",
      "그 사이 대화가 더 이어져서, 예전 맥락의 변경은 반영하지 않았어요. 지금 대화에서 다시 확인해 주세요."
    );
  }
  if (claim.action !== "acquired") {
    return failureResult(
      toolName,
      toolInput,
      "TOOL_IDEMPOTENCY_CONFLICT",
      "다른 변경과 겹쳐서 반영하지 않았어요. 잠시 후 다시 시도해 주세요."
    );
  }

  const requiresAtomicCommit = context.providerCallIndex !== undefined
    || pendingActionId !== undefined;
  if (requiresAtomicCommit) {
    const operation = buildAmoraAtomicToolOperation(
      toolName,
      toolInput,
      context,
      operationKey,
    );
    const durablePayload = durableResultPayload(operation.result);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const { data, error } = await admin.rpc(
          "apply_amora_atomic_tool_execution",
          {
            p_couple_id: context.coupleId,
            p_request_key: context.requestKey!,
            p_operation_key: operationKey,
            p_request_attempt_count: context.requestAttemptCount!,
            p_input_digest: inputDigest,
            p_tool_input: toolInput,
            p_domain_mutation: operation.domainMutation,
            p_result: durablePayload,
          },
        );
        const committed = !error
          ? hydrateDurableResult(data, toolName, toolInput)
          : null;
        if (committed) {
          applyAmoraAtomicToolResultToContext(committed, context);
          return committed;
        }
        // 실패 사유를 남긴다. 예전에는 `error` 를 버리고 세 번 재시도한 뒤
        // "atomic commit outcome unavailable" 만 던졌다. 그래서 운영에서 일정
        // 취소가 100% 실패하는데 **왜인지 알 방법이 없었다**(2026-08-23, 원인
        // 추적에 몇 시간이 들었다). 콘텐츠는 남기지 않고 코드만 남긴다.
        if (error) {
          console.error("[amora-tool] atomic commit rejected", {
            tool: toolName,
            attempt,
            code: error.code ?? "unknown",
            message: error.message?.slice(0, 200) ?? "",
          });
        }
      } catch (thrown) {
        // Retry the same operation-key-scoped transaction. A committed first
        // attempt returns its stored result; an uncommitted one has no domain
        // side effect by construction.
        console.error("[amora-tool] atomic commit threw", {
          tool: toolName,
          attempt,
          name: thrown instanceof Error ? thrown.name : typeof thrown,
          message: thrown instanceof Error ? thrown.message.slice(0, 200) : "",
        });
      }
    }
    // Do not let the provider turn this uncertainty into a terminal assistant
    // message. The transaction may have committed while its response was
    // lost; failing the chat claim preserves the journal so the same request
    // can replay the ledger's completed result.
    throw new Error("[amora-tool] atomic commit outcome unavailable");
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
      "변경이 끝났는지 확정하지 못했어요. 두 번 들어가지 않게 다시 실행하지는 않았어요. 지금 값을 먼저 확인해 주세요."
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
      "변경 기록을 확정하지 못했어요. 지금 값이 맞는지 먼저 확인해 주세요."
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
      case "cancel_schedule_event":
        return await executeCancelScheduleEvent(toolInput, context);
      case "restore_schedule_event":
        return await executeRestoreScheduleEvent(toolInput, context);
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
        return await executeGetMarketPrice(toolInput, getAdminClient());
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
  const newBudget = input.total_budget;
  if (!isValidWonAmount(newBudget)) {
    return {
      toolName: "update_budget",
      toolInput: input,
      toolOutput: { error: "invalid_budget_amount" },
      success: false,
      displayMessage: `총예산은 0원 이상 ${formatWeddingBudgetCeiling()} 이하의 원 단위 정수여야 합니다.`,
    };
  }
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
  if (!isValidScheduleYmd(newDate)) {
    return {
      toolName: "update_wedding_date",
      toolInput: input,
      toolOutput: { error: "invalid_date", message: `유효하지 않은 날짜: ${newDate}` },
      success: false,
      displayMessage: `유효하지 않은 날짜입니다: ${newDate}`,
    };
  }
  const parsed = kstMidnightFromYmd(newDate);

  // 3) 과거 날짜 거부 — 서버 시간대와 무관하게 사용자 기준(KST) 오늘을 사용한다.
  const todayIso = ymdInKst();
  const todayStart = todayKstMidnight();
  if (newDate < todayIso) {
    const nextYear = Number(todayIso.slice(0, 4)) + 1;
    return {
      toolName: "update_wedding_date",
      toolInput: input,
      toolOutput: {
        error: "past_date_rejected",
        attempted: newDate,
        today: todayIso,
        message: `${newDate}는 오늘(${todayIso}) 이전입니다. 결혼 예정일은 미래 날짜여야 합니다. 사용자에게 정확한 연도를 다시 확인하세요. (예: '내년 3월 12일' → ${nextYear}-03-12)`,
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

  const dDay = Math.round(
    (parsed.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24),
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
  const category = input.category;
  const status = input.status;
  if (
    typeof category !== "string"
    || !Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category)
    || typeof status !== "string"
    || !Object.prototype.hasOwnProperty.call(STATUS_LABELS, status)
  ) {
    return {
      toolName: "update_task_status",
      toolInput: input,
      toolOutput: { error: "invalid_task_status" },
      success: false,
      displayMessage: "준비 항목과 진행 상태를 확인하지 못해 변경하지 않았습니다.",
    };
  }
  const label = CATEGORY_LABELS[category];
  const statusLabel = STATUS_LABELS[status];

  await patchJourneyProgressItem(ctx, category, { category, status });

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
  const category = input.category;
  const hasBudget = input.budget !== undefined;
  const hasSpent = input.spent !== undefined;
  if (
    typeof category !== "string"
    || !Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category)
    || (!hasBudget && !hasSpent)
    || (hasBudget && !isValidWonAmount(input.budget))
    || (hasSpent && !isValidWonAmount(input.spent))
  ) {
    return {
      toolName: "update_category_budget",
      toolInput: input,
      toolOutput: { error: "invalid_category_budget" },
      success: false,
      displayMessage: "예산 항목과 금액을 확인하지 못해 변경하지 않았습니다.",
    };
  }
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
    changes.push(`기록 지출 ${formatWon(newSpent)}(결제 확인과 별도)`);
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

// 사용자가 확인한 카테고리 금액을 한 번에 적용한다.
// allocations 합계가 total_budget보다 작으면 그 차액만 미배정 금액으로 보존한다.
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
    totalBudget > MAX_WEDDING_AMOUNT_WON ||
    !Array.isArray(allocations) ||
    allocations.length === 0 ||
    allocations.length > Object.keys(CATEGORY_LABELS).length ||
    allocations.some((allocation) =>
      !allocation ||
      typeof allocation !== "object" ||
      typeof allocation.category !== "string" ||
      !(allocation.category in CATEGORY_LABELS) ||
      !Number.isSafeInteger(allocation.budget) ||
      allocation.budget < 0 ||
      allocation.budget > MAX_WEDDING_AMOUNT_WON
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

  // 내부 키는 이전 데이터와 호환하기 위해 reserve를 쓰되, 값의 의미는
  // 사용자가 별도로 정한 예비비가 아니라면 아직 쓰임을 정하지 않은 금액이다.
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
        rationale: "총액에서 확인된 배정액을 뺀 아직 쓰임을 정하지 않은 금액",
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
    displayMessage: `총 예산 ${formatWon(totalBudget)} 기준 카테고리 ${finalAllocations.length}개 배분 적용 완료${remainder > 0 ? ` (아직 쓰임을 정하지 않은 금액 ${formatWon(remainder)})` : ""}.\n${lines}`,
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
      !isValidWonAmount(input[field])
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
    changes.push(`기록 지출 ${formatWon(input.spent as number)}(결제 확인과 별도)`);
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
    displayMessage: `결혼식장이 "${venue}"(으)로 설정되었습니다.`,
  };
}

interface BudgetSummaryCategory {
  key: string;
  label: string;
  allocated: number | null;
  allocated_is_set: boolean;
  spent: number;
  status: string;
  /** 참일 때만 싣는다 — 자리를 아끼기 위해서다. */
  legacy_amount_unclassified?: true;
}

function executeGetBudgetSummary(ctx: ExecutionContext): ToolExecutionResult {
  const total = isValidWonAmount(ctx.weddingContext.budget)
    ? ctx.weddingContext.budget
    : 0;
  const progress = ctx.weddingContext.progress;

  // 사용자가 입력하거나 계약 금액으로 확인한 예산과 명시적 기록 지출만 보고한다.
  // 기록 지출은 결제 완료 증거가 아니다.
  // 미입력 예산이나 상태를 근거로 금액을 추정하지 않는다.
  // 예산 화면에서 지운 항목은 요약에서도 뺀다. 화면과 다른 숫자를 말하지 않게.
  const hiddenBudgetKeys = new Set(
    Array.isArray((progress as Record<string, unknown>).__hidden)
      ? ((progress as Record<string, unknown>).__hidden as unknown[])
          .filter((key): key is string => typeof key === "string")
      : [],
  );
  const categories = Object.keys(CATEGORY_LABELS)
    .filter((key) => !hiddenBudgetKeys.has(key))
    .map((key) => {
    const p = (progress[key] ?? {}) as Record<string, unknown>;
    const hasSetBudget = isValidWonAmount(p.budget);
    const allocated = hasSetBudget ? (p.budget as number) : null;
    const spent = isValidWonAmount(p.spent) ? (p.spent as number) : 0;
    const legacyAmountUnclassified = Object.prototype.hasOwnProperty.call(
      p,
      "cost",
    );

    return {
      key,
      label: CATEGORY_LABELS[key] || key,
      allocated,
      allocated_is_set: hasSetBudget,
      spent,
      // 거짓일 때는 싣지 않는다. 22개 카테고리에 `false` 를 다 실으면 770자인데,
      // 이 도구는 턴당 4,000자에서 잘린다 — 그 자리를 사용자가 직접 추가한 항목이
      // 써야 한다. 이 값은 참일 때만 의미가 있다(용도 미확인 이전 금액).
      ...(legacyAmountUnclassified ? { legacy_amount_unclassified: true } : {}),
      status: (p.status as string) || "not_started",
    } as BudgetSummaryCategory;
  });

  // 사용자가 직접 추가한 예산 항목도 요약에 넣는다.
  //
  // 넣지 않으면 아모라가 말하는 합계가 예산 화면의 합계와 갈린다 — 화면은
  // 이 항목들을 더하는데 요약은 고정 20개만 훑었다(2026-08-24 감사).
  const customCategories = listCustomBudgetCategories(progress).map((custom) => {
    const hasSetBudget = isValidWonAmount(custom.value.budget);
    return {
      key: custom.key,
      // 프롬프트도 60자에서 자른다(prompts.ts). 여기만 원본을 실으면 같은 항목을
      // 두 표면이 다른 이름으로 부른다.
      label: custom.label.slice(0, 60),
      allocated: hasSetBudget ? (custom.value.budget as number) : null,
      allocated_is_set: hasSetBudget,
      spent: isValidWonAmount(custom.value.spent) ? (custom.value.spent as number) : 0,
      ...(Object.prototype.hasOwnProperty.call(custom.value, "cost")
        ? { legacy_amount_unclassified: true as const }
        : {}),
      status: (custom.value.status as string) || "not_started",
    } as BudgetSummaryCategory;
  });

  // 합계는 실린 것만이 아니라 **전부** 센다 — 화면 상단 숫자와 같아야 한다.
  const everyEntry = [...categories, ...customCategories];
  const totalSpent = everyEntry.reduce((sum, entry) => sum + entry.spent, 0);
  const remaining = total - totalSpent;

  // 배정 합계를 **직접 준다.** 예전에는 이 값이 없어서 아모라가 카테고리를 하나씩
  // 더해야 했는데, 실제로 항목 하나를 빠뜨려 화면과 다른 숫자를 말했다
  // (2026-08-24 운영: 실제 3,445만원인데 3,045만원이라고 답했다).
  const totalAllocated = everyEntry.reduce(
    (sum, entry) => sum + (entry.allocated ?? 0),
    0,
  );
  // 총예산을 아직 안 넣은 커플이 있다. 그때 `total` 은 0 이라 미배정을 그대로
  // 계산하면 음수가 되고, 사용자가 정한 적 없는 총액을 기준으로 "초과"라고
  // 단정하게 된다. 예산 화면은 `hasTotalBudget` 으로 갈라 아무 말도 하지 않는다.
  const hasTotalBudget = total > 0;
  const unallocated = hasTotalBudget ? total - totalAllocated : null;

  // 도구 결과는 턴당 4,000자에서 잘린다(route.ts 의 perToolFeedbackBudget).
  // 넘으면 boundAmoraToolResultJson 이 배열을 통째로 버리고 앞뒤 조각만 남기는데,
  // 그러면 고정 카테고리가 모델 시야에서 사라지고 잘린 자리가 숫자 한가운데면
  // 화면과 다른 금액을 말하게 된다. 고정 22개만으로 이미 3,576자라 커스텀 3개면
  // 넘는다(2026-08-24 실측). 그래서 **여기서 먼저** 줄이고, 줄였다는 사실을
  // 구조화해 알린다 — 그래야 아모라가 "더 있어요"라고 정직하게 말할 수 있다.
  const perToolFeedbackBudget = Math.floor(
    AMORA_MAX_TOOL_FEEDBACK_CHARS_PER_TURN / AMORA_MAX_TOOL_CALLS_PER_TURN,
  );
  const shownCustom: typeof customCategories = [];
  for (const entry of customCategories) {
    const projected = JSON.stringify({
      total_budget: total,
      total_spent: totalSpent,
      recorded_spend_basis: "explicit_spent_only",
      remaining,
      categories: [...categories, ...shownCustom, entry],
      total_allocated: totalAllocated,
      unallocated,
      custom_categories_omitted: customCategories.length,
    }).length;
    // 상한과 정확히 비교한다. 여유를 두면 자리가 남는데도 항목이 빠진다
    // (2026-08-24 운영: 3,728자로 상한 아래인데 커스텀 2개가 생략됐다).
    if (projected > perToolFeedbackBudget) break;
    shownCustom.push(entry);
  }
  const customOmitted = customCategories.length - shownCustom.length;
  categories.push(...shownCustom);
  const balanceLabel = !hasTotalBudget
    ? "총예산 미설정"
    : remaining >= 0
      ? `잔여 ${formatWon(remaining)}`
      : `예산 ${formatWon(Math.abs(remaining))} 초과`;
  // 배정이 총예산을 넘는 것은 정상 상태다(예산 화면에도 초과 표시가 있다).
  // formatWon 은 음수에서 예외를 던지므로 잔여와 같은 방식으로 갈라 쓴다.
  const allocationLabel = unallocated === null
    ? "미배정은 총예산을 넣어야 알 수 있음"
    : unallocated >= 0
      ? `미배정 ${formatWon(unallocated)}`
      : `배정이 총예산보다 ${formatWon(Math.abs(unallocated))} 많음`;
  const sourceNote = categories.some((c) => !c.allocated_is_set)
    ? " (항목별 예산은 입력된 금액만 표시)"
    : "";
  const legacyNote = categories.some((c) => c.legacy_amount_unclassified)
    ? " · 용도 미확인 이전 금액은 예산·기록 지출 합계에서 제외"
    : "";
  const omittedNote = customOmitted > 0
    ? ` · 직접 추가한 항목 ${customOmitted}개는 목록에서 생략(합계에는 포함) — 전체는 예산 화면에서 확인`
    : "";

  return {
    toolName: "get_budget_summary",
    toolInput: {},
    toolOutput: {
      total_budget: total,
      total_spent: totalSpent,
      recorded_spend_basis: "explicit_spent_only",
      remaining,
      total_allocated: totalAllocated,
      unallocated,
      categories,
      custom_categories_omitted: customOmitted,
    },
    success: true,
    // 배정 합계와 미배정을 문구에도 넣는다. 예전에는 이 둘이 문구에 없어서,
    // 모델이 값을 받고도 한 번은 다른 숫자를 말했다(2026-08-24 운영: 실제
    // 3,495만원인데 3,945만원이라고 답했다). 모델은 표시 문구를 가장 잘 되받는다.
    displayMessage: `총 예산 ${formatWon(total)} / 항목 배정 ${formatWon(totalAllocated)} / ${allocationLabel} / 기록된 지출 ${formatWon(totalSpent)} / ${balanceLabel}${sourceNote}${legacyNote}${omittedNote}`,
  };
}

function executeGetWeddingInfo(ctx: ExecutionContext): ToolExecutionResult {
  const { weddingDate, venue, progress } = ctx.weddingContext;
  const budget = isValidWonAmount(ctx.weddingContext.budget)
    ? ctx.weddingContext.budget
    : 0;
  // 신규 커플의 총예산은 0이다. 그걸 그대로 `"예산: 0원"` 이라고 말하면
  // **정하지 않은 것**과 **0원으로 정한 것**이 같은 문장이 된다. 예정일은 이미
  // "미설정" 이라고 구분해 말하는데 예산만 그러지 않았다.
  const budgetLabel = budget > 0 ? formatWon(budget) : "아직 정하지 않음";

  // 한국 새벽 00:00~09:00 에는 UTC 가 아직 어제라, 인스턴트 차이를 올림하면
  // 하루가 더 나온다. 가장 나쁜 형태는 **예식 당일 새벽** 이다 — 결혼식 날
  // 아침에 "D-1" 이 나간다(2026-08-25 재현).
  //
  // 첫마디는 이미 `daysUntilWedding` 으로 고쳤는데 이 계산만 규칙 밖에 있었다.
  const dDay: number | null = weddingDate
    ? daysUntilWedding(weddingDate, Date.now())
    : null;
  // `daysUntilWedding` 은 계산할 수 없는 날짜에 null 을 준다. 예전 계산은
  // 항상 숫자였기 때문에 표기가 `D-${dDay}` 로 고정돼 있었다 — 그대로 두면
  // "D-null"·"D-0"·"D--3" 이 아모라에게 그대로 간다.
  const dDayLabel = dDay === null
    ? ""
    : dDay > 0
      ? ` (D-${dDay})`
      : dDay === 0
        ? " (D-Day)"
        : ` (D+${Math.abs(dDay)})`;

  const allKeys = Object.keys(CATEGORY_LABELS);
  // 화면과 같은 기준으로 센다. 저장값을 그대로 세면 항목이 늘었을 때 아모라만
  // "완료"라고 말하고 화면은 "진행 중"이라 그린다.
  const completedCount = allKeys.filter(
    (k) => resolveStatusByKey(k, progress[k]) === "completed"
  ).length;

  // 체크리스트 **세부 항목** 수를 함께 센다.
  //
  // 예전에는 카테고리 단위 숫자(completed_count)만 줬는데, 이름이 모호해서
  // 모델이 그것을 "완료한 항목 수"로 읽었다. 그래서 방금 체크리스트 항목을
  // 완료 처리한 직후에 아모라가 "완료된 세부 항목은 아직 없어요" 라고 답했다
  // (2026-08-24 운영 실측 — 프롬프트에는 `할일: 1/9완료` 가 정확히 실려 있었다).
  //
  // 라벨과 마찬가지로 **템플릿이 정본**이고 저장값에서는 done 만 가져온다.
  let checklistDone = 0;
  let checklistTotal = 0;
  for (const category of CATEGORY_CHECKLISTS) {
    const saved = (progress[category.key] as { checklist?: unknown } | undefined)?.checklist;
    const merged = mergePlanningChecklist(
      category.items,
      Array.isArray(saved) ? (saved as typeof category.items) : undefined,
    );
    checklistTotal += merged.length;
    checklistDone += merged.filter((item: { done?: boolean }) => item.done === true).length;
  }

  const categoryPercent = Math.round((completedCount / allKeys.length) * 100);
  return {
    toolName: "get_wedding_info",
    toolInput: {},
    toolOutput: {
      wedding_date: weddingDate,
      d_day: dDay,
      venue,
      total_budget: budget,
      progress_percent: categoryPercent,
      completed_count: completedCount,
      total_categories: allKeys.length,
      // 위 셋은 **카테고리** 단위다. 아래 둘이 체크리스트 세부 항목이다.
      completed_categories: completedCount,
      checklist_items_done: checklistDone,
      checklist_items_total: checklistTotal,
    },
    success: true,
    displayMessage: weddingDate
      ? `결혼 예정일: ${weddingDate}${dDayLabel} / 예산: ${budgetLabel} / 카테고리 진행률: ${categoryPercent}% (${completedCount}/${allKeys.length}) / 체크리스트 항목 ${checklistDone}/${checklistTotal} 완료`
      : `결혼 예정일 미설정 / 예산: ${budgetLabel} / 체크리스트 항목 ${checklistDone}/${checklistTotal} 완료`,
  };
}
