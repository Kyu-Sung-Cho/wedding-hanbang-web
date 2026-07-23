import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeEmailForRateLimit, verifyTurnstile } from "../turnstile";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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
  it("allows local no-op when the secret is missing", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");

    await expect(verifyTurnstile(undefined)).resolves.toEqual({
      ok: true,
      skipped: true,
    });
  });

  it("fails closed in production when provisioned but the secret is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAAAAA-site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");

    await expect(verifyTurnstile(undefined)).resolves.toEqual({
      ok: false,
      skipped: false,
    });
  });

  it("skips in production when the feature is not provisioned at all", async () => {
    // 사이트 키 미발급 = 위젯 자체가 없어 토큰이 존재할 수 없는 상태.
    // 이때 거부하면 봇이 아니라 모든 가입이 막힌다(2026-07-24 운영 사고 회귀 방지).
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");

    await expect(verifyTurnstile(undefined)).resolves.toEqual({
      ok: true,
      skipped: true,
    });
  });

  it("requires the verified token action to match the requested auth operation", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "sample-secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      action: "forgot",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(verifyTurnstile("sample-token", null, "signup")).resolves.toEqual({
      ok: false,
      skipped: false,
    });
  });

  it.each(["signup", "forgot", "preregister", "survey"] as const)(
    "accepts a successful verification only for the exact %s action",
    async (action) => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "sample-secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      action,
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(verifyTurnstile("sample-token", null, action)).resolves.toEqual({
      ok: true,
      skipped: false,
    });
    },
  );
});
