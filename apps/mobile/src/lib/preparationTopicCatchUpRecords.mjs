/* global AbortController, clearTimeout, setTimeout */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const READ_LIMIT = 61;
const VISIBLE_LIMIT = 60;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;

export class PreparationTopicCatchUpRecordError extends Error {
  constructor(code) {
    super(code);
    this.name = "PreparationTopicCatchUpRecordError";
    this.code = code;
  }
}

function assertCurrent(isCurrent) {
  if (!isCurrent()) {
    throw new PreparationTopicCatchUpRecordError("stale_context");
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
  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS, isCurrent } = options;
  if (
    (signal !== undefined && !isAbortSignal(signal))
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > MAX_TIMEOUT_MS
  ) throw new PreparationTopicCatchUpRecordError("invalid_request");

  const controller = new AbortController();
  if (signal?.aborted) {
    controller.abort();
    assertCurrent(isCurrent);
    throw new PreparationTopicCatchUpRecordError("cancelled");
  }

  const timeoutOutcome = Object.freeze({ kind: "timeout" });
  const cancelledOutcome = Object.freeze({ kind: "cancelled" });
  let timeoutHandle;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      resolve(timeoutOutcome);
    }, timeoutMs);
  });
  let cancelForCaller;
  const cancellationPromise = signal
    ? new Promise((resolve) => {
        cancelForCaller = () => {
          controller.abort();
          resolve(cancelledOutcome);
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
      throw new PreparationTopicCatchUpRecordError("timeout");
    }
    if (outcome === cancelledOutcome) {
      assertCurrent(isCurrent);
      throw new PreparationTopicCatchUpRecordError("cancelled");
    }
    assertCurrent(isCurrent);
    if (outcome.kind === "error") {
      if (outcome.error instanceof PreparationTopicCatchUpRecordError) {
        throw outcome.error;
      }
      throw new PreparationTopicCatchUpRecordError("read_failed");
    }
    return outcome.value;
  } finally {
    clearTimeout(timeoutHandle);
    if (signal && cancelForCaller) {
      signal.removeEventListener("abort", cancelForCaller);
    }
  }
}

export async function loadPreparationTopicCatchUpRecords(options) {
  const {
    ownerId,
    coupleId,
    isCurrent,
    signal,
    timeoutMs,
    readDecisionRows,
  } = options ?? {};
  if (
    typeof ownerId !== "string"
    || !UUID_RE.test(ownerId)
    || typeof coupleId !== "string"
    || !UUID_RE.test(coupleId)
    || typeof isCurrent !== "function"
    || typeof readDecisionRows !== "function"
  ) throw new PreparationTopicCatchUpRecordError("invalid_request");

  return runBoundedRead(async (requestSignal) => {
    assertCurrent(isCurrent);
    const rows = await readDecisionRows({
      ownerId,
      coupleId,
      signal: requestSignal,
      limit: READ_LIMIT,
    });
    assertCurrent(isCurrent);
    if (!Array.isArray(rows)) {
      throw new PreparationTopicCatchUpRecordError("invalid_response");
    }
    return Object.freeze({
      catchUpDecisionReceipts: Object.freeze(rows.slice(0, VISIBLE_LIMIT)),
      partial: rows.length > VISIBLE_LIMIT,
    });
  }, { signal, timeoutMs, isCurrent });
}
