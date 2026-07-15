import type { ScheduleEvent } from "@/types/database.types";

type ScheduleEventMutation =
  | { operation: "add"; event: ScheduleEvent }
  | { operation: "update"; eventId: string; event: ScheduleEvent; expectedUpdatedAt: string }
  | { operation: "delete"; eventId: string; expectedUpdatedAt: string };

export interface ScheduleEventMutationResult {
  progress: Record<string, unknown>;
  event: ScheduleEvent | null;
  eventId: string;
}

type AuthoritativeScheduleProgress = Record<string, unknown> & {
  __events: ScheduleEvent[];
};

export class ScheduleEventConflictError extends Error {
  readonly progress: Record<string, unknown>;

  constructor(message: string, progress: Record<string, unknown>) {
    super(message);
    this.name = "ScheduleEventConflictError";
    this.progress = progress;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScheduleEvent(value: unknown): value is ScheduleEvent {
  if (!isRecord(value)) return false;
  if (["time", "memo", "categoryKey", "sourceKey", "momentType"].some(
    (key) => value[key] !== undefined && typeof value[key] !== "string",
  )) {
    return false;
  }
  if (
    typeof value.time === "string" &&
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time)
  ) {
    return false;
  }
  return (
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
    typeof value.title === "string" && value.title.trim().length > 0 &&
    typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt)) &&
    typeof value.updatedAt === "string" && !Number.isNaN(Date.parse(value.updatedAt))
  );
}

function isAuthoritativeProgress(value: unknown): value is AuthoritativeScheduleProgress {
  if (!isRecord(value) || !Array.isArray(value.__events)) return false;
  if (!value.__events.every(isScheduleEvent)) return false;
  const eventIds = value.__events.map((event) => event.id);
  return new Set(eventIds).size === eventIds.length;
}

export async function mutateScheduleEvent(
  mutation: ScheduleEventMutation,
  fetcher: typeof fetch = fetch,
): Promise<ScheduleEventMutationResult> {
  const response = await fetcher("/api/journey/schedule-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mutation),
  });
  const body = await response.json().catch(() => null) as unknown;
  const requestedEventId = mutation.operation === "delete"
    ? mutation.eventId
    : mutation.event.id;

  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string"
      ? body.error
      : "일정을 저장하지 못했습니다.";
    if (
      response.status === 409 &&
      isRecord(body) &&
      isAuthoritativeProgress(body.progress)
    ) {
      throw new ScheduleEventConflictError(message, body.progress);
    }
    throw new Error(message);
  }

  if (
    !isRecord(body) ||
    !isAuthoritativeProgress(body.progress) ||
    typeof body.eventId !== "string" ||
    body.eventId !== requestedEventId ||
    (body.event !== null && !isScheduleEvent(body.event)) ||
    (mutation.operation === "delete"
      ? body.event !== null || body.progress.__events.some((event) => event.id === requestedEventId)
      : !isScheduleEvent(body.event) ||
        body.event.id !== requestedEventId ||
        !body.progress.__events.some((event) => event.id === requestedEventId))
  ) {
    throw new Error("저장된 일정 상태를 확인하지 못했습니다. 화면을 새로고침해 주세요.");
  }

  return {
    progress: body.progress,
    event: body.event,
    eventId: body.eventId,
  };
}
