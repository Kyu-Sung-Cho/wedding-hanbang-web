import type { SupabaseClient } from "@supabase/supabase-js";
import { isRecord } from "@/utils/requestValidation";
import {
  syncBookingProgressAfterCancel,
  syncBookingProgressAfterCreate,
  type BookingCancelProgressPersistenceResult,
  type BookingProgressPersistenceResult,
} from "./progressSync";

// Values here come from canonical PostgreSQL uuid columns. Do not reject
// legacy/seed UUIDs solely because their version/variant bits are non-RFC.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export type BookingProjectionDesiredState = "active" | "cancelled";
export type BookingProjectionDeliveryStatus =
  | "completed"
  | "pending_retry"
  | "failed";

type BookingProjectionSyncResult =
  | BookingProgressPersistenceResult
  | BookingCancelProgressPersistenceResult;

interface BookingProjectionClaim {
  bookingId: string;
  coupleId: string;
  desiredState: BookingProjectionDesiredState;
  generation: number;
  attemptCount: number;
  claimToken: string;
  booking: {
    date: string;
    time: string;
    amount: number;
    status: string;
    vendorId: string;
    productId: string | null;
    staffId: string | null;
    vendorName: string;
    vendorCategory: string | null;
  };
}

export interface BookingProjectionDeliveryResult {
  bookingId: string;
  desiredState: BookingProjectionDesiredState | null;
  status: BookingProjectionDeliveryStatus;
  retryable: boolean;
  attemptCount: number;
  retryAfterSeconds?: number;
  errorCode?: string;
  sync?: BookingProjectionSyncResult;
}

export interface BookingProjectionDrainResult {
  processed: number;
  completed: number;
  pendingRetry: number;
  failed: number;
  results: BookingProjectionDeliveryResult[];
}

