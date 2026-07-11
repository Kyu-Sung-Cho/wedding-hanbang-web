import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MobileChatTimeoutError,
  withMobileChatTimeout,
} from "../../../../mobile/src/lib/chatRequestTimeout";

describe("mobile chat request timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts a stalled response and returns a retryable, consumer-friendly error", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;

    const request = withMobileChatTimeout(
      (signal) => {
        requestSignal = signal;
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      },
      1_000
    );
    const rejection = expect(request).rejects.toEqual(
      expect.objectContaining({
        name: "MobileChatTimeoutError",
        code: "request_timeout",
        message: "응답이 예상보다 오래 걸려 연결을 멈췄어요. 네트워크 상태를 확인하고 다시 시도해 주세요.",
      })
    );

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
    expect(MobileChatTimeoutError).toBeTypeOf("function");
  });

  it("does not leave an abort timer behind after a successful response", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;

    await expect(
      withMobileChatTimeout((signal) => {
        requestSignal = signal;
        return Promise.resolve("done");
      }, 1_000)
    ).resolves.toBe("done");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(requestSignal?.aborted).toBe(false);
  });

  it("preserves non-timeout failures", async () => {
    const networkError = new Error("network unavailable");

    await expect(
      withMobileChatTimeout(() => Promise.reject(networkError), 1_000)
    ).rejects.toBe(networkError);
  });
});
