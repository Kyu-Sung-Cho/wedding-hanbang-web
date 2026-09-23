// 인증·전송·본문 읽기를 한 기한으로 묶는다. 기한 종료는 저장 취소 증거가 아니다.
export async function preferenceRequest<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
  onOperationSettled?: () => void,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    onAbort = () => {
      controller.abort();
      reject(new Error("PREFERENCE_REQUEST_ABORTED"));
    };
    if (parentSignal?.aborted) onAbort();
    else parentSignal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("PREFERENCE_REQUEST_TIMEOUT"));
    }, 15_000);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error("PREFERENCE_REQUEST_ABORTED");
        return operation(controller.signal);
      }).finally(() => onOperationSettled?.()),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) parentSignal?.removeEventListener("abort", onAbort);
  }
}
