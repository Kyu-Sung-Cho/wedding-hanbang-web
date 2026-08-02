import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimitKey, rateLimitSubjectKey } from "../rateLimit";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc: mocks.rpc })),
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

  it("charges weighted batches without allowing an overflowing partial debit", async () => {
    const { checkRateLimit: check } = await import("../rateLimit");
    expect(check("test:weighted", { maxRequests: 5, windowMs: 60_000, cost: 3 })).toBeNull();
    const blocked = check("test:weighted", { maxRequests: 5, windowMs: 60_000, cost: 3 });
    expect(blocked?.status).toBe(429);
    expect(check("test:weighted", { maxRequests: 5, windowMs: 60_000, cost: 2 })).toBeNull();
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
    expect(result?.headers.get("Cache-Control")).toContain("no-store");
    expect(result?.headers.get("Vary")).toContain("Authorization");
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
  beforeEach(() => {
    vi.stubEnv("RATE_LIMIT_KEY_SECRET", "release-test-secret-that-is-at-least-32-bytes");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses userId when provided", () => {
    const req = new Request("http://localhost", { headers: {} });
    const key = rateLimitKey("chat", req, "user-123");
    expect(key).toMatch(/^chat:hmac-sha256:[a-f0-9]{64}$/);
    expect(key).not.toContain("user-123");
  });

  it("falls back to x-forwarded-for IP", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    const key = rateLimitKey("chat", req);
    expect(key).toMatch(/^chat:hmac-sha256:[a-f0-9]{64}$/);
    expect(key).not.toContain("1.2.3.4");
  });

  it("uses LAST IP from comma-separated x-forwarded-for (최좌측은 스푸핑 가능 — 감사 2.2 M2)", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    const trustedHop = rateLimitKey("chat", req);
    const directTrustedHop = rateLimitKey(
      "chat",
      new Request("http://localhost", {
        headers: { "x-forwarded-for": "5.6.7.8" },
      }),
    );
    expect(trustedHop).toBe(directTrustedHop);
  });

  it("prefers x-real-ip over x-forwarded-for", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "7.7.7.7", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(rateLimitKey("chat", req)).toBe(
      rateLimitKey(
        "chat",
        new Request("http://localhost", { headers: { "x-real-ip": "7.7.7.7" } }),
      ),
    );
  });

  it("prefers Vercel's platform forwarding header over proxy-overwritable headers", () => {
    const req = new Request("http://localhost", {
      headers: {
        "x-vercel-forwarded-for": "8.8.8.8",
        "x-real-ip": "7.7.7.7",
        "x-forwarded-for": "1.2.3.4",
      },
    });
    expect(rateLimitKey("chat", req)).toBe(
      rateLimitKey(
        "chat",
        new Request("http://localhost", {
          headers: { "x-vercel-forwarded-for": "8.8.8.8" },
        }),
      ),
    );
  });

  it("ignores malformed IP headers instead of creating attacker-chosen buckets", () => {
    const malformed = new Request("http://localhost", {
      headers: {
        "x-vercel-forwarded-for": "attacker-controlled",
        "x-real-ip": "also-not-an-ip",
        "x-forwarded-for": "garbage, 5.6.7.8",
      },
    });
    const validFallback = new Request("http://localhost", {
      headers: { "x-forwarded-for": "5.6.7.8" },
    });
    expect(rateLimitKey("chat", malformed)).toBe(rateLimitKey("chat", validFallback));
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
    const key = rateLimitKey("chat", req);
    expect(key).toMatch(/^chat:hmac-sha256:[a-f0-9]{64}$/);
    expect(key).not.toContain("unknown");
  });

  it("prefers userId over IP header", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
    expect(rateLimitKey("chat", req, "user-abc")).toBe(
      rateLimitKey("chat", new Request("http://localhost"), "user-abc"),
    );
  });

  it("pseudonymizes normalized email subjects before persistent storage", () => {
    const key = rateLimitSubjectKey("signup-email", "person@example.com");
    expect(key).toMatch(/^signup-email:hmac-sha256:[a-f0-9]{64}$/);
    expect(key).not.toContain("person@example.com");
  });

  it("keeps labels separated even for the same subject", () => {
    const signup = rateLimitSubjectKey("signup-email", "person@example.com");
    const forgot = rateLimitSubjectKey("forgot-email", "person@example.com");
    expect(signup).not.toBe(forgot);
  });

  it("uses a deterministic SHA-256 fallback without persisting the raw subject locally", () => {
    vi.stubEnv("RATE_LIMIT_KEY_SECRET", "");
    const first = rateLimitSubjectKey("chat", "user-123");
    const second = rateLimitSubjectKey("chat", "user-123");
    expect(first).toBe(second);
    expect(first).toMatch(/^chat:sha256:[a-f0-9]{64}$/);
    expect(first).not.toContain("user-123");
  });

  it.each(["", "short", "x".repeat(40), "placeholder-secret-that-is-long-enough"])(
    "fails closed for a missing or weak production pseudonym key",
    (secret) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("RATE_LIMIT_KEY_SECRET", secret);

      expect(() => rateLimitSubjectKey("signup-email", "person@example.com"))
        .toThrow("RATE_LIMIT_KEY_SECRET_INVALID");
    },
  );
});

