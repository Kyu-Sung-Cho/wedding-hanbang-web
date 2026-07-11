import type { ToolExecutionResult, ScheduleEvent } from "@/types/database.types";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { MOMENTS, type MomentType } from "@/constants/moments";
import { mergeChecklist, calculateStatus } from "@/utils/checklist";
import { upsertMomentEvent } from "@/utils/scheduleEvents";
import { addDaysUtc, kstMidnightFromYmd, ymdInKst } from "@/lib/utils/kstDate";
import { CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";
import { patchJourneyProgress, saveProgress } from "@/lib/ai/tools/progressTools";
import {
  requireDestructiveConfirmation,
  type ToolExecutionContext,
} from "@/lib/ai/tools/toolTypes";
import { differenceInDateOnlyDays } from "@hanbang/shared";

export function executeGetScheduleSummary(ctx: ToolExecutionContext): ToolExecutionResult {
  const progress = ctx.weddingContext.progress;
  const allKeys = Object.keys(CATEGORY_LABELS);

  const completed = allKeys.filter(
    (key) => progress[key]?.status === "completed"
  );
  const inProgress = allKeys.filter(
    (key) => progress[key]?.status === "in_progress"
  );
  const notStarted = allKeys.filter(
    (key) => !progress[key] || progress[key].status === "not_started"
  );

  return {
    toolName: "get_schedule_summary",
    toolInput: {},
    toolOutput: {
      total: allKeys.length,
      completed: completed.map((key) => CATEGORY_LABELS[key]),
      in_progress: inProgress.map((key) => CATEGORY_LABELS[key]),
      not_started: notStarted.map((key) => CATEGORY_LABELS[key]),
      progress_percent: Math.round((completed.length / allKeys.length) * 100),
    },
    success: true,
    displayMessage: `전체 ${allKeys.length}개 중 완료 ${completed.length}개, 진행중 ${inProgress.length}개, 시작전 ${notStarted.length}개 (${Math.round((completed.length / allKeys.length) * 100)}%)`,
  };
}

function getEventsFromProgress(progress: Record<string, unknown>): ScheduleEvent[] {
  return ((progress as Record<string, unknown>).__events as ScheduleEvent[] | undefined) ?? [];
}

function getCategoryEventSourceKey(categoryKey: string): string {
  return `category:${categoryKey}`;
}

function normalizeEventText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function findCategoryScheduleEvent(
  events: ScheduleEvent[],
  categoryKey: string | undefined
): ScheduleEvent | undefined {
  if (!categoryKey || categoryKey === "general") return undefined;

  const sourceKey = getCategoryEventSourceKey(categoryKey);
  const label = normalizeEventText(CATEGORY_LABELS[categoryKey]);

  return (
    events.find((event) => event.sourceKey === sourceKey) ??
    (label
      ? events.find(
          (event) =>
            event.categoryKey === categoryKey &&
            normalizeEventText(event.title) === label
        )
      : undefined) ??
    (label
      ? events.find(
          (event) =>
            event.categoryKey === categoryKey &&
            normalizeEventText(event.title).startsWith(label)
        )
      : undefined)
  );
}

const EVENT_YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidEventDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    EVENT_YMD_RE.test(value) &&
    differenceInDateOnlyDays(value, value) !== null
  );
}

export async function executeAddScheduleEvent(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const date = input.date as string;
  const title = input.title as string;
  const memo = input.memo as string | undefined;
  const categoryKey = input.category_key as string | undefined;

  if (!isValidEventDate(date)) {
    return {
      toolName: "add_schedule_event", toolInput: input,
      toolOutput: { error: "invalid_date", received: String(date) },
      success: false,
      displayMessage: "일정 날짜는 YYYY-MM-DD 형식이어야 합니다. 날짜를 다시 확인해주세요.",
    };
  }

  const events = getEventsFromProgress(ctx.weddingContext.progress as Record<string, unknown>);
  const now = new Date().toISOString();
  const existingCategoryEvent = findCategoryScheduleEvent(events, categoryKey);
  const sourceKey =
    categoryKey && categoryKey !== "general"
      ? getCategoryEventSourceKey(categoryKey)
      : undefined;

  if (existingCategoryEvent) {
    const updatedEvent: ScheduleEvent = {
      ...existingCategoryEvent,
      date,
      title,
      memo: memo ?? existingCategoryEvent.memo,
      categoryKey,
      sourceKey,
      updatedAt: now,
    };
    const updatedEvents = events.map((event) =>
      event.id === existingCategoryEvent.id ? updatedEvent : event
    );
    await patchJourneyProgress(ctx, { __events: updatedEvents });

    return {
      toolName: "add_schedule_event",
      toolInput: input,
      toolOutput: { event: updatedEvent, upserted: true, replaced_event_id: existingCategoryEvent.id },
      success: true,
      displayMessage: `${CATEGORY_LABELS[categoryKey ?? ""] ?? title} 일정이 ${date}로 업데이트되었습니다.`,
    };
  }

  const newEvent: ScheduleEvent = {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    date, title, memo, categoryKey, sourceKey, createdAt: now, updatedAt: now,
  };

  await patchJourneyProgress(ctx, { __events: [...events, newEvent] });

  return {
    toolName: "add_schedule_event", toolInput: input,
    toolOutput: { event: newEvent },
    success: true,
    displayMessage: `${date}에 "${title}" 일정이 추가되었습니다.`,
  };
}

