import { createClient } from "@supabase/supabase-js";
import type { ToolExecutionResult, ScheduleEvent } from "@/types/database.types";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { mergeChecklist, calculateStatus } from "@/utils/checklist";

const CATEGORY_LABELS: Record<string, string> = {
  meeting: "상견례",
  venue: "예식장",
  studio: "스튜디오",
  dress: "드레스/턱시도",
  makeup: "메이크업",
  ring: "예물(반지)",
  hanbok: "한복",
  yedan: "예단",
  honeymoon: "신혼여행",
  houseware: "혼수(가전/가구)",
  housing: "신혼집",
  invitation: "청첩장",
  snap: "본식 스냅/영상",
  shoes: "웨딩 구두",
  bouquet: "부케/꽃장식",
  gift: "답례품",
  mc: "사회/축가",
  ham: "함",
  pyebaek: "폐백",
};

const STATUS_LABELS: Record<string, string> = {
  not_started: "시작전",
  in_progress: "진행중",
  completed: "완료",
};

const CATEGORY_RATIOS: Record<string, number> = {
  meeting: 0.01,
  venue: 0.20,
  studio: 0.09,
  dress: 0.07,
  makeup: 0.04,
  ring: 0.10,
  hanbok: 0.03,
  yedan: 0.04,
  honeymoon: 0.10,
  houseware: 0.06,
  housing: 0.10,
  invitation: 0.02,
  snap: 0.04,
  shoes: 0.01,
  bouquet: 0.01,
  gift: 0.02,
  mc: 0.01,
  ham: 0.01,
  pyebaek: 0.01,
  reserve: 0.03,
};

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function formatWon(amount: number): string {
  if (amount >= 100000000) {
    return `${(amount / 100000000).toFixed(1)}억원`;
  }
  return `${Math.round(amount / 10000).toLocaleString()}만원`;
}

interface ExecutionContext {
  coupleId: string;
  weddingContext: {
    weddingDate: string | null;
    budget: number;
    venue: string | null;
    progress: Record<string, { category: string; status: string }>;
  };
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

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ wedding_date: newDate })
    .eq("couple_id", ctx.coupleId);

  if (error) throw error;

  ctx.weddingContext.weddingDate = newDate;

  const dDay = Math.ceil(
    (new Date(newDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
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

  const newProgress = {
    ...ctx.weddingContext.progress,
    [category]: { category, status },
  };

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ progress: newProgress })
    .eq("couple_id", ctx.coupleId);

  if (error) throw error;

  ctx.weddingContext.progress = newProgress;

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

  const newProgress = {
    ...ctx.weddingContext.progress,
    [category]: updates,
  };

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ progress: newProgress })
    .eq("couple_id", ctx.coupleId);
  if (error) throw error;

  ctx.weddingContext.progress = newProgress as unknown as ExecutionContext["weddingContext"]["progress"];

  return {
    toolName: "update_category_budget",
    toolInput: input,
    toolOutput: { category, label, ...updates },
    success: true,
    displayMessage: `${label} ${changes.join(", ")}(으)로 설정되었습니다.`,
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

function executeGetScheduleSummary(ctx: ExecutionContext): ToolExecutionResult {
  const progress = ctx.weddingContext.progress;
  const allKeys = Object.keys(CATEGORY_LABELS);

  const completed = allKeys.filter(
    (k) => progress[k]?.status === "completed"
  );
  const inProgress = allKeys.filter(
    (k) => progress[k]?.status === "in_progress"
  );
  const notStarted = allKeys.filter(
    (k) => !progress[k] || progress[k].status === "not_started"
  );

  return {
    toolName: "get_schedule_summary",
    toolInput: {},
    toolOutput: {
      total: allKeys.length,
      completed: completed.map((k) => CATEGORY_LABELS[k]),
      in_progress: inProgress.map((k) => CATEGORY_LABELS[k]),
      not_started: notStarted.map((k) => CATEGORY_LABELS[k]),
      progress_percent: Math.round((completed.length / allKeys.length) * 100),
    },
    success: true,
    displayMessage: `전체 ${allKeys.length}개 중 완료 ${completed.length}개, 진행중 ${inProgress.length}개, 시작전 ${notStarted.length}개 (${Math.round((completed.length / allKeys.length) * 100)}%)`,
  };
}

// ---- 일정 이벤트 관련 도구 ----

function getEventsFromProgress(progress: Record<string, unknown>): ScheduleEvent[] {
  return ((progress as Record<string, unknown>).__events as ScheduleEvent[] | undefined) ?? [];
}

async function executeAddScheduleEvent(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const date = input.date as string;
  const title = input.title as string;
  const memo = input.memo as string | undefined;
  const categoryKey = input.category_key as string | undefined;

  const events = getEventsFromProgress(ctx.weddingContext.progress as Record<string, unknown>);
  const now = new Date().toISOString();
  const newEvent: ScheduleEvent = {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    date, title, memo, categoryKey, createdAt: now, updatedAt: now,
  };

  const newProgress = { ...ctx.weddingContext.progress, __events: [...events, newEvent] };

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ progress: newProgress })
    .eq("couple_id", ctx.coupleId);
  if (error) throw error;

  ctx.weddingContext.progress = newProgress as unknown as ExecutionContext["weddingContext"]["progress"];

  return {
    toolName: "add_schedule_event", toolInput: input,
    toolOutput: { event: newEvent },
    success: true,
    displayMessage: `${date}에 "${title}" 일정이 추가되었습니다.`,
  };
}

