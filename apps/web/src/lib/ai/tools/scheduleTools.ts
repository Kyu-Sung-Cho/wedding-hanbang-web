import type { ToolExecutionResult, ScheduleEvent } from "@/types/database.types";
import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import { MOMENTS, type MomentType } from "@/constants/moments";
import { mergeChecklist, calculateStatus } from "@/utils/checklist";
import {
  getEvents,
  inspectScheduleEvents,
  isValidScheduleYmd,
  MAX_SCHEDULE_EVENTS,
  ScheduleEventCapacityError,
  ScheduleEventValidationError,
  updateEvent,
  upsertCategoryEvent,
  upsertMomentEvent,
} from "@/utils/scheduleEvents";
import { addDaysUtc, kstMidnightFromYmd, ymdInKst } from "@/lib/utils/kstDate";
import { CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";
import { patchJourneyProgress, saveProgress } from "@/lib/ai/tools/progressTools";
import {
  requireDestructiveConfirmation,
  type ToolExecutionContext,
} from "@/lib/ai/tools/toolTypes";

export function executeGetScheduleSummary(ctx: ToolExecutionContext): ToolExecutionResult {
  const progress = ctx.weddingContext.progress;
  const allKeys = CATEGORY_CHECKLISTS.map(({ key }) => key);

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

function scheduleCapacityFailure(
  toolName: string,
  input: Record<string, unknown>,
): ToolExecutionResult {
  return {
    toolName,
    toolInput: input,
    toolOutput: {
      error: "schedule_capacity_exceeded",
      limit: MAX_SCHEDULE_EVENTS,
    },
    success: false,
    displayMessage: `일정은 최대 ${MAX_SCHEDULE_EVENTS}개까지 저장할 수 있어요. 기존 일정을 정리한 뒤 다시 시도해 주세요.`,
  };
}

function scheduleValidationFailure(
  toolName: string,
  input: Record<string, unknown>,
  field: string,
): ToolExecutionResult {
  return {
    toolName,
    toolInput: input,
    toolOutput: { error: "invalid_schedule_event", field },
    success: false,
    displayMessage: "일정 내용이 올바르지 않아요. 날짜와 제목을 다시 확인해 주세요.",
  };
}

export async function executeAddScheduleEvent(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const date = input.date as string;
  const title = input.title as string;
  const memo = input.memo as string | undefined;
  const categoryKey = input.category_key as string | undefined;

  if (!isValidScheduleYmd(date)) {
    return {
      toolName: "add_schedule_event", toolInput: input,
      toolOutput: { error: "invalid_date", received: String(date) },
      success: false,
      displayMessage: "일정 날짜는 YYYY-MM-DD 형식이어야 합니다. 날짜를 다시 확인해주세요.",
    };
  }

  const inspection = inspectScheduleEvents(
    ctx.weddingContext.progress as Record<string, unknown>,
  );
  if (inspection.truncatedCount > 0) {
    return scheduleCapacityFailure("add_schedule_event", input);
  }

  let mutation: ReturnType<typeof upsertCategoryEvent>;
  try {
    mutation = upsertCategoryEvent(
      ctx.weddingContext.progress as Record<string, unknown>,
      { date, title, memo, categoryKey },
      CATEGORY_LABELS[categoryKey ?? ""],
    );
  } catch (error) {
    if (error instanceof ScheduleEventCapacityError) {
      return scheduleCapacityFailure("add_schedule_event", input);
    }
    if (error instanceof ScheduleEventValidationError) {
      return scheduleValidationFailure("add_schedule_event", input, error.field);
    }
    throw error;
  }

  const { newProgress, event, created } = mutation;
  await saveProgress(ctx, newProgress);

  return {
    toolName: "add_schedule_event", toolInput: input,
    toolOutput: {
      event,
      ...(created ? {} : { upserted: true, replaced_event_id: event.id }),
    },
    success: true,
    displayMessage: created
      ? `${date}에 "${title}" 일정이 추가되었습니다.`
      : `${CATEGORY_LABELS[categoryKey ?? ""] ?? title} 일정이 ${date}로 업데이트되었습니다.`,
  };
}

export async function executeUpdateScheduleEvent(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const eventId = input.event_id as string;
  const inspection = inspectScheduleEvents(
    ctx.weddingContext.progress as Record<string, unknown>,
  );
  if (inspection.truncatedCount > 0) {
    return scheduleCapacityFailure("update_schedule_event", input);
  }
  const events = inspection.events;
  const existing = events.find((event) => event.id === eventId);
  if (!existing) {
    return {
      toolName: "update_schedule_event", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: "수정할 일정을 찾지 못했어요. 일정 목록을 새로 불러온 뒤 다시 선택해 주세요.",
    };
  }

  const updates: Partial<ScheduleEvent> = {};
  if (input.date !== undefined) {
    if (!isValidScheduleYmd(input.date)) {
      return {
        toolName: "update_schedule_event", toolInput: input,
        toolOutput: { error: "invalid_date", received: String(input.date) },
        success: false,
        displayMessage: "일정 날짜는 YYYY-MM-DD 형식이어야 합니다. 날짜를 다시 확인해주세요.",
      };
    }
    updates.date = input.date as string;
  }
  if (input.title !== undefined) updates.title = input.title as string;
  if (input.memo !== undefined) updates.memo = input.memo as string;

  let newProgress: Record<string, unknown>;
  try {
    newProgress = updateEvent(
      ctx.weddingContext.progress as Record<string, unknown>,
      eventId,
      updates,
    );
  } catch (error) {
    if (error instanceof ScheduleEventValidationError) {
      return scheduleValidationFailure("update_schedule_event", input, error.field);
    }
    throw error;
  }
  await saveProgress(ctx, newProgress);
  const updated = getEvents(newProgress).find((event) => event.id === eventId)!;

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
  const inspection = inspectScheduleEvents(
    ctx.weddingContext.progress as Record<string, unknown>,
  );
  if (inspection.truncatedCount > 0) {
    return scheduleCapacityFailure("delete_schedule_event", input);
  }
  const events = inspection.events;
  const existing = events.find((event) => event.id === eventId);
  if (!existing) {
    return {
      toolName: "delete_schedule_event", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: "삭제할 일정을 찾지 못했어요. 일정 목록을 새로 불러온 뒤 다시 선택해 주세요.",
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
      displayMessage: "변경할 체크리스트 항목을 찾지 못했어요. 진행 현황을 새로 불러온 뒤 다시 선택해 주세요.",
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
  const events = getEvents(ctx.weddingContext.progress as Record<string, unknown>);
  const today = ymdInKst();
  const fromDate = (input.from_date as string) || today;

  if (!isValidScheduleYmd(fromDate)) {
    return {
      toolName: "get_schedule_events",
      toolInput: input,
      toolOutput: { error: "invalid_date_range", field: "from_date" },
      success: false,
      displayMessage: "조회 시작 날짜를 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.",
    };
  }

  let toDate = input.to_date as string;
  if (!toDate) {
    toDate = ymdInKst(addDaysUtc(kstMidnightFromYmd(fromDate), 30));
  }

  if (!isValidScheduleYmd(toDate) || fromDate > toDate) {
    return {
      toolName: "get_schedule_events",
      toolInput: input,
      toolOutput: { error: "invalid_date_range", field: "to_date" },
      success: false,
      displayMessage: "조회 종료 날짜는 시작 날짜 이후의 실제 날짜여야 해요.",
    };
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
  if (!isValidScheduleYmd(date)) {
    return {
      toolName: "log_wedding_event",
      toolInput: input,
      toolOutput: { error: "invalid_date", received: date },
      success: false,
      displayMessage: "날짜를 YYYY-MM-DD 형식으로 알려주세요.",
    };
  }

  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim().slice(0, 60)
      : def.label;
  const memo = typeof input.memo === "string" ? input.memo.slice(0, 300) : undefined;

  const inspection = inspectScheduleEvents(
    ctx.weddingContext.progress as Record<string, unknown>,
  );
  const existingMoment = inspection.events.some(
    (event) => event.momentType === momentType && event.date === date,
  );
  if (
    inspection.truncatedCount > 0
    || (!existingMoment && inspection.events.length >= MAX_SCHEDULE_EVENTS)
  ) {
    return scheduleCapacityFailure("log_wedding_event", input);
  }

  let mutation: ReturnType<typeof upsertMomentEvent>;
  try {
    mutation = upsertMomentEvent(
      ctx.weddingContext.progress as Record<string, unknown>,
      { momentType, date, title, memo },
    );
  } catch (error) {
    if (error instanceof ScheduleEventCapacityError) {
      return scheduleCapacityFailure("log_wedding_event", input);
    }
    throw error;
  }
  const { newProgress, event, created } = mutation;

  await saveProgress(ctx, newProgress);

  return {
    toolName: "log_wedding_event",
    toolInput: input,
    toolOutput: { event, created, moment_label: def.label },
    success: true,
    displayMessage: created
      ? `${date} "${title}" 일정을 저장했어요.`
      : `${date} "${title}" 일정을 업데이트했어요.`,
  };
}
