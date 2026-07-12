import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { rateLimitKey } from "../rateLimit";

const { createClientMock, rpcMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

// The module-level `buckets` Map and `lastCleanup` are encapsulated in the module.
// Re-importing resets nothing — we need to use fake timers to control Date.now().

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    // Force the module to be re-evaluated so the buckets Map is fresh.
    vi.resetModules();
  });

  it("allows first request within window", async () => {
    const { checkRateLimit: check } = await import("../rateLimit");
    const result = check("test:1.2.3.4", { maxRequests: 3, windowMs: 60_000 });
    expect(result).toBeNull();
  });

  it("allows requests up to maxRequests", async () => {
    const { checkRateLimit: check } = await import("../rateLimit");
    const config = { maxRequests: 3, windowMs: 60_000 };
    check("test:1.2.3.4", config);
    check("test:1.2.3.4", config);
    const result = check("test:1.2.3.4", config);
    expect(result).toBeNull(); // 3rd request still allowed
  });

  it("blocks request exceeding maxRequests", async () => {
    const { checkRateLimit: check } = await import("../rateLimit");
    const config = { maxRequests: 2, windowMs: 60_000 };
    check("test:1.2.3.4", config);
    check("test:1.2.3.4", config);
    const result = check("test:1.2.3.4", config); // 3rd = over limit
    expect(result).not.toBeNull();
    expect(result?.status).toBe(429);
  });

  it("returns Retry-After header when blocked", async () => {
    const { checkRateLimit: check } = await import("../rateLimit");
    const config = { maxRequests: 1, windowMs: 30_000 };
    check("test:block", config);
    const result = check("test:block", config);
    const retryAfter = result?.headers.get("Retry-After");
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number(retryAfter)).toBeLessThanOrEqual(30);
  });

  it("resets window after windowMs elapses", async () => {
    const { checkRateLimit: check } = await import("../rateLimit");
    const config = { maxRequests: 1, windowMs: 5_000 };
    check("test:reset", config);
    const blocked = check("test:reset", config);
    expect(blocked).not.toBeNull(); // blocked in first window

    vi.advanceTimersByTime(6_000); // advance past window
    const allowed = check("test:reset", config);
    expect(allowed).toBeNull(); // new window, allowed again
  });

  it("tracks different keys independently", async () => {
    const { checkRateLimit: check } = await import("../rateLimit");
    const config = { maxRequests: 1, windowMs: 60_000 };
    check("test:1.1.1.1", config);
    const blockedA = check("test:1.1.1.1", config);
    const allowedB = check("test:2.2.2.2", config); // different key
    expect(blockedA).not.toBeNull();
    expect(allowedB).toBeNull();
  });

  it("triggers cleanup after 5 minutes and removes expired buckets", async () => {
    const { checkRateLimit: check } = await import("../rateLimit");
    const config = { maxRequests: 1, windowMs: 1_000 };
    check("test:cleanup", config);

    vi.advanceTimersByTime(301_000); // past 5-minute cleanup threshold
    // Create a new key to trigger cleanup
    const result = check("test:new-after-cleanup", config);
    expect(result).toBeNull(); // should succeed
  });
});

describe("rateLimitKey", () => {
  it("uses userId when provided", () => {
    const req = new Request("http://localhost", { headers: {} });
    expect(rateLimitKey("chat", req, "user-123")).toBe("chat:user-123");
  });

  it("falls back to x-forwarded-for IP", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    expect(rateLimitKey("chat", req)).toBe("chat:1.2.3.4");
  });

  it("uses LAST IP from comma-separated x-forwarded-for (최좌측은 스푸핑 가능 — 감사 2.2 M2)", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(rateLimitKey("chat", req)).toBe("chat:5.6.7.8");
  });

  it("prefers x-real-ip over x-forwarded-for", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "7.7.7.7", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(rateLimitKey("chat", req)).toBe("chat:7.7.7.7");
  });

  it("spoofed leftmost XFF cannot create fresh buckets", () => {
    const spoofed = new Request("http://localhost", {
      headers: { "x-forwarded-for": "6.6.6.6, 5.6.7.8" },
    });
    const spoofed2 = new Request("http://localhost", {
      headers: { "x-forwarded-for": "9.9.9.9, 5.6.7.8" },
    });
    expect(rateLimitKey("chat", spoofed)).toBe(rateLimitKey("chat", spoofed2));
  });

  it("falls back to 'unknown' when no IP header", () => {
    const req = new Request("http://localhost", { headers: {} });
    expect(rateLimitKey("chat", req)).toBe("chat:unknown");
  });

  it("prefers userId over IP header", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
    expect(rateLimitKey("chat", req, "user-abc")).toBe("chat:user-abc");
  });
});

