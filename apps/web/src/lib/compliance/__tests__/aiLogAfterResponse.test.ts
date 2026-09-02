import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **원장 쓰기가 응답보다 오래 사는지 시험한다.**
 *
 * 2026-09-02: `void logAIInteraction(...)` 로 띄운 삽입은 아직 날아가는 중에
 * 라우트가 응답을 돌려준다. Vercel 은 응답이 끝나면 함수를 얼리므로 그 fetch 가
 * 끊긴다. `after()` 는 플랫폼에 "아직 안 끝났다"고 알린다.
 *
 * **넘기는 것이 콜백이냐 프로미스냐가 핵심이다.** 콜백을 넘기면 Next 가 큐에
 * 넣고 `res.on("close")` 로 깨우는데, 사용자가 스트림 도중 끊으면 res 가 먼저
 * 닫혀 그 리스너가 영원히 안 불린다 — 실행 0회·예외 0회·경보 0회로 원장이
 * 조용히 사라진다. 프로미스를 넘기면 isThenable 갈래로 빠져 그 큐를 안 탄다.
 *
 * 여기서 시험하는 것은 **감싸개 자체**다. 라우트 계약 테스트
 * (`routeOpenAIContract.test.ts`)는 이 함수를 mock 으로 갈아끼우므로 감싸개가
 * 한 번도 실행되지 않는다 — 그쪽 초록불은 이 동작의 증거가 아니다.
 */

interface PgError { code: string; message: string; details: string }

const afterMock = vi.fn();
const insertMock = vi.fn<() => Promise<{ error: PgError | null }>>(
  async () => ({ error: null }),
);
const logErrorMock = vi.fn();

vi.mock("next/server", () => ({
  after: (value: unknown) => afterMock(value),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: insertMock }) }),
}));

vi.mock("@/utils/log", () => ({
  log: { error: (...args: unknown[]) => logErrorMock(...args) },
}));

const BASE = { interactionType: "chat_turn" } as const;

describe("logAIInteractionAfterResponse", () => {
  beforeEach(() => {
    vi.resetModules();
    afterMock.mockReset();
    afterMock.mockImplementation(() => undefined);
    insertMock.mockReset();
    insertMock.mockResolvedValue({ error: null });
    logErrorMock.mockReset();
  });

  it("쓰기를 바로 시작한다 — 응답이 닫혀도 이미 날아간 뒤다", async () => {
    const mod = await import("../ai-log");

    const returned = mod.logAIInteractionAfterResponse({ ...BASE });

    expect(returned).toBeUndefined();
    // 콜백을 기다리지 않는다. 이 줄이 이 파일의 존재 이유다.
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("after 에 콜백이 아니라 프로미스를 넘긴다", async () => {
    const mod = await import("../ai-log");

    mod.logAIInteractionAfterResponse({ ...BASE });

    expect(afterMock).toHaveBeenCalledTimes(1);
    const handed = afterMock.mock.calls[0][0];
    expect(typeof handed).not.toBe("function");
    expect(typeof (handed as { then?: unknown })?.then).toBe("function");
  });

  it("after() 가 던져도 원장은 한 번만 쓴다 — 두 번 부르면 행이 겹친다", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("`after()` was called outside a request scope");
    });
    const mod = await import("../ai-log");

    mod.logAIInteractionAfterResponse({ ...BASE });

    await vi.waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    // 잠시 더 기다려도 두 번째 삽입이 오지 않아야 한다.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("after() 가 던지면 우리에게 알린다 — 조용히 넘어가지 않는다", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("outside request scope");
    });
    const mod = await import("../ai-log");

    mod.logAIInteractionAfterResponse({ ...BASE });

    const alerted = logErrorMock.mock.calls.some(
      ([, err]) => (err as Error | undefined)?.message === "ai_log_after_unavailable",
    );
    expect(alerted).toBe(true);
  });

  it("경보는 프로세스당 한 번만 — 매 턴 보내면 소음이 된다", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("outside request scope");
    });
    const mod = await import("../ai-log");

    mod.logAIInteractionAfterResponse({ ...BASE });
    mod.logAIInteractionAfterResponse({ ...BASE });
    mod.logAIInteractionAfterResponse({ ...BASE });

    const alerts = logErrorMock.mock.calls.filter(
      ([, err]) => (err as Error | undefined)?.message === "ai_log_after_unavailable",
    );
    expect(alerts).toHaveLength(1);
    // 알림은 한 번이어도 쓰기는 세 번 다 일어나야 한다.
    await vi.waitFor(() => expect(insertMock).toHaveBeenCalledTimes(3));
  });

  it("DB 가 거부하면 오류 코드를 제목에 담는다 — 값은 담지 않는다", async () => {
    insertMock.mockResolvedValue({
      error: { code: "23503", message: "Key (couple_id)=(abc) is not present", details: "abc" },
    });
    const mod = await import("../ai-log");

    mod.logAIInteractionAfterResponse({ ...BASE });

    await vi.waitFor(() => {
      const call = logErrorMock.mock.calls.find(
        ([, err]) => (err as Error | undefined)?.message === "ai_interactions_log_insert_failed",
      );
      expect(call).toBeDefined();
      expect(String(call?.[0])).toContain("code=23503");
      // 위반한 값은 절대 담지 않는다.
      expect(String(call?.[0])).not.toContain("abc");
    });
  });
});
