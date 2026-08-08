const MAX_REVISION_BEFORE_UPDATE = Number.MAX_SAFE_INTEGER - 1;
const MAX_SCHEDULE_EVENTS = 500;
const MAX_CANCELLATION_REASON_LENGTH = 500;
const PROFILE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNSAFE_DISPLAY_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidScheduleYmd(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (year === 0) return false;

  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isValidEventTimestamp(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) {
    return false;
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !isValidScheduleYmd(match[1])) return false;
  return Number(match[2]) <= 23
    && Number(match[3]) <= 59
    && Number(match[4]) <= 59
    && Number.isFinite(Date.parse(value));
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function isValidScheduleEventCancellation(value) {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ["cancelledAt", "cancelledByProfileId", "reason"])
    || !isValidEventTimestamp(value.cancelledAt)
    || typeof value.cancelledByProfileId !== "string"
    || !PROFILE_UUID_RE.test(value.cancelledByProfileId)
  ) {
    return false;
  }
  return value.reason === undefined
    || (
      typeof value.reason === "string"
      && value.reason.trim().length > 0
      && value.reason.length <= MAX_CANCELLATION_REASON_LENGTH
      && !UNSAFE_DISPLAY_RE.test(value.reason)
    );
}

export function isCancelledScheduleEvent(event) {
  return isRecord(event)
    && event.status === "cancelled"
    && isValidScheduleEventCancellation(event.cancellation);
}

function hasValidCancellationState(event) {
  if (event.status === "cancelled") {
    return isValidScheduleEventCancellation(event.cancellation)
      && event.updatedAt === event.cancellation.cancelledAt;
  }
  return (event.status === undefined || event.status === "planned" || event.status === "completed")
    && event.cancellation === undefined;
}

function hasValidScheduleEventCore(event) {
  return isRecord(event)
    && typeof event.id === "string"
    && event.id.trim().length > 0
    && event.id.length <= 200
    && isValidScheduleYmd(event.date)
    && typeof event.title === "string"
    && event.title.trim().length > 0
    && event.title.length <= 500
    && !UNSAFE_DISPLAY_RE.test(event.title)
    && (event.time === undefined || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.time))
    && (event.memo === undefined || (typeof event.memo === "string" && event.memo.length <= 2_000))
    && (event.categoryKey === undefined
      || (typeof event.categoryKey === "string" && event.categoryKey.length <= 100))
    && (event.createdAt === undefined || isValidEventTimestamp(event.createdAt))
    && (event.updatedAt === undefined || isValidEventTimestamp(event.updatedAt));
}

function hasValidScheduleSnapshot(events) {
  return events.every(
    (event) => hasValidScheduleEventCore(event) && hasValidCancellationState(event),
  );
}

export function isActiveScheduleEvent(event) {
  return hasValidScheduleEventCore(event)
    && event.status !== "cancelled"
    && hasValidCancellationState(event);
}

export function validateScheduleEventDraft(input) {
  if (!isRecord(input)) return { ok: false, field: "draft" };

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length === 0 || title.length > 500) {
    return { ok: false, field: "title" };
  }
  if (!isValidScheduleYmd(input.date)) {
    return { ok: false, field: "date" };
  }

  const time = typeof input.time === "string" ? input.time.trim() : "";
  if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return { ok: false, field: "time" };
  }
  const memo = typeof input.memo === "string" ? input.memo.trim() : "";
  if (memo.length > 2_000) return { ok: false, field: "memo" };
  const categoryKey = typeof input.categoryKey === "string"
    ? input.categoryKey.trim()
    : "";
  if (categoryKey.length > 100) {
    return { ok: false, field: "categoryKey" };
  }

  return {
    ok: true,
    value: {
      date: input.date,
      title,
      ...(time ? { time } : {}),
      ...(memo ? { memo } : {}),
      ...(categoryKey ? { categoryKey } : {}),
    },
  };
}

export function isWritableJourneyRevision(value) {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_REVISION_BEFORE_UPDATE;
}