async function executeUpdateScheduleEvent(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const eventId = input.event_id as string;
  const events = getEventsFromProgress(ctx.weddingContext.progress as Record<string, unknown>);
  const existing = events.find((e) => e.id === eventId);
  if (!existing) {
    return {
      toolName: "update_schedule_event", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: `일정을 찾을 수 없습니다 (ID: ${eventId})`,
    };
  }

  const updates: Partial<ScheduleEvent> = {};
  if (input.date) updates.date = input.date as string;
  if (input.title) updates.title = input.title as string;
  if (input.memo !== undefined) updates.memo = input.memo as string;

  const updatedEvents = events.map((e) =>
    e.id === eventId ? { ...e, ...updates, updatedAt: new Date().toISOString() } : e
  );
  const newProgress = { ...ctx.weddingContext.progress, __events: updatedEvents };

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ progress: newProgress })
    .eq("couple_id", ctx.coupleId);
  if (error) throw error;

  ctx.weddingContext.progress = newProgress as unknown as ExecutionContext["weddingContext"]["progress"];
  const updated = updatedEvents.find((e) => e.id === eventId)!;

  return {
    toolName: "update_schedule_event", toolInput: input,
    toolOutput: { event: updated, updates },
    success: true,
    displayMessage: `"${updated.title}" 일정이 수정되었습니다.`,
  };
}

async function executeDeleteScheduleEvent(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const eventId = input.event_id as string;
  const events = getEventsFromProgress(ctx.weddingContext.progress as Record<string, unknown>);
  const existing = events.find((e) => e.id === eventId);
  if (!existing) {
    return {
      toolName: "delete_schedule_event", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: `일정을 찾을 수 없습니다 (ID: ${eventId})`,
    };
  }

  const newProgress = {
    ...ctx.weddingContext.progress,
    __events: events.filter((e) => e.id !== eventId),
  };

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ progress: newProgress })
    .eq("couple_id", ctx.coupleId);
  if (error) throw error;

  ctx.weddingContext.progress = newProgress as unknown as ExecutionContext["weddingContext"]["progress"];

  return {
    toolName: "delete_schedule_event", toolInput: input,
    toolOutput: { deleted_event: existing },
    success: true,
    displayMessage: `"${existing.title}" (${existing.date}) 일정이 삭제되었습니다.`,
  };
}

async function executeToggleChecklistItem(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const category = input.category as string;
  const itemId = input.item_id as string;
  const done = input.done as boolean;
  const label = CATEGORY_LABELS[category] || category;

  const template = CHECKLIST_MAP[category];
  if (!template) {
    return {
      toolName: "toggle_checklist_item", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: `알 수 없는 카테고리: ${category}`,
    };
  }

  const existing = ctx.weddingContext.progress[category];
  const merged = mergeChecklist(
    template.items,
    (existing as { checklist?: { id: string; label: string; done: boolean }[] })?.checklist,
    (existing?.status as "not_started" | "in_progress" | "completed") ?? "not_started"
  );
  const updated = merged.map((c) => (c.id === itemId ? { ...c, done } : c));
  const newStatus = calculateStatus(updated);
  const item = updated.find((c) => c.id === itemId);

  if (!item) {
    return {
      toolName: "toggle_checklist_item", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: `항목을 찾을 수 없습니다 (ID: ${itemId})`,
    };
  }

  const newProgress = {
    ...ctx.weddingContext.progress,
    [category]: {
      ...(existing ?? { category }),
      category, status: newStatus, checklist: updated,
    },
  };

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ progress: newProgress })
    .eq("couple_id", ctx.coupleId);
  if (error) throw error;

  ctx.weddingContext.progress = newProgress as ExecutionContext["weddingContext"]["progress"];

  return {
    toolName: "toggle_checklist_item", toolInput: input,
    toolOutput: { category, item_id: itemId, done, new_status: newStatus, item_label: item.label },
    success: true,
    displayMessage: `${label} - "${item.label}" ${done ? "완료" : "미완료"}로 변경되었습니다.`,
  };
}

function executeGetScheduleEvents(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): ToolExecutionResult {
  const events = getEventsFromProgress(ctx.weddingContext.progress as Record<string, unknown>);
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = (input.from_date as string) || today;

  let toDate = input.to_date as string;
  if (!toDate) {
    const d = new Date(fromDate);
    d.setDate(d.getDate() + 30);
    toDate = d.toISOString().slice(0, 10);
  }

  const filtered = events
    .filter((e) => e.date >= fromDate && e.date <= toDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    toolName: "get_schedule_events", toolInput: input,
    toolOutput: {
      events: filtered,
      count: filtered.length,
      from_date: fromDate,
      to_date: toDate,
    },
    success: true,
    displayMessage: filtered.length > 0
      ? `${fromDate} ~ ${toDate} 기간에 ${filtered.length}개 일정: ${filtered.map((e) => `${e.date} ${e.title}`).join(", ")}`
      : `${fromDate} ~ ${toDate} 기간에 등록된 일정이 없습니다.`,
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
