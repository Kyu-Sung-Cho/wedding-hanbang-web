export class ChatApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(
    message: string,
    status: number,
    code?: string
  ) {
    super(message);
    this.name = "ChatApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * 현재 테스트 정책은 횟수 제한이 없지만, 구버전 서버 또는 향후 opt-in 제한에서
 * 받은 HTTP 429와 스트림 한도 오류는 즉시 재시도하지 않는다.
 */
export function isTerminalAmoraChatError(error: unknown): boolean {
  return error instanceof ChatApiError
    && (error.status === 429
      || error.code === "couple_provider_daily"
      || error.code === "global_daily");
}
