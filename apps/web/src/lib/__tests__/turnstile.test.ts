import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasCanonicalTurnstileHostname,
  hasTurnstileConfig,
  hasTurnstileCredentials,
  normalizeEmailForRateLimit,
  PRODUCTION_TURNSTILE_HOSTNAME,
  verifyTurnstile,
} from "../turnstile";

const TEST_TURNSTILE_SECRET = [
  "0x4AAAAAAADDDDDDDD",
  "EEEEEEEEEEEEEEEE",
].join("");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("normalizeEmailForRateLimit — 이메일 폭탄 우회 방어", () => {
  it("기본: trim + lowercase", () => {
    expect(normalizeEmailForRateLimit("  Victim@Example.COM ")).toBe("victim@example.com");
  });

  it("Gmail plus 별칭을 하나로 합친다 (victim+1, victim+spam → victim)", () => {
    const base = normalizeEmailForRateLimit("victim@gmail.com");
    expect(normalizeEmailForRateLimit("victim+1@gmail.com")).toBe(base);
    expect(normalizeEmailForRateLimit("victim+anything@gmail.com")).toBe(base);
  });

  it("Gmail dot 변형을 합친다 (v.i.c.t.i.m → victim)", () => {
    expect(normalizeEmailForRateLimit("v.i.c.t.i.m@gmail.com")).toBe("victim@gmail.com");
    expect(normalizeEmailForRateLimit("vic.tim@googlemail.com")).toBe("victim@gmail.com");
  });

  it("Gmail dot+plus 조합도 하나로 (v.ictim+9 → victim)", () => {
    expect(normalizeEmailForRateLimit("v.ictim+9@gmail.com")).toBe("victim@gmail.com");
  });

  it("비-Gmail 도메인: plus 별칭만 제거, 점은 보존(도메인마다 의미가 다름)", () => {
    expect(normalizeEmailForRateLimit("user+tag@company.com")).toBe("user@company.com");
    expect(normalizeEmailForRateLimit("first.last@company.com")).toBe("first.last@company.com");
  });

  it("같은 피해자의 모든 Gmail 변형이 단일 rate-limit 키로 수렴한다", () => {
    const variants = [
      "victim@gmail.com",
      "victim+1@gmail.com",
      "v.i.c.t.i.m@gmail.com",
      "Victim+999@Gmail.com",
      "vict.im@googlemail.com",
    ];
    const keys = new Set(variants.map(normalizeEmailForRateLimit));
    expect(keys.size).toBe(1);
  });

  it("@ 없는 입력은 그대로 소문자화만", () => {
    expect(normalizeEmailForRateLimit("notanemail")).toBe("notanemail");
  });
});

describe("verifyTurnstile — production guard", () => {
  it("reports only a complete, non-test credential pair as configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://hanbang.ai");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAAAAABBBBBBBBCCCCCCCC");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TEST_TURNSTILE_SECRET);
    expect(hasTurnstileCredentials()).toBe(true);
    expect(hasCanonicalTurnstileHostname()).toBe(true);
    expect(hasTurnstileConfig()).toBe(true);

    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(hasTurnstileConfig()).toBe(false);

    vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
    expect(hasTurnstileConfig()).toBe(false);

    vi.stubEnv("TURNSTILE_SECRET_KEY", "placeholder-turnstile-secret-value");
    expect(hasTurnstileConfig()).toBe(false);

    vi.stubEnv("TURNSTILE_SECRET_KEY", ` ${TEST_TURNSTILE_SECRET}`);
    expect(hasTurnstileCredentials()).toBe(false);

    vi.stubEnv("TURNSTILE_SECRET_KEY", "0x4AAAAAAABBBBBBBBCCCCCCCC");
    expect(hasTurnstileCredentials()).toBe(false);

    vi.stubEnv("TURNSTILE_SECRET_KEY", TEST_TURNSTILE_SECRET);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://hanbang.ai");
    expect(hasTurnstileConfig()).toBe(false);

    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://untrusted.example");
    expect(hasTurnstileCredentials()).toBe(true);
    expect(hasCanonicalTurnstileHostname()).toBe(false);
    expect(hasTurnstileConfig()).toBe(false);

    vi.stubEnv("NEXT_PUBLIC_SITE_URL", " https://hanbang.ai");
    expect(hasCanonicalTurnstileHostname()).toBe(false);
    expect(PRODUCTION_TURNSTILE_HOSTNAME).toBe("hanbang.ai");
  });

  it("never derives the accepted production hostname from a mutable site URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://untrusted.example");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAAAAABBBBBBBBCCCCCCCC");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TEST_TURNSTILE_SECRET);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyTurnstile("attacker-controlled-host-token", null, "signup")
    ).resolves.toEqual({ ok: false, skipped: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds a successful token to the canonical hostname and expected action", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://hanbang.ai");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAAAAABBBBBBBBCCCCCCCC");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TEST_TURNSTILE_SECRET);
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        success: true,
        hostname: "hanbang.ai",
        action: "signup",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyTurnstile("single-use-token", "203.0.113.5", "signup")
    ).resolves.toEqual({ ok: true, skipped: false });
    const request = fetchMock.mock.calls[0]?.[1] as { body?: URLSearchParams };
    expect(request.body?.get("secret")).toBe(
      TEST_TURNSTILE_SECRET
    );
    expect(request.body?.get("response")).toBe("single-use-token");
    expect(request.body?.get("remoteip")).toBe("203.0.113.5");
  });

  it("fails closed on hostname mismatch, action mismatch, or oversized input", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://hanbang.ai");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAAAAABBBBBBBBCCCCCCCC");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TEST_TURNSTILE_SECRET);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          success: true,
          hostname: "untrusted.example",
          action: "signup",
        }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          success: true,
          hostname: "hanbang.ai",
          action: "survey",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyTurnstile("hostname-token", null, "signup")
    ).resolves.toEqual({ ok: false, skipped: false });
    await expect(
      verifyTurnstile("action-token", null, "signup")
    ).resolves.toEqual({ ok: false, skipped: false });
    await expect(
      verifyTurnstile("x".repeat(2049), null, "signup")
    ).resolves.toEqual({ ok: false, skipped: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows local no-op when the secret is missing", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");

    await expect(verifyTurnstile(undefined)).resolves.toEqual({
      ok: true,
      skipped: true,
    });
  });

  it("fails closed in production when the secret is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");

    await expect(verifyTurnstile(undefined)).resolves.toEqual({
      ok: false,
      skipped: false,
    });
  });
});
