import type { CohortThreadTopic } from "@/types/community.types";

type SendInput = {
  actorId: string;
  roomId: string;
  content: string;
  threadTopic: CohortThreadTopic | "";
};
type Attempt = Readonly<SendInput & { key: string; signature: string }>;

/** 응답을 잃은 재시도와 성공 후 같은 내용을 새로 보내는 행동을 구분한다. */
export function createCohortMessageSendController(options: {
  fetcher?: typeof fetch;
  createKey?: () => string;
} = {}) {
  let pending: Attempt | null = null;
  let busy = false;
  return {
    begin(input: SendInput): Attempt | null {
      if (busy) return null;
      const signature = JSON.stringify(input);
      if (pending?.signature !== signature) {
        const key = (options.createKey ?? (() => globalThis.crypto.randomUUID()))();
        pending = { ...input, key, signature };
      }
      busy = true;
      return pending;
    },
    isCurrent(attempt: Attempt) { return pending === attempt; },
    finish(attempt: Attempt, confirmed: boolean) {
      if (pending !== attempt) return;
      busy = false;
      if (confirmed) pending = null;
    },
    reset() { pending = null; busy = false; },
    send(attempt: Attempt) {
      if (pending !== attempt) return Promise.reject(new Error("COHORT_MESSAGE_SCOPE_CHANGED"));
      return (options.fetcher ?? fetch)(`/api/community/cohort/${encodeURIComponent(attempt.roomId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.key },
        body: JSON.stringify({ content: attempt.content, thread_topic: attempt.threadTopic || undefined }),
      });
    },
  };
}
