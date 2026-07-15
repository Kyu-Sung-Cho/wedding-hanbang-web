export interface MobileScheduleEvent {
  id: string;
  date: string;
  title: string;
  time?: string;
  categoryKey?: string;
  sourceKey?: string;
  momentType?: string;
  memo?: string;
  createdAt: string;
  updatedAt: string;
}

type ScheduleEventMutation =
  | { operation: "add"; event: MobileScheduleEvent }
  | { operation: "update"; eventId: string; event: MobileScheduleEvent; expectedUpdatedAt: string }
  | { operation: "delete"; eventId: string; expectedUpdatedAt: string };

interface ScheduleEventMutationResult {
  progress: Record<string, unknown>;
  event: MobileScheduleEvent | null;
  eventId: string;
}

type ApiFetcher = (path: string, options?: RequestInit) => Promise<Response>;
type AuthoritativeScheduleProgress = Record<string, unknown> & {
  __events: MobileScheduleEvent[];
};

export class ScheduleEventConflictError extends Error {
  readonly progress: AuthoritativeScheduleProgress;

  constructor(message: string, progress: AuthoritativeScheduleProgress) {
    super(message);
    this.name = "ScheduleEventConflictError";
    this.progress = progress;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScheduleEvent(value: unknown): value is MobileScheduleEvent {
  if (!isRecord(value)) return false;
  if (["time", "categoryKey", "sourceKey", "momentType", "memo"].some(
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
  apiFetch: ApiFetcher,
): Promise<ScheduleEventMutationResult> {
  const response = await apiFetch("/api/journey/schedule-events", {
    method: "POST",
    body: JSON.stringify(mutation),
  });
  const body = await response.json().catch(() => null) as unknown;
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
  const requestedEventId = mutation.operation === "delete"
    ? mutation.eventId
    : mutation.event.id;
  const progressContainsEvent = isRecord(body) && isRecord(body.progress) &&
    Array.isArray(body.progress.__events) && body.progress.__events.some(
      (progressEvent) => isRecord(progressEvent) && progressEvent.id === requestedEventId,
    );
  const responseMatchesMutation = isRecord(body) && (mutation.operation === "delete"
    ? body.event === null && !progressContainsEvent
    : isRecord(body.event) && body.event.id === requestedEventId && progressContainsEvent);
  if (
    !isRecord(body) ||
    !isAuthoritativeProgress(body.progress) ||
    body.eventId !== requestedEventId ||
    !responseMatchesMutation ||
    (body.event !== null && !isScheduleEvent(body.event))
  ) {
    throw new Error("저장된 일정 상태를 확인하지 못했습니다. 화면을 새로고침해 주세요.");
  }
  return body as unknown as ScheduleEventMutationResult;
}
