// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionClient = vi.hoisted(() => vi.fn(() => {
  throw new Error("A monitoring request must not depend on a visitor session");
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: sessionClient }));

describe("health probe transport", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "health-probe-public-key");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("checks the public database without a visitor session or an exact table count", async () => {
    const { GET } = await import("../route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(sessionClient).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe("/rest/v1/v_public_prices");
    expect(new URL(String(url)).searchParams.get("limit")).toBe("1");
    expect(init?.method).toBe("HEAD");
    expect(new Headers(init?.headers).get("prefer") ?? "").not.toContain("count=");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer health-probe-public-key");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("cancels a stalled database request and returns a generic 503 within five seconds", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      setTimeout(() => controller.abort(new DOMException("internal transport details", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    fetchMock.mockImplementation(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) {
        reject(init.signal.reason);
        return;
      }
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const { GET } = await import("../route");
    const pendingResponse = GET();

    expect(timeout).toHaveBeenCalledWith(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await pendingResponse;
    expect(controller.signal.aborted).toBe(true);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, database: "down" });
    expect(JSON.stringify(body)).not.toContain("internal transport details");
    expect(Object.keys(body).sort()).toEqual(["checkedAt", "commit", "database", "ok"]);
  });

  it("preserves the failure status and empty body for HEAD monitoring", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const { HEAD } = await import("../route");
    const response = await HEAD();

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
