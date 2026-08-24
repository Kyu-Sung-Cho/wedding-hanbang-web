import type { ToolExecutionResult, ScheduleEvent } from "@/types/database.types";
import { stripPlanningChecklistNotes } from "@hanbang/shared/utils";
import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import { MOMENTS, type MomentType } from "@/constants/moments";
import { mergeChecklist, calculateStatus, resolveStatusByKey } from "@/utils/checklist";
import {
  addEvent,
  cancelEvent,
  getEvents,
  getCategoryEventSourceKey,
  getScheduleEventStatus,
  inspectScheduleEvents,
  isValidScheduleYmd,
  MAX_SCHEDULE_EVENTS,
  ScheduleEventCapacityError,
  ScheduleEventValidationError,
  restoreEvent,
  updateEvent,
  upsertMomentEvent,
} from "@/utils/scheduleEvents";
import { addDaysUtc, kstMidnightFromYmd, ymdInKst } from "@/lib/utils/kstDate";
import { CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";
import { patchJourneyProgress, saveProgress } from "@/lib/ai/tools/progressTools";
import { type ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

const PROFILE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function executeGetScheduleSummary(ctx: ToolExecutionContext): ToolExecutionResult {
  const progress = ctx.weddingContext.progress;
  const allKeys = CATEGORY_CHECKLISTS.map(({ key }) => key);

  // 저장값을 그대로 세면 항목이 늘었을 때 아모라가 화면과 다른 숫자를 말한다 —
  // 화면은 파생값으로 "진행 중"이라 그리는데 아모라는 "완료했어요"라고 한다.
  const statusOf = (key: string) => resolveStatusByKey(key, progress[key]) ?? "not_started";
  const completed = allKeys.filter((key) => statusOf(key) === "completed");
  const inProgress = allKeys.filter((key) => statusOf(key) === "in_progress");
  const notStarted = allKeys.filter((key) => statusOf(key) === "not_started");

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
  const time = input.time as string | undefined;
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

  let mutation: ReturnType<typeof addEvent>;
  try {
    mutation = addEvent(
      ctx.weddingContext.progress as Record<string, unknown>,
      {
        date,
        time,
        title,
        memo,
        categoryKey,
        sourceKey: categoryKey && categoryKey !== "general"
          ? getCategoryEventSourceKey(categoryKey)
          : undefined,
      },
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

  const { newProgress, newEvent: event } = mutation;
  await saveProgress(ctx, newProgress);

  return {
    toolName: "add_schedule_event", toolInput: input,
    toolOutput: { event },
    success: true,
    displayMessage: `${date}${time ? ` ${time}` : ""}에 "${title}" 일정이 추가되었습니다.`,
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
  if (input.time !== undefined) updates.time = input.time as string;

  const hasMeaningfulChange = Object.entries(updates).some(
    ([key, value]) => existing[key as keyof ScheduleEvent] !== value,
  );
  if (!hasMeaningfulChange) {
    return {
      toolName: "update_schedule_event",
      toolInput: input,
      toolOutput: { error: "no_change" },
      success: false,
      displayMessage: "일정에 바뀐 내용이 없어 변경하지 않았어요.",
    };
  }

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
    toolOutput: { event: updated, previous_event: existing, updates },
    success: true,
    displayMessage: `"${updated.title}" 일정이 수정되었습니다.`,
  };
}

export async function executeDeleteScheduleEvent(
  input: Record<string, unknown>,
  _ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  void _ctx;
  return {
    toolName: "delete_schedule_event", toolInput: input,
    toolOutput: { error: "legacy_schedule_delete_blocked" },
    success: false,
    displayMessage: "일정은 기록 보호를 위해 삭제하지 않아요. 취소 상태로 남겨 주세요.",
  };
}

export async function executeCancelScheduleEvent(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const eventId = input.event_id;
  if (
    typeof eventId !== "string"
    || typeof ctx.actorProfileId !== "string"
    || !PROFILE_UUID_RE.test(ctx.actorProfileId)
  ) {
    return {
      toolName: "cancel_schedule_event",
      toolInput: input,
      toolOutput: { error: "schedule_actor_missing" },
      success: false,
      displayMessage: "현재 변경을 처리하는 구성원을 안전하게 확인하지 못해 적용하지 않았어요.",
    };
  }
  const inputReason = input.reason;
  if (inputReason !== undefined && typeof inputReason !== "string") {
    return scheduleValidationFailure("cancel_schedule_event", input, "cancellation");
  }
  const reason = typeof inputReason === "string" ? inputReason.trim() : "";
  if (inputReason !== undefined && reason.length === 0) {
    return scheduleValidationFailure("cancel_schedule_event", input, "cancellation");
  }
  const progress = ctx.weddingContext.progress as Record<string, unknown>;
  const existing = inspectScheduleEvents(progress).events.find(
    (event) => event.id === eventId,
  );
  if (
    !existing
    || input.expected_title !== existing.title
    || input.expected_date !== existing.date
  ) {
    return {
      toolName: "cancel_schedule_event",
      toolInput: input,
      toolOutput: { error: "schedule_target_changed" },
      success: false,
      displayMessage: "선택한 일정의 제목이나 날짜가 달라져 적용하지 않았어요. 현재 일정을 다시 확인해 주세요.",
    };
  }
  try {
    const changedAt = new Date().toISOString();
    const nextProgress = cancelEvent(progress, eventId, {
      cancelledAt: changedAt,
      cancelledByProfileId: ctx.actorProfileId,
      ...(reason ? { reason } : {}),
    });
    const event = getEvents(nextProgress).find((candidate) => candidate.id === eventId);
    if (!existing || !event) {
      return scheduleValidationFailure("cancel_schedule_event", input, "event_id");
    }
    await saveProgress(ctx, nextProgress);
    return {
      toolName: "cancel_schedule_event",
      toolInput: input,
      toolOutput: { event, previous_event: existing },
      success: true,
      displayMessage: `“${event.title}” (${event.date}) 일정을 취소 상태로 남겼어요.`,
    };
  } catch (error) {
    if (error instanceof ScheduleEventValidationError) {
      return scheduleValidationFailure("cancel_schedule_event", input, "cancellation");
    }
    throw error;
  }
}

export async function executeRestoreScheduleEvent(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const eventId = input.event_id;
  if (
    typeof eventId !== "string"
    || typeof ctx.actorProfileId !== "string"
    || !PROFILE_UUID_RE.test(ctx.actorProfileId)
  ) {
    return {
      toolName: "restore_schedule_event",
      toolInput: input,
      toolOutput: { error: "schedule_actor_missing" },
      success: false,
      displayMessage: "현재 변경을 처리하는 구성원을 안전하게 확인하지 못해 적용하지 않았어요.",
    };
  }
  const progress = ctx.weddingContext.progress as Record<string, unknown>;
  const existing = inspectScheduleEvents(progress).events.find(
    (event) => event.id === eventId,
  );
  if (
    !existing
    || input.expected_title !== existing.title
    || input.expected_date !== existing.date
  ) {
    return {
      toolName: "restore_schedule_event",
      toolInput: input,
      toolOutput: { error: "schedule_target_changed" },
      success: false,
      displayMessage: "선택한 일정의 제목이나 날짜가 달라져 적용하지 않았어요. 현재 일정을 다시 확인해 주세요.",
    };
  }
  try {
    const nextProgress = restoreEvent(progress, eventId, new Date().toISOString());
    const event = getEvents(nextProgress).find((candidate) => candidate.id === eventId);
    if (!existing || !event) {
      return scheduleValidationFailure("restore_schedule_event", input, "event_id");
    }
    await saveProgress(ctx, nextProgress);
    return {
      toolName: "restore_schedule_event",
      toolInput: input,
      toolOutput: { event, previous_event: existing },
      success: true,
      displayMessage: `“${event.title}” (${event.date}) 일정을 예정 상태로 복원했어요.`,
    };
  } catch (error) {
    if (error instanceof ScheduleEventValidationError) {
      return scheduleValidationFailure("restore_schedule_event", input, "cancellation");
    }
    throw error;
  }
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
      // DB는 {id, label, done} 세 키만 받는다. 템플릿의 note를 떼고 보낸다.
      category, status: newStatus, checklist: stripPlanningChecklistNotes(updated),
    },
  });

  return {
    toolName: "toggle_checklist_item", toolInput: input,
    toolOutput: { category, item_id: itemId, done, new_status: newStatus, item_label: item.label },
    success: true,
    displayMessage: `${label} - "${item.label}" ${done ? "완료" : "미완료"}로 변경되었습니다.`,
  };
}

function scheduleEventForTool(event: ScheduleEvent): Record<string, unknown> {
  const status = getScheduleEventStatus(event);
  return {
    id: event.id,
    date: event.date,
    ...(event.time ? { time: event.time } : {}),
    title: event.title,
    ...(event.memo ? { memo: event.memo } : {}),
    ...(event.categoryKey ? { categoryKey: event.categoryKey } : {}),
    ...(event.momentType ? { momentType: event.momentType } : {}),
    status,
    ...(status === "cancelled" && event.cancellation
      ? {
          cancellation: {
            cancelledAt: event.cancellation.cancelledAt,
            ...(event.cancellation.reason
              ? { reason: event.cancellation.reason }
              : {}),
          },
        }
      : {}),
  };
}

export function executeGetScheduleEvents(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): ToolExecutionResult {
  const events = getEvents(ctx.weddingContext.progress as Record<string, unknown>);
  const today = ymdInKst();
  const statusFilter = input.status ?? "planned";
  if (
    statusFilter !== "planned"
    && statusFilter !== "cancelled"
    && statusFilter !== "all"
  ) {
    return {
      toolName: "get_schedule_events",
      toolInput: input,
      toolOutput: { error: "invalid_schedule_status", field: "status" },
      success: false,
      displayMessage: "조회할 일정 상태를 다시 확인해 주세요.",
    };
  }
  const hasExplicitRange = input.from_date !== undefined || input.to_date !== undefined;
  const fromDate = typeof input.from_date === "string"
    ? input.from_date
    : statusFilter === "cancelled" && !hasExplicitRange
      ? null
      : today;

  if (fromDate !== null && !isValidScheduleYmd(fromDate)) {
    return {
      toolName: "get_schedule_events",
      toolInput: input,
      toolOutput: { error: "invalid_date_range", field: "from_date" },
      success: false,
      displayMessage: "조회 시작 날짜를 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.",
    };
  }

  let toDate = typeof input.to_date === "string" ? input.to_date : null;
  if (!toDate && fromDate !== null) {
    toDate = ymdInKst(addDaysUtc(kstMidnightFromYmd(fromDate), 30));
  }

  if (
    (toDate !== null && !isValidScheduleYmd(toDate))
    || (fromDate !== null && toDate !== null && fromDate > toDate)
  ) {
    return {
      toolName: "get_schedule_events",
      toolInput: input,
      toolOutput: { error: "invalid_date_range", field: "to_date" },
      success: false,
      displayMessage: "조회 종료 날짜는 시작 날짜 이후의 실제 날짜여야 해요.",
    };
  }

  const filtered = events
    .filter((event) => {
      const status = getScheduleEventStatus(event);
      return (statusFilter === "all" || status === statusFilter)
        && (fromDate === null || event.date >= fromDate)
        && (toDate === null || event.date <= toDate);
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const rangeLabel = fromDate !== null && toDate !== null
    ? `${fromDate} ~ ${toDate} 기간`
    : statusFilter === "cancelled"
      ? "전체 취소 기록"
      : "등록 일정";
  const listLabel = statusFilter === "cancelled" ? "취소 일정" : "일정";
  const publicEvents = filtered.map(scheduleEventForTool);

  // 기본 조회 창은 30일인데, 결혼식은 보통 6~18개월 뒤라 등록된 일정 대부분이
  // 그 밖에 있다. 그래서 "등록된 일정 알려줘" 에 "없어요" 가 나왔다
  // (2026-08-24 운영 실측: 2027-04-10 일정이 있는데 없다고 답했다).
  //
  // 창은 그대로 두되 **밖에 무엇이 있는지 함께 준다.** 그래야 아모라가
  // "이 기간엔 없고 2027-04-10에 하나 있어요" 라고 사실대로 말할 수 있다.
  const outside = events
    .filter((event) => {
      const status = getScheduleEventStatus(event);
      if (statusFilter !== "all" && status !== statusFilter) return false;
      return (fromDate !== null && event.date < fromDate)
        || (toDate !== null && event.date > toDate);
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const nextOutside = toDate !== null
    ? outside.find((event) => event.date > toDate) ?? null
    : null;

  const outsideNote = outside.length > 0
    ? ` (이 기간 밖에 ${outside.length}개 더 있음${nextOutside ? `, 가장 가까운 것은 ${nextOutside.date} ${nextOutside.title}` : ""})`
    : "";

  return {
    toolName: "get_schedule_events", toolInput: input,
    toolOutput: {
      events: publicEvents,
      count: publicEvents.length,
      from_date: fromDate,
      to_date: toDate,
      status_filter: statusFilter,
      outside_range_count: outside.length,
      next_outside_range: nextOutside
        ? scheduleEventForTool(nextOutside)
        : null,
    },
    success: true,
    displayMessage: filtered.length > 0
      ? `${rangeLabel}의 ${filtered.length}개 ${listLabel}: ${filtered.map((event) => `${event.date} ${event.title}`).join(", ")}${outsideNote}`
      : `${rangeLabel}에 해당하는 ${listLabel}이 없습니다.${outsideNote}`,
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
