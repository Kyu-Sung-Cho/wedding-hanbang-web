export const AMORA_ACTION_DEADLINE_MS = 15_000;
export const AMORA_ACTION_OUTCOME_UNCONFIRMED = "AMORA_ACTION_OUTCOME_UNCONFIRMED";

export class AmoraActionDeadlineError extends Error {
  constructor() {
    super("Amora action operation did not finish within its active lifetime");
    // SDK가 만료를 일반 network 오류로 보고 GET retry timer를 남기지 않게 한다.
    this.name = "AbortError";
  }
}

/** HTTP headers, body와 인증 대기를 같은 수명 안에서만 수락한다. 재발송은 하지 않는다. */
export function createAmoraActionDeadline(timeoutMs = AMORA_ACTION_DEADLINE_MS, parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const expiresAt = Date.now() + timeoutMs;
  let disposed = false;
  let rejectLifetime!: (reason: AmoraActionDeadlineError) => void;
  const lifetime = new Promise<never>((_resolve, reject) => { rejectLifetime = reject; });
  // 첫 run 전 owner가 바뀌어도 미처리 rejection을 남기지 않는다.
  void lifetime.catch(() => undefined);
  const onAbort = () => rejectLifetime(new AmoraActionDeadlineError());
  const abort = () => controller.abort();
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  parentSignal?.addEventListener("abort", abort, { once: true });
  if (parentSignal?.aborted) abort();
  const assertActive = () => {
    if (Date.now() >= expiresAt) abort();
    if (disposed || controller.signal.aborted) throw new AmoraActionDeadlineError();
  };
  return {
    signal: controller.signal,
    assertActive,
    async run<T>(operation: (signal: AbortSignal) => T | PromiseLike<T>): Promise<T> {
      assertActive();
      const task = Promise.resolve().then(() => { assertActive(); return operation(controller.signal); });
      const result = await Promise.race([task, lifetime]);
      assertActive();
      return result;
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abort);
      abort();
      controller.signal.removeEventListener("abort", onAbort);
    },
  };
}

/** opt-in Supabase client 전용. caller의 abort도 보존하고 실제 전송을 함께 중단한다. */
export function amoraActionDeadlineFetch(deadline: ReturnType<typeof createAmoraActionDeadline>): typeof fetch {
  return (input, init) => {
    const originalSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = originalSignal ? AbortSignal.any([deadline.signal, originalSignal]) : deadline.signal;
    return deadline.run(() => globalThis.fetch(input, { ...init, signal }));
  };
}
