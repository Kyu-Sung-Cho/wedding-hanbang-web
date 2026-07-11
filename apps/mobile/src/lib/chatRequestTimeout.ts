export const MOBILE_CHAT_TIMEOUT_MS = 120_000;

const MOBILE_CHAT_TIMEOUT_MESSAGE =
  "응답이 예상보다 오래 걸려 연결을 멈췄어요. 네트워크 상태를 확인하고 다시 시도해 주세요.";

export class MobileChatTimeoutError extends Error {
  readonly code = "request_timeout";
  readonly retryable = true;

  constructor() {
    super(MOBILE_CHAT_TIMEOUT_MESSAGE);
    this.name = "MobileChatTimeoutError";
  }
}

/**
 * Keep one timeout active through both the initial fetch and the streamed body.
 * Callers must pass the signal to fetch and consume the response inside `operation`.
 */
export async function withMobileChatTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = MOBILE_CHAT_TIMEOUT_MS
): Promise<T> {
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);

  try {
    return await operation(abortController.signal);
  } catch (error) {
    if (timedOut) throw new MobileChatTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
