import type { ScheduleEvent } from "@/types/database.types";

const EVENTS_KEY = "__events";

// progress JSONB에서 이벤트 배열 추출
export function getEvents(
  progress: Record<string, unknown>
): ScheduleEvent[] {
  const raw = (progress as Record<string, unknown>)[EVENTS_KEY];
  return (raw as ScheduleEvent[] | undefined) ?? [];
}

// 이벤트 추가 → 새 progress 반환
export function addEvent(
  progress: Record<string, unknown>,
  data: { date: string; title: string; memo?: string; categoryKey?: string }
): { newProgress: Record<string, unknown>; newEvent: ScheduleEvent } {
  const events = getEvents(progress);
  const now = new Date().toISOString();
  const newEvent: ScheduleEvent = {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    date: data.date,
    title: data.title,
    memo: data.memo,
    categoryKey: data.categoryKey,
    createdAt: now,
    updatedAt: now,
  };
  return {
    newProgress: { ...progress, [EVENTS_KEY]: [...events, newEvent] },
    newEvent,
  };
}

// 이벤트 수정 → 새 progress 반환
export function updateEvent(
  progress: Record<string, unknown>,
  eventId: string,
  updates: Partial<Pick<ScheduleEvent, "date" | "title" | "memo" | "categoryKey">>
): Record<string, unknown> {
  const events = getEvents(progress);
  return {
    ...progress,
    [EVENTS_KEY]: events.map((e) =>
      e.id === eventId
        ? { ...e, ...updates, updatedAt: new Date().toISOString() }
        : e
    ),
  };
}

// 이벤트 삭제 → 새 progress 반환
export function deleteEvent(
  progress: Record<string, unknown>,
  eventId: string
): Record<string, unknown> {
  const events = getEvents(progress);
  return {
    ...progress,
    [EVENTS_KEY]: events.filter((e) => e.id !== eventId),
  };
}