function finiteNonNegative(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = finiteNonNegative(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalUuid(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && UUID_RE.test(value) ? value : undefined;
}

function parseClaim(value: unknown): BookingProjectionClaim | null {
  if (!isRecord(value) || !isRecord(value.booking)) return null;
  const booking = value.booking;
  const amount = finiteNonNegative(booking.amount);
  const generation = positiveInteger(value.generation);
  const attemptCount = positiveInteger(value.attemptCount);
  const productId = optionalUuid(booking.productId);
  const staffId = optionalUuid(booking.staffId);

  if (
    typeof value.bookingId !== "string" || !UUID_RE.test(value.bookingId) ||
    typeof value.coupleId !== "string" || !UUID_RE.test(value.coupleId) ||
    (value.desiredState !== "active" && value.desiredState !== "cancelled") ||
    generation === null ||
    attemptCount === null ||
    typeof value.claimToken !== "string" || !UUID_RE.test(value.claimToken) ||
    typeof booking.date !== "string" || !ISO_DATE_RE.test(booking.date) ||
    typeof booking.time !== "string" || !TIME_RE.test(booking.time) ||
    amount === null ||
    typeof booking.status !== "string" ||
    typeof booking.vendorId !== "string" || !UUID_RE.test(booking.vendorId) ||
    productId === undefined ||
    staffId === undefined ||
    typeof booking.vendorName !== "string" ||
    (booking.vendorCategory !== null && typeof booking.vendorCategory !== "string")
  ) {
    return null;
  }

  return {
    bookingId: value.bookingId,
    coupleId: value.coupleId,
    desiredState: value.desiredState,
    generation,
    attemptCount,
    claimToken: value.claimToken,
    booking: {
      date: booking.date,
      time: booking.time,
      amount,
      status: booking.status,
      vendorId: booking.vendorId,
      productId,
      staffId,
      vendorName: booking.vendorName,
      vendorCategory: booking.vendorCategory as string | null,
    },
  };
}

function projectionErrorCode(error: string | undefined): string {
  const message = (error ?? "").toLowerCase();
  if (message.includes("journey_not_found") || message.includes("missing journey")) {
    return "PROJECTION_CONTEXT_MISSING";
  }
  if (message.includes("invalid booking projection response")) {
    return "PROJECTION_RESPONSE_INVALID";
  }
  return "PROJECTION_APPLY_FAILED";
}

function parseFinishResult(value: unknown): {
  accepted: boolean;
  status: string;
  reason: string | null;
  attemptCount: number | null;
  retryAfterSeconds: number | null;
} | null {
  if (
    !isRecord(value) ||
    typeof value.accepted !== "boolean" ||
    typeof value.status !== "string"
  ) {
    return null;
  }
  const attemptCount = value.attemptCount === undefined
    ? null
    : finiteNonNegative(value.attemptCount);
  const retryAfterSeconds = value.retryAfterSeconds === undefined
    ? null
    : finiteNonNegative(value.retryAfterSeconds);
  if (
    (value.reason !== undefined && typeof value.reason !== "string") ||
    (value.attemptCount !== undefined && attemptCount === null) ||
    (value.retryAfterSeconds !== undefined && retryAfterSeconds === null)
  ) {
    return null;
  }
  return {
    accepted: value.accepted,
    status: value.status,
    reason: typeof value.reason === "string" ? value.reason : null,
    attemptCount,
    retryAfterSeconds,
  };
}

async function readQueuedStatus(
  client: SupabaseClient,
  bookingId: string,
  fallbackErrorCode?: string,
): Promise<BookingProjectionDeliveryResult> {
  const { data, error } = await client
    .from("booking_projection_jobs")
    .select("desired_state, status, attempt_count, last_error_code")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (error || !isRecord(data)) {
    return {
      bookingId,
      desiredState: null,
      status: "pending_retry",
      retryable: true,
      attemptCount: 0,
      errorCode: fallbackErrorCode ?? "OUTBOX_STATUS_UNAVAILABLE",
    };
  }

  const desiredState = data.desired_state === "active" || data.desired_state === "cancelled"
    ? data.desired_state
    : null;
  const attemptCount = finiteNonNegative(data.attempt_count) ?? 0;
  if (data.status === "completed") {
    return {
      bookingId,
      desiredState,
      status: "completed",
      retryable: false,
      attemptCount,
    };
  }
  if (data.status === "failed") {
    return {
      bookingId,
      desiredState,
      status: "failed",
      retryable: false,
      attemptCount,
      errorCode: typeof data.last_error_code === "string"
        ? data.last_error_code
        : "PROJECTION_RETRY_EXHAUSTED",
    };
  }
  return {
    bookingId,
    desiredState,
    status: "pending_retry",
    retryable: true,
    attemptCount,
    errorCode: fallbackErrorCode,
  };
}

async function finishClaim(
  client: SupabaseClient,
  claim: BookingProjectionClaim,
  errorCode: string | null,
  maxAttempts: number,
) {
  const { data, error } = await client.rpc("finish_booking_projection_job", {
    p_booking_id: claim.bookingId,
    p_generation: claim.generation,
    p_claim_token: claim.claimToken,
    p_succeeded: false,
    p_error_code: errorCode,
    p_max_attempts: maxAttempts,
  });
  if (error) return { result: null, error: "PROJECTION_FINISH_FAILED" };
  const result = parseFinishResult(data);
  return result
    ? { result, error: null }
    : { result: null, error: "PROJECTION_FINISH_RESPONSE_INVALID" };
}

export async function processBookingProjectionJob(
  client: SupabaseClient,
  options: {
    bookingId?: string;
    leaseSeconds?: number;
    maxAttempts?: number;
  } = {},
): Promise<BookingProjectionDeliveryResult | null> {
  const bookingId = options.bookingId;
  const leaseSeconds = options.leaseSeconds ?? 300;
  const maxAttempts = options.maxAttempts ?? 8;
  const { data: claimData, error: claimError } = await client.rpc(
    "claim_booking_projection_job",
    {
      p_booking_id: bookingId ?? null,
      p_lease_seconds: leaseSeconds,
    },
  );

  if (claimError) {
    if (!bookingId) throw new Error("booking projection claim failed");
    return readQueuedStatus(client, bookingId, "PROJECTION_CLAIM_FAILED");
  }
  if (claimData === null) {
    return bookingId ? readQueuedStatus(client, bookingId) : null;
  }

  const claim = parseClaim(claimData);
  if (!claim) {
    if (!bookingId) throw new Error("invalid booking projection claim");
    return readQueuedStatus(client, bookingId, "PROJECTION_CLAIM_INVALID");
  }

  let sync: BookingProjectionSyncResult;
  try {
    sync = claim.desiredState === "active"
      ? await syncBookingProgressAfterCreate(client, {
          coupleId: claim.coupleId,
          booking: {
            id: claim.bookingId,
            date: claim.booking.date,
            time: claim.booking.time,
            amount: claim.booking.amount,
          },
          vendorId: claim.booking.vendorId,
          productId: claim.booking.productId,
          staffId: claim.booking.staffId,
          projectionClaim: {
            generation: claim.generation,
            claimToken: claim.claimToken,
          },
        })
      : await syncBookingProgressAfterCancel(client, {
          coupleId: claim.coupleId,
          booking: {
            id: claim.bookingId,
            amount: claim.booking.amount,
          },
          vendor: {
            id: claim.booking.vendorId,
            name: claim.booking.vendorName,
            category: claim.booking.vendorCategory,
          },
          projectionClaim: {
            generation: claim.generation,
            claimToken: claim.claimToken,
          },
        });
  } catch {
    sync = {
      persisted: false,
      error: "projection threw before persistence was confirmed",
      ...(claim.desiredState === "active"
        ? {
            nextProgress: {},
            scheduleAdded: false,
            scheduleUpdated: false,
            budgetUpdated: false,
            budgetExceededBy: 0,
            categoryBudgetLimit: 0,
            categoryLabel: claim.booking.vendorCategory,
            syncedEvent: {
              id: `evt_booking_${claim.bookingId}`,
              sourceKey: `booking:${claim.bookingId}`,
              date: claim.booking.date,
              title: `${claim.booking.time} ${claim.booking.vendorName}`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            syncedCategoryKey: null,
            syncedNewSpent: null,
          }
        : {
            nextProgress: {},
            scheduleRemoved: false,
            budgetReverted: false,
            revertedAmount: 0,
            categoryBudgetLimit: 0,
            categoryLabel: claim.booking.vendorCategory,
            syncedEventIdRemoved: null,
            syncedCategoryKey: null,
            syncedNewSpent: null,
          }),
    } as BookingProjectionSyncResult;
  }

  if (sync.persisted && sync.projectionDisposition === "completed") {
    return {
      bookingId: claim.bookingId,
      desiredState: claim.desiredState,
      status: "completed",
      retryable: false,
      attemptCount: claim.attemptCount,
      sync,
    };
  }

  if (sync.projectionDisposition === "superseded") {
    return {
      bookingId: claim.bookingId,
      desiredState: claim.desiredState,
      status: "pending_retry",
      retryable: true,
      attemptCount: claim.attemptCount,
      errorCode: "PROJECTION_SUPERSEDED",
      sync,
    };
  }

  if (
    sync.projectionDisposition === "stale_claim" ||
    sync.projectionDisposition === "not_found"
  ) {
    const queued = await readQueuedStatus(
      client,
      claim.bookingId,
      sync.projectionDisposition === "stale_claim"
        ? "PROJECTION_STALE_CLAIM"
        : "PROJECTION_JOB_NOT_FOUND",
    );
    return {
      ...queued,
      desiredState: queued.desiredState ?? claim.desiredState,
      sync,
    };
  }

  // The projection RPC is the transaction boundary. Only an error/ambiguous
  // response reaches the legacy finish RPC, which releases the lease for a
  // retry. It is never used to acknowledge a successful projection.
  const errorCode = projectionErrorCode(sync.error);
  const finished = await finishClaim(
    client,
    claim,
    errorCode,
    maxAttempts,
  );
  if (!finished.result) {
    const queued = await readQueuedStatus(
      client,
      claim.bookingId,
      finished.error ?? "PROJECTION_FINISH_FAILED",
    );
    return {
      ...queued,
      desiredState: queued.desiredState ?? claim.desiredState,
      sync,
    };
  }

  const attemptCount = finished.result.attemptCount ?? claim.attemptCount;
  // If apply committed but its response was lost, the failure-resolution RPC
  // observes the already-completed row with a stale token. Completion wins.
  if (finished.result.status === "completed") {
    return {
      bookingId: claim.bookingId,
      desiredState: claim.desiredState,
      status: "completed",
      retryable: false,
      attemptCount,
      sync,
    };
  }
  if (finished.result.status === "failed") {
    return {
      bookingId: claim.bookingId,
      desiredState: claim.desiredState,
      status: "failed",
      retryable: false,
      attemptCount,
      errorCode: errorCode ?? "PROJECTION_RETRY_EXHAUSTED",
      sync,
    };
  }

  return {
    bookingId: claim.bookingId,
    desiredState: claim.desiredState,
    status: "pending_retry",
    retryable: true,
    attemptCount,
    retryAfterSeconds: finished.result.retryAfterSeconds ?? undefined,
    errorCode: finished.result.reason === "superseded"
      ? "PROJECTION_SUPERSEDED"
      : errorCode ?? "PROJECTION_PENDING",
    sync,
  };
}

export async function drainBookingProjectionJobs(
  client: SupabaseClient,
  maxJobs = 20,
): Promise<BookingProjectionDrainResult> {
  const boundedMaxJobs = Math.max(1, Math.min(100, Math.floor(maxJobs)));
  const results: BookingProjectionDeliveryResult[] = [];
  for (let index = 0; index < boundedMaxJobs; index += 1) {
    const result = await processBookingProjectionJob(client);
    if (!result) break;
    results.push(result);
  }
  return {
    processed: results.length,
    completed: results.filter((result) => result.status === "completed").length,
    pendingRetry: results.filter((result) => result.status === "pending_retry").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}
