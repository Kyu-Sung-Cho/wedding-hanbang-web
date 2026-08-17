/* global AbortController, clearTimeout, setTimeout */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DECISION_LIMIT = 81;
const VISIBLE_DECISION_LIMIT = 80;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class PreparationTopicVendorBookingError extends Error {
  constructor(code) {
    super(code);
    this.name = "PreparationTopicVendorBookingError";
    this.code = code;
  }
}

function assertCurrent(isCurrent) {
  if (!isCurrent()) {
    throw new PreparationTopicVendorBookingError("stale_context");
  }
}

function isAbortSignal(value) {
  return value !== null
    && typeof value === "object"
    && typeof value.aborted === "boolean"
    && typeof value.addEventListener === "function"
    && typeof value.removeEventListener === "function";
}

async function runBoundedRead(operation, options) {
  const {
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    isCurrent,
  } = options;
  if (
    (signal !== undefined && !isAbortSignal(signal))
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new PreparationTopicVendorBookingError("invalid_request");
  }
  const controller = new AbortController();
  if (signal?.aborted) {
    controller.abort();
    assertCurrent(isCurrent);
    throw new PreparationTopicVendorBookingError("cancelled");
  }

  const timeoutOutcome = Object.freeze({ kind: "timeout" });
  const cancelledOutcome = Object.freeze({ kind: "cancelled" });
  let timeoutHandle;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve(timeoutOutcome);
      controller.abort();
    }, timeoutMs);
  });
  let cancelForCaller;
  const cancellationPromise = signal
    ? new Promise((resolve) => {
        cancelForCaller = () => {
          resolve(cancelledOutcome);
          controller.abort();
        };
        signal.addEventListener("abort", cancelForCaller, { once: true });
        if (signal.aborted) cancelForCaller();
      })
    : null;
  const operationPromise = Promise.resolve().then(
    () => operation(controller.signal),
  ).then(
    (value) => ({ kind: "value", value }),
    (error) => ({ kind: "error", error }),
  );

  try {
    const outcome = await Promise.race([
      operationPromise,
      timeoutPromise,
      ...(cancellationPromise ? [cancellationPromise] : []),
    ]);
    if (outcome === timeoutOutcome) {
      throw new PreparationTopicVendorBookingError("timeout");
    }
    if (outcome === cancelledOutcome) {
      assertCurrent(isCurrent);
      throw new PreparationTopicVendorBookingError("cancelled");
    }
    assertCurrent(isCurrent);
    if (outcome.kind === "error") {
      if (outcome.error instanceof PreparationTopicVendorBookingError) {
        throw outcome.error;
      }
      throw new PreparationTopicVendorBookingError("read_failed");
    }
    return outcome.value;
  } finally {
    clearTimeout(timeoutHandle);
    if (signal && cancelForCaller) {
      signal.removeEventListener("abort", cancelForCaller);
    }
  }
}

export async function loadPreparationTopicVendorBookings(options) {
  const {
    ownerId,
    coupleId,
    isCurrent,
    signal,
    timeoutMs,
    readCoupleRoster,
    readDecisionRows,
    readBookingRows,
  } = options ?? {};
  if (
    typeof ownerId !== "string"
    || !UUID_RE.test(ownerId)
    || typeof coupleId !== "string"
    || !UUID_RE.test(coupleId)
    || typeof isCurrent !== "function"
    || typeof readCoupleRoster !== "function"
    || typeof readDecisionRows !== "function"
    || typeof readBookingRows !== "function"
  ) {
    throw new PreparationTopicVendorBookingError("invalid_request");
  }
  return runBoundedRead(async (requestSignal) => {
    const baseRequest = { ownerId, coupleId, signal: requestSignal };
    assertCurrent(isCurrent);
    const roster = await readCoupleRoster(baseRequest);
    assertCurrent(isCurrent);
    const brideId = isRecord(roster) ? roster.bride_id : undefined;
    const groomId = isRecord(roster) ? roster.groom_id : undefined;
    const currentCoupleMemberIds = [brideId, groomId].filter((value) => value !== null);
    if (
      !isRecord(roster)
      || roster.id !== coupleId
      || (brideId !== null && (typeof brideId !== "string" || !UUID_RE.test(brideId)))
      || (groomId !== null && (typeof groomId !== "string" || !UUID_RE.test(groomId)))
      || currentCoupleMemberIds.length < 1
      || new Set(currentCoupleMemberIds).size !== currentCoupleMemberIds.length
      || !currentCoupleMemberIds.includes(ownerId)
    ) {
      throw new PreparationTopicVendorBookingError("invalid_roster");
    }
    assertCurrent(isCurrent);
    const decisionRows = await readDecisionRows({ ...baseRequest, limit: DECISION_LIMIT });
    assertCurrent(isCurrent);
    if (!Array.isArray(decisionRows)) {
      throw new PreparationTopicVendorBookingError("invalid_response");
    }
    const vendorBookingDecisionReceipts = decisionRows.slice(0, VISIBLE_DECISION_LIMIT);
    const bookingIds = [...new Set(vendorBookingDecisionReceipts
      .map((row) => row?.source_ref_id)
      .filter((value) => typeof value === "string" && UUID_RE.test(value)))];
    let vendorBookings = [];
    if (bookingIds.length > 0) {
      assertCurrent(isCurrent);
      vendorBookings = await readBookingRows({ ...baseRequest, bookingIds });
      assertCurrent(isCurrent);
    }
    if (!Array.isArray(vendorBookings)) {
      throw new PreparationTopicVendorBookingError("invalid_response");
    }

    return {
      currentCoupleMemberIds,
      vendorBookingDecisionReceipts,
      vendorBookings,
      partial: decisionRows.length > VISIBLE_DECISION_LIMIT,
    };
  }, { signal, timeoutMs, isCurrent });
}