export function buildScheduleProgressPatch(expectedRevision, events) {
  if (!isWritableJourneyRevision(expectedRevision)) {
    throw new Error("INVALID_JOURNEY_REVISION");
  }
  if (!Array.isArray(events)) {
    throw new Error("INVALID_SCHEDULE_EVENTS");
  }
  if (events.length > MAX_SCHEDULE_EVENTS) {
    throw new Error("SCHEDULE_EVENT_CAPACITY_EXCEEDED");
  }

  const seenIds = new Set();
  for (const event of events) {
    if (
      !isRecord(event)
      || typeof event.id !== "string"
      || event.id.trim().length === 0
      || event.id.length > 200
    ) {
      throw new Error("INVALID_SCHEDULE_EVENT_ID");
    }
    if (!hasValidScheduleEventCore(event)) {
      throw new Error("INVALID_SCHEDULE_EVENT");
    }
    if (!hasValidCancellationState(event)) {
      throw new Error("INVALID_SCHEDULE_EVENT_CANCELLATION");
    }
    if (seenIds.has(event.id)) {
      throw new Error("DUPLICATE_SCHEDULE_EVENT_ID");
    }
    seenIds.add(event.id);
  }

  return {
    expected_revision: expectedRevision,
    progress_patch: { __events: [...events] },
  };
}

function countEventId(events, eventId) {
  return events.reduce(
    (count, event) => count + (event?.id === eventId ? 1 : 0),
    0,
  );
}

export function replaceScheduleEventById(events, eventId, replacement) {
  const snapshot = [...events];
  const matchCount = countEventId(snapshot, eventId);
  if (matchCount === 0) return { status: "missing", events: snapshot };
  if (matchCount !== 1) return { status: "ambiguous", events: snapshot };
  if (
    !hasValidScheduleSnapshot(snapshot)
    || !hasValidScheduleEventCore(replacement)
    || !hasValidCancellationState(replacement)
  ) {
    return { status: "invalid", events: snapshot };
  }

  return {
    status: "updated",
    events: snapshot.map((event) => event.id === eventId ? replacement : event),
  };
}

export function cancelScheduleEventById(events, eventId, cancellation) {
  const snapshot = [...events];
  const matchCount = countEventId(snapshot, eventId);
  if (matchCount === 0) return { status: "missing", events: snapshot };
  if (matchCount !== 1) return { status: "ambiguous", events: snapshot };
  if (
    !hasValidScheduleSnapshot(snapshot)
    || !isValidScheduleEventCancellation(cancellation)
  ) {
    return { status: "invalid", events: snapshot };
  }

  const target = snapshot.find((event) => event.id === eventId);
  if (isCancelledScheduleEvent(target)) {
    return { status: "invalid", events: snapshot };
  }

  return {
    status: "updated",
    events: snapshot.map((event) => event.id === eventId
      ? {
          ...event,
          status: "cancelled",
          cancellation,
          updatedAt: cancellation.cancelledAt,
        }
      : event),
  };
}

export function restoreScheduleEventById(events, eventId, restoredAt) {
  const snapshot = [...events];
  const matchCount = countEventId(snapshot, eventId);
  if (matchCount === 0) return { status: "missing", events: snapshot };
  if (matchCount !== 1) return { status: "ambiguous", events: snapshot };
  if (!hasValidScheduleSnapshot(snapshot) || !isValidEventTimestamp(restoredAt)) {
    return { status: "invalid", events: snapshot };
  }

  const target = snapshot.find((event) => event.id === eventId);
  if (
    !isCancelledScheduleEvent(target)
    || Date.parse(restoredAt) <= Date.parse(target.cancellation.cancelledAt)
  ) {
    return { status: "invalid", events: snapshot };
  }

  return {
    status: "updated",
    events: snapshot.map((event) => {
      if (event.id !== eventId) return event;
      const restored = {
        ...event,
        status: "planned",
        updatedAt: restoredAt,
      };
      delete restored.cancellation;
      return restored;
    }),
  };
}
