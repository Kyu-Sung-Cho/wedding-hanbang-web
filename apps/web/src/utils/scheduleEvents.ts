import type {
  ScheduleEvent,
  ScheduleEventAssignee,
  ScheduleEventCancellation,
  ScheduleEventStatus,
} from "@/types/database.types";
import { readableTextOr, repairMojibakeDeep } from "@hanbang/shared";

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
  | "time"
  | "title"
  | "memo"
  | "categoryKey"
  | "sourceKey"
  | "momentType"
  | "status"
  | "cancellation"
  | "id"
  | "completionCriteria"
  | "assignee";

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
  time: 5,
  memo: 2_000,
  categoryKey: 100,
  sourceKey: 200,
  momentType: 100,
  completionCriteria: 500,
  cancellationReason: 500,
  externalAssigneeLabel: 80,
  createdAt: 100,
  updatedAt: 100,
} as const;

const OPTIONAL_EVENT_STRING_LIMITS = {
  time: SCHEDULE_EVENT_STRING_LIMITS.time,
  memo: SCHEDULE_EVENT_STRING_LIMITS.memo,
  categoryKey: SCHEDULE_EVENT_STRING_LIMITS.categoryKey,
  sourceKey: SCHEDULE_EVENT_STRING_LIMITS.sourceKey,
  momentType: SCHEDULE_EVENT_STRING_LIMITS.momentType,
  completionCriteria: SCHEDULE_EVENT_STRING_LIMITS.completionCriteria,
} as const;

const PROFILE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidScheduleProfileId(value: unknown): value is string {
  return typeof value === "string" && PROFILE_UUID_RE.test(value);
}

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

export function isValidScheduleTime(value: unknown): value is string {
  return typeof value === "string"
    && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isRequiredBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength;
}

