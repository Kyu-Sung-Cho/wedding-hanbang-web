import type { ScheduleEvent, ToolExecutionResult } from "@/types/database.types";
import { addDaysUtc, kstMidnightFromYmd, ymdInKst } from "@/lib/utils/kstDate";
import { CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import { getJourneyProgressCounts } from "@hanbang/shared";

export function executeGetScheduleSummary(
  ctx: ToolExecutionContext,
): ToolExecutionResult {
  const progress = ctx.weddingContext.progress;
  const counts = getJourneyProgressCounts(progress);
  const startedEntries = Object.entries(progress).filter(([key, value]) => {
    if (
      key.startsWith("__") ||
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      return false;
    }
    return getJourneyProgressCounts({ [key]: value }).categoryCount > 0;
  });
  const categoryLabel = ([key, value]: [string, unknown]) => {
    const item = value as Record<string, unknown>;
    return CATEGORY_LABELS[key] ??
      (typeof item.label === "string" ? item.label : key);
  };
  const completed = startedEntries.filter(
    ([, value]) => (value as Record<string, unknown>).status === "completed",
  );
  const inProgress = startedEntries.filter(
    ([, value]) => (value as Record<string, unknown>).status !== "completed",
  );
  const progressPercent =
    counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;

  return {
    toolName: "get_schedule_summary",
    toolInput: {},
    toolOutput: {
      total: counts.categoryCount,
      completed: completed.map(categoryLabel),
      in_progress: inProgress.map(categoryLabel),
      not_started: [],
      progress_percent: progressPercent,
    },
    success: true,
    displayMessage:
      counts.categoryCount === 0
        ? "아직 사용자가 직접 시작한 준비 기록이 없습니다."
        : `직접 기록한 ${counts.categoryCount}개 항목에서 체크 ${counts.done}/${counts.total} 완료(${progressPercent}%). 완료 ${completed.length}개, 진행 중 ${inProgress.length}개입니다.`,
  };
}

function getEventsFromProgress(
  progress: Record<string, unknown>,
): ScheduleEvent[] {
  return (progress.__events as ScheduleEvent[] | undefined) ?? [];
}

export function executeGetScheduleEvents(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext,
): ToolExecutionResult {
  const events = getEventsFromProgress(
    ctx.weddingContext.progress as Record<string, unknown>,
  );
  const today = ymdInKst();
  const fromDate = (input.from_date as string) || today;
  const toDate =
    (input.to_date as string) ||
    ymdInKst(addDaysUtc(kstMidnightFromYmd(fromDate), 30));
  const filtered = events
    .filter((event) => event.date >= fromDate && event.date <= toDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    toolName: "get_schedule_events",
    toolInput: input,
    toolOutput: {
      events: filtered,
      count: filtered.length,
      from_date: fromDate,
      to_date: toDate,
    },
    success: true,
    displayMessage:
      filtered.length > 0
        ? `${fromDate} ~ ${toDate} 기간에 사용자가 직접 등록한 일정 ${filtered.length}개: ${filtered.map((event) => `${event.date} ${event.title}`).join(", ")}`
        : `${fromDate} ~ ${toDate} 기간에 사용자가 직접 등록한 일정이 없습니다.`,
  };
}