describe("checkRateLimitPersistent", () => {
  const userId = "123e4567-e89b-42d3-a456-426614174000";
  const strongRateLimitSecret = "R7vY0M5sK8qN2bF9xW4cL6jH1pT3dG5zA9uE";

  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
    rpcMock.mockReset();
    createClientMock.mockReturnValue({ rpc: rpcMock });
    rpcMock.mockResolvedValue({
      data: [{ allowed: true, retry_after_seconds: 0 }],
      error: null,
    });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    process.env.RATE_LIMIT_KEY_SECRET = strongRateLimitSecret;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.RATE_LIMIT_KEY_SECRET;
    delete process.env.ADMIN_PASSWORD;
    vi.restoreAllMocks();
  });

  it("passes an authenticated UUID separately from the opaque key", async () => {
    const { checkRateLimitPersistent: check } = await import("../rateLimit");

    await check("chat:raw-user-key", { maxRequests: 3, windowMs: 60_000 }, userId);

    expect(rpcMock).toHaveBeenCalledWith("check_rate_limit", {
      p_key: expect.stringMatching(/^rl:[0-9a-f]{64}$/),
      p_max_requests: 3,
      p_window_ms: 60_000,
      p_subject_user_id: userId,
    });
    expect(rpcMock.mock.calls[0]?.[1]?.p_key).not.toContain(userId);
  });

  it("keeps IP and email limiters anonymous", async () => {
    const { checkRateLimitPersistent: check } = await import("../rateLimit");

    await check("signup:203.0.113.9", { maxRequests: 3, windowMs: 60_000 });
    await check("signup-email:user@example.com", { maxRequests: 3, windowMs: 60_000 });

    expect(rpcMock).toHaveBeenNthCalledWith(1, "check_rate_limit", expect.objectContaining({
      p_subject_user_id: null,
    }));
    expect(rpcMock).toHaveBeenNthCalledWith(2, "check_rate_limit", expect.objectContaining({
      p_subject_user_id: null,
    }));
  });

  it("fails closed when a subject account is missing or deleting", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "referenced account is not active" },
    });
    const { checkRateLimitPersistent: check } = await import("../rateLimit");

    const result = await check("chat:subject", { maxRequests: 3, windowMs: 60_000 }, userId);

    expect(result?.status).toBe(403);
    await expect(result?.json()).resolves.toEqual({
      code: "ACCOUNT_REQUEST_BLOCKED",
      error: "현재 계정 상태로는 요청을 처리할 수 없습니다.",
    });
  });

  it("fails closed when an authenticated key is bound to another subject", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "rate limit subject mismatch" },
    });
    const { checkRateLimitPersistent: check } = await import("../rateLimit");

    const result = await check("chat:subject", { maxRequests: 3, windowMs: 60_000 }, userId);

    expect(result?.status).toBe(409);
    await expect(result?.json()).resolves.toEqual({
      code: "RATE_LIMIT_SUBJECT_CONFLICT",
      error: "요청 상태가 일치하지 않습니다. 새로고침 후 다시 시도해주세요.",
    });
  });

  it("fails closed on authenticated persistent limiter outages", async () => {
    rpcMock.mockRejectedValue(new Error("database unavailable"));
    const { checkRateLimitPersistent: check } = await import("../rateLimit");

    const result = await check("chat:subject", { maxRequests: 3, windowMs: 60_000 }, userId);

    expect(result?.status).toBe(503);
    expect(result?.headers.get("Retry-After")).toBe("5");
  });

  it("keeps the in-memory availability fallback only for anonymous failures", async () => {
    rpcMock.mockRejectedValue(new Error("database unavailable"));
    const { checkRateLimitPersistent: check } = await import("../rateLimit");

    const result = await check("signup:203.0.113.9", { maxRequests: 3, windowMs: 60_000 });

    expect(result).toBeNull();
  });

  it("fails closed for subjects when persistent limiter configuration is absent", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { checkRateLimitPersistent: check } = await import("../rateLimit");

    const result = await check("chat:subject", { maxRequests: 3, windowMs: 60_000 }, userId);

    expect(result?.status).toBe(503);
  });

  it("never persists an anonymous limiter key without a strong dedicated secret", async () => {
    delete process.env.RATE_LIMIT_KEY_SECRET;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { checkRateLimitPersistent: check } = await import("../rateLimit");

    const result = await check("signup-email:user@example.com", {
      maxRequests: 3,
      windowMs: 60_000,
    });

    expect(result).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "RATE_LIMIT_PERSISTENCE_CONFIGURATION_UNAVAILABLE"
    );
  });

  it("fails closed for an authenticated subject before persistence when its secret is weak", async () => {
    process.env.RATE_LIMIT_KEY_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { checkRateLimitPersistent: check } = await import("../rateLimit");

    const result = await check(
      "chat:subject",
      { maxRequests: 3, windowMs: 60_000 },
      userId
    );

    expect(result?.status).toBe(503);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "RATE_LIMIT_PERSISTENCE_CONFIGURATION_UNAVAILABLE"
    );
  });

  it("does not log database detail from the non-strict persistent limiter", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "XX000",
        message: "postgresql://operator:do-not-log@example.invalid/internal",
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { checkRateLimitPersistent: check } = await import("../rateLimit");

    const result = await check("signup:203.0.113.9", {
      maxRequests: 3,
      windowMs: 60_000,
    });

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith("RATE_LIMIT_PERSISTENCE_FAILED");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("do-not-log");
  });

  it("fails closed for strict operational boundaries instead of using local memory", async () => {
    rpcMock.mockRejectedValue(new Error("database unavailable"));
    const { checkRateLimitPersistentStrict: check } = await import("../rateLimit");

    const result = await check("admin-auth:203.0.113.9", {
      maxRequests: 8,
      windowMs: 15 * 60_000,
    });

    expect(result?.status).toBe(503);
    expect(result?.headers.get("Retry-After")).toBe("5");
  });

  it("keeps strict operational limiter subjects anonymous in the database", async () => {
    const { checkRateLimitPersistentStrict: check } = await import("../rateLimit");

    await check("admin-auth:203.0.113.9", { maxRequests: 8, windowMs: 15 * 60_000 });

    expect(rpcMock).toHaveBeenCalledWith("check_rate_limit", expect.objectContaining({
      p_subject_user_id: null,
    }));
  });

  it.each<[string | undefined]>([
    [undefined],
    ["replace-with-a-random-secret-value-123456"],
    ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  ])("fails before database access when the strict secret is %s", async (secret) => {
    if (secret === undefined) delete process.env.RATE_LIMIT_KEY_SECRET;
    else process.env.RATE_LIMIT_KEY_SECRET = secret;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { checkRateLimitPersistentStrict: check } = await import("../rateLimit");

    const result = await check("admin-auth:203.0.113.9", {
      maxRequests: 8,
      windowMs: 15 * 60_000,
    });

    expect(result?.status).toBe(503);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "RATE_LIMIT_STRICT_CONFIGURATION_UNAVAILABLE"
    );
  });

  it("rejects a strict secret reused by another trust boundary before database access", async () => {
    process.env.ADMIN_PASSWORD = strongRateLimitSecret;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { checkRateLimitPersistentStrict: check } = await import("../rateLimit");

    const result = await check("admin-auth:203.0.113.9", {
      maxRequests: 8,
      windowMs: 15 * 60_000,
    });

    expect(result?.status).toBe(503);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "RATE_LIMIT_STRICT_CONFIGURATION_UNAVAILABLE"
    );
  });

  it("logs only a symbolic error when strict persistence returns sensitive detail", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "XX000",
        message: "postgresql://operator:do-not-log@example.invalid/internal",
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { checkRateLimitPersistentStrict: check } = await import("../rateLimit");

    const result = await check("admin-auth:203.0.113.9", {
      maxRequests: 8,
      windowMs: 15 * 60_000,
    });

    expect(result?.status).toBe(503);
    expect(errorSpy).toHaveBeenCalledWith("RATE_LIMIT_STRICT_PERSISTENCE_FAILED");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("do-not-log");
    errorSpy.mockRestore();
  });
});