function hasUnsafeDisplayCharacter(value: string): boolean {
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isScheduleEventStatus(value: unknown): value is ScheduleEventStatus {
  return value === "planned" || value === "completed" || value === "cancelled";
}

function isScheduleEventAssignee(value: unknown): value is ScheduleEventAssignee {
  if (!isRecord(value) || typeof value.kind !== "string") return false;

  if (value.kind === "member") {
    return hasOnlyKeys(value, ["kind", "profileId"])
      && isValidScheduleProfileId(value.profileId);
  }

  if (value.kind === "couple") {
    return hasOnlyKeys(value, ["kind"]);
  }

  if (value.kind === "external") {
    return hasOnlyKeys(value, ["kind", "label"])
      && isRequiredBoundedString(
        value.label,
        SCHEDULE_EVENT_STRING_LIMITS.externalAssigneeLabel,
      )
      && !hasUnsafeDisplayCharacter(value.label);
  }

  return false;
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

export function isScheduleEventCancellation(
  value: unknown,
): value is ScheduleEventCancellation {
  if (!isRecord(value) || !hasOnlyKeys(
    value,
    ["cancelledAt", "cancelledByProfileId", "reason"],
  )) {
    return false;
  }
  if (
    !isValidEventTimestamp(value.cancelledAt)
    || !isValidScheduleProfileId(value.cancelledByProfileId)
  ) {
    return false;
  }
  return value.reason === undefined
    || (
      isRequiredBoundedString(
        value.reason,
        SCHEDULE_EVENT_STRING_LIMITS.cancellationReason,
      )
      && !hasUnsafeDisplayCharacter(value.reason)
    );
}

function hasOnlyBoundedOptionalStrings(value: Record<string, unknown>): boolean {
  return Object.entries(OPTIONAL_EVENT_STRING_LIMITS).every(([key, maxLength]) => {
    const field = value[key];
    return field === undefined
      || (typeof field === "string" && field.length <= maxLength);
  });
}

export type ScheduleEventDraft = {
  date: string;
  time?: string;
  title: string;
  memo?: string;
  categoryKey?: string;
  sourceKey?: string;
  momentType?: string;
  status?: ScheduleEventStatus;
  completionCriteria?: string;
  assignee?: ScheduleEventAssignee;
};

function assertValidScheduleEventDraft(data: ScheduleEventDraft): void {
  if (!isValidScheduleYmd(data.date)) {
    throw new ScheduleEventValidationError("date");
  }
  if (data.time !== undefined && !isValidScheduleTime(data.time)) {
    throw new ScheduleEventValidationError("time");
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

  if (data.status !== undefined && !isScheduleEventStatus(data.status)) {
    throw new ScheduleEventValidationError("status");
  }
  if (data.status === "cancelled") {
    throw new ScheduleEventValidationError("status");
  }
  if (
    data.completionCriteria !== undefined
    && hasUnsafeDisplayCharacter(data.completionCriteria)
  ) {
    throw new ScheduleEventValidationError("completionCriteria");
  }
  if (data.assignee !== undefined && !isScheduleEventAssignee(data.assignee)) {
    throw new ScheduleEventValidationError("assignee");
  }
}

function isScheduleEvent(value: unknown): value is ScheduleEvent {
  return isRecord(value)
    && isRequiredBoundedString(value.id, SCHEDULE_EVENT_STRING_LIMITS.id)
    && isValidScheduleYmd(value.date)
    && (value.time === undefined || isValidScheduleTime(value.time))
    && isRequiredBoundedString(value.title, SCHEDULE_EVENT_STRING_LIMITS.title)
    && isValidEventTimestamp(value.createdAt)
    && isValidEventTimestamp(value.updatedAt)
    && hasOnlyBoundedOptionalStrings(value)
    && (
      typeof value.completionCriteria !== "string"
      || !hasUnsafeDisplayCharacter(value.completionCriteria)
    )
    && (value.status === undefined || isScheduleEventStatus(value.status))
    && (
      value.status === "cancelled"
        ? isScheduleEventCancellation(value.cancellation)
          && value.updatedAt === value.cancellation.cancelledAt
        : value.cancellation === undefined
    )
    && (value.assignee === undefined || isScheduleEventAssignee(value.assignee));
}

export function getScheduleEventStatus(event: ScheduleEvent): ScheduleEventStatus {
  return event.status ?? "planned";
}

/** 되살릴 수 없는 제목 자리에 들어가는 말. 화면마다 다르게 적지 않는다. */
export const UNREADABLE_EVENT_TITLE = "제목을 읽지 못한 일정";

/**
 * 화면에 그릴 일정 제목.
 *
 * 저장된 값이 이미 원문을 잃은 잔해(`?? ???`)면 그것을 사용자가 쓴 제목인 척
 * 그리지 않는다. 읽을 글자가 하나도 안 남았을 때만 물러나므로 `드레스 ?? 방문`
 * 처럼 절반이라도 읽히는 제목은 그대로 나온다.
 *
 * **저장값은 바꾸지 않는다.** 수정 창은 저장된 원래 값을 그대로 열어야 사용자가
 * 그 자리에서 다시 적을 수 있다 — 안내문이 입력칸에 미리 들어가면 그것을 저장해
 * 버린다.
 */
export function scheduleEventDisplayTitle(event: ScheduleEvent): string {
  return readableTextOr(event.title, UNREADABLE_EVENT_TITLE);
}

export type ScheduleEventAssigneeContext = {
  viewer?: {
    id: string;
    name?: string | null;
  } | null;
  partner?: {
    id: string;
    name?: string | null;
  } | null;
};

function getSafePersonLabel(name: string | null | undefined, fallback: string): string {
  return name?.trim() || fallback;
}

export function getScheduleEventAssigneeLabel(
  assignee: ScheduleEventAssignee | undefined,
  context: ScheduleEventAssigneeContext,
): string {
  if (!assignee) return "담당 미정";
  if (assignee.kind === "couple") return "함께";
  if (assignee.kind === "external") return `외부 · ${assignee.label}`;
  if (assignee.profileId === context.viewer?.id) {
    return `${getSafePersonLabel(context.viewer.name, "나")} (나)`;
  }
  if (assignee.profileId === context.partner?.id) {
    return `${getSafePersonLabel(context.partner.name, "파트너")} (파트너)`;
  }
  return "연결이 끊긴 기존 담당자";
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

/**
 * 예전에 잘못 읽혀 저장된 한글을 **검증보다 먼저** 되돌린다.
 *
 * ## 왜 검증 앞인가
 *
 * 처음에는 검증 뒤에 뒀다. 그런데 잘못 읽힌 한글에는 0x80~0x9F 자리 글자가 거의
 * 반드시 들어간다(UTF-8 뒷바이트가 그렇게 보인다). 그 자리는 C1 제어문자이고,
 * `hasUnsafeDisplayCharacter` 가 그것을 막는다. 즉 취소 사유·완료 기준·외부
 * 담당자 이름이 깨져 있으면 **그 일정 전체가 검증에서 탈락해 화면에서 사라진다.**
 * 검증 뒤에서 고치면 이미 사라진 것은 못 고친다.
 *
 * 먼저 되돌리면 그 일정이 되살아나고, 검증은 되돌린 값에 대해 그대로 돈다.
 * 되돌리기는 바이트 왕복이 정확히 맞고 결과에 한글이 나올 때만 값을 바꾸므로
 * 검증이 느슨해지지 않는다. 되돌린 글자는 언제나 원본보다 짧아서(라틴 세 글자 →
 * 한글 한 글자) 길이 제한을 새로 넘길 수도 없다.
 *
 * ## 왜 필드를 손으로 고르지 않나
 *
 * 제목·메모만 고르면 같은 줄의 취소 사유와 담당자 이름이 깨진 채 남는다. 목록을
 * 들고 다니면 새 필드가 생길 때마다 낡는다. 기계가 쓴 값(ID·날짜·분야 키)은
 * 전부 ASCII 라 되돌리기가 손대지 않으므로 그냥 전부 훑는다.
 *
 * ## 저장은 하지 않는다
 *
 * 다만 이 목록을 그대로 다시 저장하는 경로(`getEventsForMutation` →
 * `saveProgress`)를 지나면 되돌린 값이 함께 저장돼 그 행은 다음부터 깨끗해진다.
 */
function repairStoredScheduleEvent(raw: unknown): unknown {
  return repairMojibakeDeep(raw);
}

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
  const bounded = raw.slice(0, MAX_SCHEDULE_EVENTS).map(repairStoredScheduleEvent);
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
  if (
    inspection.malformedContainer
    || inspection.rejectedCount > 0
    || inspection.truncatedCount > 0
  ) {
    throw new ScheduleEventCapacityError();
  }
  if (new Set(inspection.events.map((event) => event.id)).size !== inspection.events.length) {
    throw new ScheduleEventValidationError("id");
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
  const activeEvents = events.filter(
    (event) => getScheduleEventStatus(event) !== "cancelled",
  );

  return (
    activeEvents.find((event) => event.sourceKey === sourceKey) ??
    (canonicalLabel
      ? activeEvents.find(
          (event) =>
            event.categoryKey === categoryKey &&
            normalizeText(event.title) === canonicalLabel
        )
      : undefined) ??
    (canonicalLabel
      ? activeEvents.find(
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
    time: data.time,
    title: data.title,
    memo: data.memo,
    categoryKey: data.categoryKey,
    sourceKey: data.sourceKey,
    momentType: data.momentType,
    status: data.status ?? "planned",
    completionCriteria: data.completionCriteria,
    assignee: data.assignee,
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
    (event) =>
      getScheduleEventStatus(event) !== "cancelled"
      && event.momentType === data.momentType
      && event.date === data.date
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
  data: ScheduleEventDraft,
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
    ...(Object.hasOwn(data, "time") ? { time: data.time } : {}),
    title: data.title,
    memo: data.memo ?? existing.memo,
    categoryKey: data.categoryKey ?? existing.categoryKey,
    sourceKey: sourceKey ?? existing.sourceKey,
    ...(Object.hasOwn(data, "status") ? { status: data.status } : {}),
    ...(Object.hasOwn(data, "completionCriteria")
      ? { completionCriteria: data.completionCriteria }
      : {}),
    ...(Object.hasOwn(data, "assignee") ? { assignee: data.assignee } : {}),
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
  updates: Partial<
    Pick<
      ScheduleEvent,
      | "date"
      | "time"
      | "title"
      | "memo"
      | "categoryKey"
      | "sourceKey"
      | "status"
      | "completionCriteria"
      | "assignee"
    >
  >
): Record<string, unknown> {
  const events = getEventsForMutation(progress);
  return {
    ...progress,
    [EVENTS_KEY]: events.map((event) => {
      if (event.id !== eventId) return event;
      if (getScheduleEventStatus(event) === "cancelled") {
        throw new ScheduleEventValidationError("status");
      }
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

// 변경 대상이 정확히 하나인지 확인해 중복 ID나 오래된 선택을 차단한다.
function requireUniqueTarget(
  events: ScheduleEvent[],
  eventId: string,
): ScheduleEvent {
  const matches = events.filter((event) => event.id === eventId);
  if (matches.length !== 1) {
    throw new ScheduleEventValidationError("id");
  }
  return matches[0];
}

/** 감사 정보를 남기며 일정 하나를 취소 상태로 전환한다. */
export function cancelEvent(
  progress: Record<string, unknown>,
  eventId: string,
  cancellation: ScheduleEventCancellation,
): Record<string, unknown> {
  const events = getEventsForMutation(progress);
  const target = requireUniqueTarget(events, eventId);
  if (
    getScheduleEventStatus(target) === "cancelled"
    || !isScheduleEventCancellation(cancellation)
  ) {
    throw new ScheduleEventValidationError("cancellation");
  }
  const cancelledEvent: ScheduleEvent = {
    ...target,
    status: "cancelled",
    cancellation,
    updatedAt: cancellation.cancelledAt,
  };
  return {
    ...progress,
    [EVENTS_KEY]: events.map((event) =>
      event.id === eventId ? cancelledEvent : event
    ),
  };
}

/** 이전 실행 상태를 추정하지 않고 안전한 planned 상태로 복원한다. */
export function restoreEvent(
  progress: Record<string, unknown>,
  eventId: string,
  restoredAt = new Date().toISOString(),
): Record<string, unknown> {
  const events = getEventsForMutation(progress);
  const target = requireUniqueTarget(events, eventId);
  if (
    getScheduleEventStatus(target) !== "cancelled"
    || !isScheduleEventCancellation(target.cancellation)
    || !isValidEventTimestamp(restoredAt)
    || Date.parse(restoredAt) <= Date.parse(target.cancellation.cancelledAt)
  ) {
    throw new ScheduleEventValidationError("cancellation");
  }
  const restoredEvent: ScheduleEvent = {
    ...target,
    status: "planned",
    updatedAt: restoredAt,
  };
  delete restoredEvent.cancellation;
  return {
    ...progress,
    [EVENTS_KEY]: events.map((event) =>
      event.id === eventId ? restoredEvent : event
    ),
  };
}
