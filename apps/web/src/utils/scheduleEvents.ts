import type { ScheduleEvent } from "@/types/database.types";
export { sanitizeUserFacingScheduleMemo } from "@hanbang/shared";

const EVENTS_KEY = "__events";
const CATEGORY_EVENT_SOURCE_PREFIX = "category:";
export const MAX_SCHEDULE_EVENTS = 500;

export class ScheduleEventCapacityError extends Error {
  readonly code = "schedule_capacity_exceeded";

  constructor() {
    super(`Schedule event capacity (${MAX_SCHEDULE_EVENTS}) has been reached.`);
    this.name = "ScheduleEventCapacityError";
  }
}

export type ScheduleEventDraftField =
  | "date"
  | "title"
  | "memo"
  | "categoryKey"
  | "sourceKey"
  | "momentType";

export class ScheduleEventValidationError extends Error {
  readonly code = "invalid_schedule_event";

  constructor(readonly field: ScheduleEventDraftField) {
    super(`Invalid schedule event field: ${field}`);
    this.name = "ScheduleEventValidationError";
  }
}

export const SCHEDULE_EVENT_STRING_LIMITS = {
  id: 200,
  title: 500,
  memo: 2_000,
  categoryKey: 100,
  sourceKey: 200,
  momentType: 100,
  createdAt: 100,
  updatedAt: 100,
} as const;

const OPTIONAL_EVENT_STRING_LIMITS = {
  memo: SCHEDULE_EVENT_STRING_LIMITS.memo,
  categoryKey: SCHEDULE_EVENT_STRING_LIMITS.categoryKey,
  sourceKey: SCHEDULE_EVENT_STRING_LIMITS.sourceKey,
  momentType: SCHEDULE_EVENT_STRING_LIMITS.momentType,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isValidScheduleYmd(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year === 0) return false;

  // setUTCFullYear avoids Date.UTC's special 1900 offset for years 00-99.
  // The component round-trip rejects rollover dates such as 2027-02-29.
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isRequiredBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength;
}

function isValidEventTimestamp(value: unknown): value is string {
  if (!isRequiredBoundedString(value, SCHEDULE_EVENT_STRING_LIMITS.createdAt)) return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !isValidScheduleYmd(match[1])) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  return hour <= 23
    && minute <= 59
    && second <= 59
    && Number.isFinite(Date.parse(value));
}

function hasOnlyBoundedOptionalStrings(value: Record<string, unknown>): boolean {
  return Object.entries(OPTIONAL_EVENT_STRING_LIMITS).every(([key, maxLength]) => {
    const field = value[key];
    return field === undefined
      || (typeof field === "string" && field.length <= maxLength);
  });
}

type ScheduleEventDraft = {
  date: string;
  title: string;
  memo?: string;
  categoryKey?: string;
  sourceKey?: string;
  momentType?: string;
};

function assertValidScheduleEventDraft(data: ScheduleEventDraft): void {
  if (!isValidScheduleYmd(data.date)) {
    throw new ScheduleEventValidationError("date");
  }
  if (!isRequiredBoundedString(data.title, SCHEDULE_EVENT_STRING_LIMITS.title)) {
    throw new ScheduleEventValidationError("title");
  }

  for (const [field, maxLength] of Object.entries(OPTIONAL_EVENT_STRING_LIMITS)) {
    const value = data[field as keyof ScheduleEventDraft];
    if (value !== undefined && (typeof value !== "string" || value.length > maxLength)) {
      throw new ScheduleEventValidationError(field as ScheduleEventDraftField);
    }
  }
}

function isScheduleEvent(value: unknown): value is ScheduleEvent {
  return isRecord(value)
    && isRequiredBoundedString(value.id, SCHEDULE_EVENT_STRING_LIMITS.id)
    && isValidScheduleYmd(value.date)
    && isRequiredBoundedString(value.title, SCHEDULE_EVENT_STRING_LIMITS.title)
    && isValidEventTimestamp(value.createdAt)
    && isValidEventTimestamp(value.updatedAt)
    && hasOnlyBoundedOptionalStrings(value);
}

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
  return inspectScheduleEvents(progress).events;
}

export type ScheduleEventInspection = {
  events: ScheduleEvent[];
  malformedContainer: boolean;
  rejectedCount: number;
  truncatedCount: number;
};

