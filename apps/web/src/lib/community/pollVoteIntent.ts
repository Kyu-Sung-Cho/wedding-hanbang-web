export type PollVoteIntent = {
  pollId: string;
  optionId: string;
  selected: boolean;
  pollVersion: number;
  idempotencyKey: string;
};

type PollVoteFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type SubmitPollVoteIntentOptions = {
  fetcher?: PollVoteFetch;
  maxAttempts?: number;
};

/**
 * A transport retry must repeat the exact same desired state and key. Retrying
 * only network failures and transient gateway/server failures avoids turning a
 * validation or access denial into a request loop.
 */
export async function submitPollVoteIntent(
  intent: PollVoteIntent,
  options: SubmitPollVoteIntentOptions = {},
): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 2, 2));
  const body = JSON.stringify({
    option_id: intent.optionId,
    selected: intent.selected,
    poll_version: intent.pollVersion,
  });
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": intent.idempotencyKey,
    },
    body,
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetcher(
        `/api/community/polls/${intent.pollId}/vote`,
        requestInit,
      );
      const isTransientResponse = [500, 502, 504].includes(response.status);
      if (!isTransientResponse || attempt === maxAttempts) return response;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("투표 요청을 전송하지 못했습니다.");
}