describe("checkRateLimitPersistent fail-closed mode", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"a".repeat(40)}`);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns 503 when the shared limiter configuration is unavailable", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { checkRateLimitPersistent } = await import("../rateLimit");

    const response = await checkRateLimitPersistent(
      "community:search:missing-config",
      { maxRequests: 30, windowMs: 60_000 },
    );

    expect(response?.status).toBe(503);
    expect(response?.headers.get("Retry-After")).toBe("60");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("defaults to 503 instead of an instance-local fallback when the shared RPC fails", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });
    const { checkRateLimitPersistent } = await import("../rateLimit");

    const response = await checkRateLimitPersistent(
      "provider-cost:test-user",
      { maxRequests: 30, windowMs: 60 * 60 * 1000 },
    );

    expect(response?.status).toBe(503);
    expect(response?.headers.get("Retry-After")).toBe("60");
    await expect(response?.json()).resolves.toMatchObject({
      error: expect.any(String),
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("treats a malformed shared RPC result as unavailable, not a valid allowance", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const { checkRateLimitPersistent } = await import("../rateLimit");

    const response = await checkRateLimitPersistent(
      "provider-cost:malformed",
      { maxRequests: 30, windowMs: 60 * 60 * 1000 },
      { failClosed: true },
    );

    expect(response?.status).toBe(503);
  });

  it("allows an explicitly reviewed endpoint to opt into the local fallback", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });
    const { checkRateLimitPersistent } = await import("../rateLimit");

    const response = await checkRateLimitPersistent(
      "best-effort:test-user",
      { maxRequests: 30, windowMs: 60 * 60 * 1000 },
      { failClosed: false },
    );

    expect(response).toBeNull();
  });

  it("passes an atomic batch cost to the shared limiter RPC", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ allowed: true, retry_after_seconds: 0 }],
      error: null,
    });
    const { checkRateLimitPersistent } = await import("../rateLimit");

    const response = await checkRateLimitPersistent(
      "events:vendor:hmac-sha256:" + "a".repeat(64),
      { maxRequests: 60, windowMs: 60_000, cost: 20 },
    );

    expect(response).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith("check_rate_limit_cost", {
      p_key: "events:vendor:hmac-sha256:" + "a".repeat(64),
      p_max_requests: 60,
      p_window_ms: 60_000,
      p_cost: 20,
    });
  });

  it("sends concurrent attempts to the shared atomic bucket and preserves every denial", async () => {
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ordinal = 0;
    mocks.rpc.mockImplementation(async () => {
      const current = ordinal;
      ordinal += 1;
      await barrier;
      return {
        data: [{ allowed: current < 3, retry_after_seconds: current < 3 ? 0 : 60 }],
        error: null,
      };
    });
    const { checkRateLimitPersistent } = await import("../rateLimit");

    const pending = Array.from({ length: 6 }, () => checkRateLimitPersistent(
      "community:post:create:hmac-sha256:" + "b".repeat(64),
      { maxRequests: 3, windowMs: 60_000 },
    ));
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(6));
    release?.();
    const results = await Promise.all(pending);

    expect(results.slice(0, 3)).toEqual([null, null, null]);
    expect(results.slice(3).map((response) => response?.status)).toEqual([429, 429, 429]);
    expect(mocks.rpc).toHaveBeenCalledTimes(6);
  });
});
