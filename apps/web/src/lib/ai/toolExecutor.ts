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

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolExecutionResult> {
  try {
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
  } catch (err) {
    return {
      toolName,
      toolInput,
      toolOutput: { error: String(err) },
      success: false,
      displayMessage: "처리 중 오류가 발생했습니다.",
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

  // 총 예산은 단일 컬럼이라 그대로 갱신
  const { error: budgetError } = await admin
    .from("wedding_journeys")
    .update({ total_budget: totalBudget })
    .eq("couple_id", ctx.coupleId);
  if (budgetError) throw budgetError;
  ctx.weddingContext.budget = totalBudget;

  // 카테고리 배분은 원자적 patch — 동시 수정된 다른 키(__events 등) 보존
  await patchJourneyProgress(ctx, progressPatch);

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

  const categories = Object.entries(CATEGORY_RATIOS).map(([key, ratio]) => {
    const allocated = Math.round(total * ratio);
    const p = progress[key];
    let spent = 0;
    if (p?.status === "completed") spent = allocated;
    else if (p?.status === "in_progress") spent = Math.round(allocated * 0.4);

    return {
      key,
      label: CATEGORY_LABELS[key] || key,
      allocated,
      spent,
      status: p?.status || "not_started",
    };
  });

  const totalSpent = categories.reduce((s, c) => s + c.spent, 0);
  const remaining = total - totalSpent;

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
    displayMessage: `총 예산 ${formatWon(total)} / 사용 ${formatWon(totalSpent)} / 잔여 ${formatWon(remaining)}`,
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