export function inspectScheduleEvents(
  progress: Record<string, unknown>,
): ScheduleEventInspection {
  const raw = progress[EVENTS_KEY];
  if (raw === undefined) {
    return { events: [], malformedContainer: false, rejectedCount: 0, truncatedCount: 0 };
  }
  if (!Array.isArray(raw)) {
    return { events: [], malformedContainer: true, rejectedCount: 0, truncatedCount: 0 };
  }
  // `progress` is user-controlled JSONB. Bound work before validation so a
  // malformed or enormous array cannot crash or monopolize a cron/API worker.
  const bounded = raw.slice(0, MAX_SCHEDULE_EVENTS);
  const events = bounded.filter(isScheduleEvent);
  return {
    events,
    malformedContainer: false,
    rejectedCount: bounded.length - events.length,
    truncatedCount: Math.max(0, raw.length - MAX_SCHEDULE_EVENTS),
  };
}

function getEventsForMutation(progress: Record<string, unknown>): ScheduleEvent[] {
  const inspection = inspectScheduleEvents(progress);
  if (inspection.truncatedCount > 0) {
    throw new ScheduleEventCapacityError();
  }
  return inspection.events;
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
  data: ScheduleEventDraft,
): { newProgress: Record<string, unknown>; newEvent: ScheduleEvent } {
  assertValidScheduleEventDraft(data);
  const events = getEventsForMutation(progress);
  if (events.length >= MAX_SCHEDULE_EVENTS) {
    throw new ScheduleEventCapacityError();
  }
  const now = new Date().toISOString();
  const newEvent: ScheduleEvent = {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    date: data.date,
    title: data.title,
    memo: data.memo,
    categoryKey: data.categoryKey,
    sourceKey: data.sourceKey,
    momentType: data.momentType,
    createdAt: now,
    updatedAt: now,
  };
  return {
    newProgress: { ...progress, [EVENTS_KEY]: [...events, newEvent] },
    newEvent,
  };
}

/**
 * 모멘트 이벤트 upsert — (momentType, date) 기준 중복 방지.
 * 같은 momentType이라도 날짜가 다르면 별개 이벤트(청첩장 모임 그룹별 복수 가능).
 */
export function upsertMomentEvent(
  progress: Record<string, unknown>,
  data: { momentType: string; date: string; title: string; memo?: string }
): { newProgress: Record<string, unknown>; event: ScheduleEvent; created: boolean } {
  assertValidScheduleEventDraft(data);
  const events = getEventsForMutation(progress);
  const existing = events.find(
    (event) => event.momentType === data.momentType && event.date === data.date
  );

  if (!existing) {
    const { newProgress, newEvent } = addEvent(progress, {
      date: data.date,
      title: data.title,
      memo: data.memo,
      momentType: data.momentType,
    });
    return { newProgress, event: newEvent, created: true };
  }

  const updatedEvent: ScheduleEvent = {
    ...existing,
    title: data.title || existing.title,
    memo: data.memo ?? existing.memo,
    updatedAt: new Date().toISOString(),
  };
  return {
    newProgress: {
      ...progress,
      [EVENTS_KEY]: events.map((event) => (event.id === existing.id ? updatedEvent : event)),
    },
    event: updatedEvent,
    created: false,
  };
}

export function upsertCategoryEvent(
  progress: Record<string, unknown>,
  data: { date: string; title: string; memo?: string; categoryKey?: string; sourceKey?: string },
  categoryLabel?: string
): { newProgress: Record<string, unknown>; event: ScheduleEvent; created: boolean } {
  assertValidScheduleEventDraft(data);
  const events = getEventsForMutation(progress);
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
  const events = getEventsForMutation(progress);
  return {
    ...progress,
    [EVENTS_KEY]: events.map((event) => {
      if (event.id !== eventId) return event;
      const updatedEvent: ScheduleEvent = {
        ...event,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      assertValidScheduleEventDraft(updatedEvent);
      return updatedEvent;
    }),
  };
}

// 이벤트 삭제 → 새 progress 반환
export function deleteEvent(
  progress: Record<string, unknown>,
  eventId: string
): Record<string, unknown> {
  const events = getEventsForMutation(progress);
  return {
    ...progress,
    [EVENTS_KEY]: events.filter((e) => e.id !== eventId),
  };
}
