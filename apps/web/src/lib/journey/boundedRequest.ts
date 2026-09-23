export class RequestDeadlineError extends Error {
  constructor() { super("REQUEST_DEADLINE_EXCEEDED"); this.name = "RequestDeadlineError"; }
}

/** fetch뿐 아니라 body 읽기까지 하나의 기한으로 끝낸다. 늦은 응답은 호출자에게 전달하지 않는다. */
export async function boundedRequest<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, controller = new AbortController()): Promise<T> {
  if (controller.signal.aborted) throw new Error("REQUEST_ABORTED");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const expired = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("REQUEST_ABORTED"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      reject(new RequestDeadlineError());
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
