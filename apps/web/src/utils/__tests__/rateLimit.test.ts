import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { rateLimitKey } from "../rateLimit";

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
