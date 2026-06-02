import type { ScheduleEvent } from "@/types/database.types";

const EVENTS_KEY = "__events";
const CATEGORY_EVENT_SOURCE_PREFIX = "category:";

export function getCategoryEventSourceKey(categoryKey: string): string {
  return `${CATEGORY_EVENT_SOURCE_PREFIX}${categoryKey}`;
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

// progress JSONB에서 이벤트 배열 추출
export function getEvents(
  progress: Record<string, unknown>
): ScheduleEvent[] {
  const raw = (progress as Record<string, unknown>)[EVENTS_KEY];
  return (raw as ScheduleEvent[] | undefined) ?? [];
}

export function findCategoryScheduleEvent(
  events: ScheduleEvent[],
  categoryKey: string | undefined,
  categoryLabel?: string
): ScheduleEvent | undefined {
  if (!categoryKey || categoryKey === "general") return undefined;

  const sourceKey = getCategoryEventSourceKey(categoryKey);
  const canonicalLabel = normalizeText(categoryLabel);

  return (
    events.find((event) => event.sourceKey === sourceKey) ??
    (canonicalLabel
      ? events.find(
          (event) =>
            event.categoryKey === categoryKey &&
            normalizeText(event.title) === canonicalLabel
        )
      : undefined) ??
    (canonicalLabel
      ? events.find(
          (event) =>
            event.categoryKey === categoryKey &&
            normalizeText(event.title).startsWith(canonicalLabel)
        )
      : undefined)
  );
}

// 이벤트 추가 → 새 progress 반환
export function addEvent(
  progress: Record<string, unknown>,
  data: { date: string; title: string; memo?: string; categoryKey?: string; sourceKey?: string }
): { newProgress: Record<string, unknown>; newEvent: ScheduleEvent } {
  const events = getEvents(progress);
  const now = new Date().toISOString();
  const newEvent: ScheduleEvent = {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    date: data.date,
    title: data.title,
    memo: data.memo,
    categoryKey: data.categoryKey,
    sourceKey: data.sourceKey,
    createdAt: now,
    updatedAt: now,
  };
  return {
    newProgress: { ...progress, [EVENTS_KEY]: [...events, newEvent] },
    newEvent,
  };
}

export function upsertCategoryEvent(
  progress: Record<string, unknown>,
  data: { date: string; title: string; memo?: string; categoryKey?: string; sourceKey?: string },
  categoryLabel?: string
): { newProgress: Record<string, unknown>; event: ScheduleEvent; created: boolean } {
  const events = getEvents(progress);
  const existing = findCategoryScheduleEvent(events, data.categoryKey, categoryLabel);
  const sourceKey =
    data.categoryKey && data.categoryKey !== "general"
      ? data.sourceKey ?? getCategoryEventSourceKey(data.categoryKey)
      : data.sourceKey;

  if (!existing) {
    const { newProgress, newEvent } = addEvent(progress, {
      ...data,
      sourceKey,
    });
    return { newProgress, event: newEvent, created: true };
  }

  const updatedEvent: ScheduleEvent = {
    ...existing,
    date: data.date,
    title: data.title,
    memo: data.memo ?? existing.memo,
    categoryKey: data.categoryKey ?? existing.categoryKey,
    sourceKey: sourceKey ?? existing.sourceKey,
    updatedAt: new Date().toISOString(),
  };

  return {
    newProgress: {
      ...progress,
      [EVENTS_KEY]: events.map((event) =>
        event.id === existing.id ? updatedEvent : event
      ),
    },
    event: updatedEvent,
    created: false,
  };
}

// 이벤트 수정 → 새 progress 반환
export function updateEvent(
  progress: Record<string, unknown>,
  eventId: string,
  updates: Partial<Pick<ScheduleEvent, "date" | "title" | "memo" | "categoryKey" | "sourceKey">>
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
