export const MOBILE_CHAT_TIMEOUT_MS = 120_000;
export const MOBILE_CHAT_DELAY_NOTICE_MS = 9_000;

const MOBILE_CHAT_TIMEOUT_MESSAGE =
  "2분 동안 답변을 받지 못해 연결을 멈췄어요. 입력한 질문으로 다시 시도할 수 있어요.";

const MOBILE_CHAT_CANCELLED_MESSAGE =
  "답변 생성을 중단했어요. 입력한 질문으로 다시 시도할 수 있어요.";

export class MobileChatTimeoutError extends Error {
  readonly code = "request_timeout";
  readonly retryable = true;

  constructor() {
    super(MOBILE_CHAT_TIMEOUT_MESSAGE);
    this.name = "MobileChatTimeoutError";
  }
}

export class MobileChatCancelledError extends Error {
  readonly code = "request_cancelled";
  readonly retryable = true;

  constructor() {
    super(MOBILE_CHAT_CANCELLED_MESSAGE);
    this.name = "MobileChatCancelledError";
  }
}

export interface MobileChatTimeoutOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

function timeoutOptions(
  value: number | MobileChatTimeoutOptions
): Required<Pick<MobileChatTimeoutOptions, "timeoutMs">> & Pick<MobileChatTimeoutOptions, "signal"> {
  return typeof value === "number"
    ? { timeoutMs: value }
    : { timeoutMs: value.timeoutMs ?? MOBILE_CHAT_TIMEOUT_MS, signal: value.signal };
}

/**
 * Keep one timeout active through both the initial fetch and the streamed body.
 * The optional caller signal is combined without propagating our deadline back
 * to it. Callers must pass the resulting signal to fetch and consume the
 * response inside `operation`.
 */
export async function withMobileChatTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: number | MobileChatTimeoutOptions = MOBILE_CHAT_TIMEOUT_MS
): Promise<T> {
  const { timeoutMs, signal: externalSignal } = timeoutOptions(options);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a positive finite number");
  }

  const abortController = new AbortController();
  let abortError: MobileChatTimeoutError | MobileChatCancelledError | null = null;
  let rejectAbort: (error: MobileChatTimeoutError | MobileChatCancelledError) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });

  const abortWith = (error: MobileChatTimeoutError | MobileChatCancelledError) => {
    if (abortError) return;
    abortError = error;
    // Settle our promise first so an implementation-specific AbortError cannot
    // hide whether the user cancelled or the deadline expired.
    rejectAbort(error);
    abortController.abort();
  };
  const handleExternalAbort = () => abortWith(new MobileChatCancelledError());

  if (externalSignal) {
    externalSignal.addEventListener("abort", handleExternalAbort, { once: true });
    // AbortSignal does not replay an event that happened between an `aborted`
    // check and listener registration, so always check after registration.
    if (externalSignal.aborted) handleExternalAbort();
  }

  const timeout = abortError
    ? null
    : setTimeout(() => abortWith(new MobileChatTimeoutError()), timeoutMs);

  try {
    const running = Promise.resolve().then(() => {
      if (abortError) throw abortError;
      return operation(abortController.signal);
    });
    return await Promise.race([running, aborted]);
  } finally {
    if (timeout) clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", handleExternalAbort);
  }
}
