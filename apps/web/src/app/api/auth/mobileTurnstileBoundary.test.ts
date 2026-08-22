import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyTurnstile: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  createAdminClient: vi.fn(),
  generateLink: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: mocks.verifyTurnstile,
  normalizeEmailForRateLimit: (value: string) => value.toLowerCase(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  getClientIp: () => "203.0.113.1",
  rateLimitKey: () => "ip-key",
  rateLimitSubjectKey: () => "subject-key",
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

import { POST as forgotPassword } from "./forgot-password/route";
import { POST as signup } from "./signup/route";

function mobileRequest(path: string, body: unknown) {
  return new Request(`https://hanbang.ai/api/auth/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hanbang-client": "mobile",
    },
    body: JSON.stringify(body),
  });
}

function rawMobileRequest(path: string, body: string) {
  return new Request(`https://hanbang.ai/api/auth/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hanbang-client": "mobile",
    },
    body,
  });
}

describe("mobile Turnstile boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyTurnstile.mockResolvedValue({ ok: false, skipped: false });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.generateLink.mockResolvedValue({
      data: { properties: { action_link: "https://example.test/action" } },
      error: null,
    });
    mocks.createAdminClient.mockReturnValue({
      auth: { admin: { generateLink: mocks.generateLink } },
    });
    mocks.send.mockResolvedValue({ data: { id: "mail-id" }, error: null });
  });

  it("does not let a spoofed mobile header bypass signup verification", async () => {
    const response = await signup(mobileRequest("signup", {
      email: "sample@example.test",
      password: "Strong1!",
      name: "샘플 사용자",
      // 필수 동의 없이는 계정을 만들지 않는다(가입 동의 계약). 이 파일이
      // 지키려는 것은 Turnstile·레이트리밋 경계이므로 동의는 채워 넣는다.
      termsAgreed: true,
      privacyAgreed: true,
    }));

    expect(response.status).toBe(400);
    expect(mocks.verifyTurnstile).toHaveBeenCalledWith(undefined, "203.0.113.1", "signup");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not let a spoofed mobile header trigger recovery email generation", async () => {
    const response = await forgotPassword(mobileRequest("forgot-password", {
      email: "sample@example.test",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.verifyTurnstile).toHaveBeenCalledWith(undefined, "203.0.113.1", "forgot");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    ["signup", signup, 9 * 1024],
    ["forgot-password", forgotPassword, 5 * 1024],
  ] as const)("rejects a streamed oversized %s body without Content-Length", async (
    path,
    handler,
    size,
  ) => {
    const request = rawMobileRequest(path, JSON.stringify({ padding: "x".repeat(size) }));
    expect(request.headers.get("content-length")).toBeNull();

    const response = await handler(request);

    expect(response.status).toBe(413);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    ["signup", signup],
    ["forgot-password", forgotPassword],
  ] as const)("fails closed on malformed JSON for %s", async (path, handler) => {
    const response = await handler(rawMobileRequest(path, "{"));

    expect(response.status).toBe(400);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("applies the IP limiter before calling Turnstile for native signup", async () => {
    await signup(mobileRequest("signup", {
      email: "sample@example.test",
      password: "Strong1!",
      name: "샘플 사용자",
      // 필수 동의 없이는 계정을 만들지 않는다(가입 동의 계약). 이 파일이
      // 지키려는 것은 Turnstile·레이트리밋 경계이므로 동의는 채워 넣는다.
      termsAgreed: true,
      privacyAgreed: true,
      turnstileToken: "proof",
    }));

    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(1);
    expect(mocks.checkRateLimitPersistent.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.verifyTurnstile.mock.invocationCallOrder[0]);
  });

  it("preserves a safe post-signup destination in the email confirmation callback", async () => {
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });

    await signup(mobileRequest("signup", {
      email: "sample@example.test",
      password: "Strong1!",
      name: "샘플 사용자",
      // 필수 동의 없이는 계정을 만들지 않는다(가입 동의 계약). 이 파일이
      // 지키려는 것은 Turnstile·레이트리밋 경계이므로 동의는 채워 넣는다.
      termsAgreed: true,
      privacyAgreed: true,
      turnstileToken: "proof",
      redirect: "/wedding/chat",
    }));

    const redirectTo = mocks.generateLink.mock.calls[0]?.[0]?.options?.redirectTo;
    const callback = new URL(redirectTo);
    expect(callback.pathname).toBe("/api/auth/callback");
    expect(callback.searchParams.get("redirect")).toBe("/wedding/chat");
  });

  it("drops an external post-signup destination from the email confirmation callback", async () => {
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });

    await signup(mobileRequest("signup", {
      email: "sample@example.test",
      password: "Strong1!",
      name: "샘플 사용자",
      // 필수 동의 없이는 계정을 만들지 않는다(가입 동의 계약). 이 파일이
      // 지키려는 것은 Turnstile·레이트리밋 경계이므로 동의는 채워 넣는다.
      termsAgreed: true,
      privacyAgreed: true,
      turnstileToken: "proof",
      redirect: "https://attacker.example/steal",
    }));

    const redirectTo = mocks.generateLink.mock.calls[0]?.[0]?.options?.redirectTo;
    const callback = new URL(redirectTo);
    expect(callback.pathname).toBe("/api/auth/callback");
    expect(callback.searchParams.has("redirect")).toBe(false);
    expect(redirectTo).not.toContain("attacker.example");
  });

  it("does not expose a raw signup provider failure", async () => {
    const providerMessage = "internal auth tenant failure secret-detail";
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.generateLink.mockResolvedValue({
      data: { properties: null },
      error: { message: providerMessage },
    });

    const response = await signup(mobileRequest("signup", {
      email: "sample@example.test",
      password: "Strong1!",
      name: "샘플 사용자",
      // 필수 동의 없이는 계정을 만들지 않는다(가입 동의 계약). 이 파일이
      // 지키려는 것은 Turnstile·레이트리밋 경계이므로 동의는 채워 넣는다.
      termsAgreed: true,
      privacyAgreed: true,
      turnstileToken: "proof",
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(JSON.stringify(body)).not.toContain(providerMessage);
    expect(body).toEqual({ error: "회원가입 처리 중 오류가 발생했습니다." });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("masks a raw recovery provider failure with the enumeration-safe response", async () => {
    const providerMessage = "internal recovery lookup detail";
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.generateLink.mockResolvedValue({
      data: { properties: null },
      error: { message: providerMessage },
    });

    const response = await forgotPassword(mobileRequest("forgot-password", {
      email: "sample@example.test",
      turnstileToken: "proof",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
