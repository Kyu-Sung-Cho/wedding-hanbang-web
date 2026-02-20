import { createClient } from "@supabase/supabase-js";
import type { ToolExecutionResult } from "@/types/database.types";

const CATEGORY_LABELS: Record<string, string> = {
  venue: "예식장",
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  ring: "예물",
  hanbok: "한복",
  honeymoon: "신혼여행",
  houseware: "혼수",
  invitation: "청첩장",
  gift: "답례품",
};

const STATUS_LABELS: Record<string, string> = {
  not_started: "시작전",
  in_progress: "진행중",
  completed: "완료",
};

const CATEGORY_RATIOS: Record<string, number> = {
  venue: 0.23,
  studio: 0.13,
  dress: 0.09,
  makeup: 0.06,
  ring: 0.14,
  hanbok: 0.04,
  honeymoon: 0.14,
  houseware: 0.09,
  invitation: 0.02,
  gift: 0.02,
  reserve: 0.04,
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
      case "get_budget_summary":
        return executeGetBudgetSummary(context);
      case "get_schedule_summary":
        return executeGetScheduleSummary(context);
      case "get_wedding_info":
        return executeGetWeddingInfo(context);
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
