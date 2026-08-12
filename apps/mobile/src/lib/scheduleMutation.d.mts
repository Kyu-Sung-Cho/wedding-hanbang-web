export interface ScheduleMutationEvent {
  id: string;
  date: string;
  title: string;
  time?: string;
  memo?: string;
  categoryKey?: string;
  momentType?: string;
  createdAt?: string;
  status?: "planned" | "completed" | "cancelled";
  updatedAt?: string;
  cancellation?: ScheduleEventCancellation;
}

export interface ScheduleEventCancellation {
  cancelledAt: string;
  cancelledByProfileId: string;
  reason?: string;
}

export type ScheduleMutationResult<T extends ScheduleMutationEvent> =
  | { status: "updated"; events: T[] }
  | { status: "missing" | "ambiguous" | "invalid"; events: T[] };

export function isWritableJourneyRevision(value: unknown): value is number;

export type ScheduleEventDraftValidation =
  | {
      ok: true;
      value: {
        date: string;
        title: string;
        time?: string;
        memo?: string;
        categoryKey?: string;
        momentType?: string;
      };
    }
  | {
      ok: false;
      field: "draft" | "date" | "title" | "time" | "memo" | "categoryKey" | "momentType";
    };

export function validateScheduleEventDraft(input: unknown): ScheduleEventDraftValidation;

export function buildScheduleProgressPatch<T extends ScheduleMutationEvent>(
  expectedRevision: unknown,
  events: readonly T[],
): {
  expected_revision: number;
  progress_patch: { __events: T[] };
};

export function replaceScheduleEventById<T extends ScheduleMutationEvent>(
  events: readonly T[],
  eventId: string,
  replacement: T,
): ScheduleMutationResult<T>;

export function isValidScheduleEventCancellation(
  value: unknown,
): value is ScheduleEventCancellation;

export function isCancelledScheduleEvent(
  event: unknown,
): event is ScheduleMutationEvent & {
  status: "cancelled";
  cancellation: ScheduleEventCancellation;
};

export function isActiveScheduleEvent(
  event: unknown,
): event is ScheduleMutationEvent & {
  status?: "planned" | "completed";
  cancellation?: never;
};

export function cancelScheduleEventById<T extends ScheduleMutationEvent>(
  events: readonly T[],
  eventId: string,
  cancellation: ScheduleEventCancellation,
): ScheduleMutationResult<T>;

export function restoreScheduleEventById<T extends ScheduleMutationEvent>(
  events: readonly T[],
  eventId: string,
  restoredAt: string,
): ScheduleMutationResult<T>;