export async function executeUpdateScheduleEvent(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const eventId = input.event_id as string;
  const events = getEventsFromProgress(ctx.weddingContext.progress as Record<string, unknown>);
  const existing = events.find((event) => event.id === eventId);
  if (!existing) {
    return {
      toolName: "update_schedule_event", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: `일정을 찾을 수 없습니다 (ID: ${eventId})`,
    };
  }

  const updates: Partial<ScheduleEvent> = {};
  if (input.date) {
    if (!isValidEventDate(input.date)) {
      return {
        toolName: "update_schedule_event", toolInput: input,
        toolOutput: { error: "invalid_date", received: String(input.date) },
        success: false,
        displayMessage: "일정 날짜는 YYYY-MM-DD 형식이어야 합니다. 날짜를 다시 확인해주세요.",
      };
    }
    updates.date = input.date as string;
  }
  if (input.title) updates.title = input.title as string;
  if (input.memo !== undefined) updates.memo = input.memo as string;

  const updatedEvents = events.map((event) =>
    event.id === eventId ? { ...event, ...updates, updatedAt: new Date().toISOString() } : event
  );
  await patchJourneyProgress(ctx, { __events: updatedEvents });
  const updated = updatedEvents.find((event) => event.id === eventId)!;

  return {
    toolName: "update_schedule_event", toolInput: input,
    toolOutput: { event: updated, updates },
    success: true,
    displayMessage: `"${updated.title}" 일정이 수정되었습니다.`,
  };
}

export async function executeDeleteScheduleEvent(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const confirmation = requireDestructiveConfirmation(
    "delete_schedule_event",
    input,
    "일정을 삭제하려면 먼저 사용자 확인이 필요합니다. 삭제할 일정을 다시 확인해주세요."
  );
  if (confirmation) return confirmation;

  const eventId = input.event_id as string;
  const events = getEventsFromProgress(ctx.weddingContext.progress as Record<string, unknown>);
  const existing = events.find((event) => event.id === eventId);
  if (!existing) {
    return {
      toolName: "delete_schedule_event", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: `일정을 찾을 수 없습니다 (ID: ${eventId})`,
    };
  }

  await patchJourneyProgress(ctx, { __events: events.filter((event) => event.id !== eventId) });

  return {
    toolName: "delete_schedule_event", toolInput: input,
    toolOutput: { deleted_event: existing },
    success: true,
    displayMessage: `"${existing.title}" (${existing.date}) 일정이 삭제되었습니다.`,
  };
}

export async function executeToggleChecklistItem(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
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
  const updated = merged.map((checklistItem) => (checklistItem.id === itemId ? { ...checklistItem, done } : checklistItem));
  const newStatus = calculateStatus(updated);
  const item = updated.find((checklistItem) => checklistItem.id === itemId);

  if (!item) {
    return {
      toolName: "toggle_checklist_item", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: `항목을 찾을 수 없습니다 (ID: ${itemId})`,
    };
  }

  await patchJourneyProgress(ctx, {
    [category]: {
      ...(existing ?? { category }),
      category, status: newStatus, checklist: updated,
    },
  });

  return {
    toolName: "toggle_checklist_item", toolInput: input,
    toolOutput: { category, item_id: itemId, done, new_status: newStatus, item_label: item.label },
    success: true,
    displayMessage: `${label} - "${item.label}" ${done ? "완료" : "미완료"}로 변경되었습니다.`,
  };
}

export function executeGetScheduleEvents(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): ToolExecutionResult {
  const events = getEventsFromProgress(ctx.weddingContext.progress as Record<string, unknown>);
  const today = ymdInKst();
  const fromDate = (input.from_date as string) || today;

  let toDate = input.to_date as string;
  if (!toDate) {
    toDate = ymdInKst(addDaysUtc(kstMidnightFromYmd(fromDate), 30));
  }

  const filtered = events
    .filter((event) => event.date >= fromDate && event.date <= toDate)
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
      ? `${fromDate} ~ ${toDate} 기간에 ${filtered.length}개 일정: ${filtered.map((event) => `${event.date} ${event.title}`).join(", ")}`
      : `${fromDate} ~ ${toDate} 기간에 등록된 일정이 없습니다.`,
  };
}

export async function executeLogWeddingEvent(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const momentType = String(input.moment_type ?? "");
  const def = MOMENTS[momentType as MomentType];
  if (!def || def.trigger !== "event") {
    return {
      toolName: "log_wedding_event",
      toolInput: input,
      toolOutput: { error: "unsupported moment_type" },
      success: false,
      displayMessage: "지원하지 않는 일정 종류예요.",
    };
  }

  const date = String(input.date ?? "");
  if (differenceInDateOnlyDays(date, date) === null) {
    return {
      toolName: "log_wedding_event",
      toolInput: input,
      toolOutput: { error: "invalid date" },
      success: false,
      displayMessage: "날짜를 YYYY-MM-DD 형식으로 알려주세요.",
    };
  }

  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim().slice(0, 60)
      : def.label;
  const memo = typeof input.memo === "string" ? input.memo.slice(0, 300) : undefined;

  const { newProgress, event, created } = upsertMomentEvent(
    ctx.weddingContext.progress as Record<string, unknown>,
    { momentType, date, title, memo }
  );

  await saveProgress(ctx, newProgress);

  return {
    toolName: "log_wedding_event",
    toolInput: input,
    toolOutput: { event, created, moment_label: def.label },
    success: true,
    displayMessage: created
      ? `${date} "${title}" 일정을 저장했어요. 3일 전에 챙길 것, 전날 체크리스트, 다음날 안부까지 제가 먼저 챙길게요.`
      : `${date} "${title}" 일정을 업데이트했어요.`,
  };
}
