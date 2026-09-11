import { SIGNUP_CONSENT_POLICY_VERSION } from "@hanbang/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyTurnstile: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  createAdminClient: vi.fn(),
  generateLink: vi.fn(),
  createUser: vi.fn(),
  updateUserById: vi.fn(),
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

/**
 * 메일에 **실제로 실린** 인증 링크.
 *
 * 예전에는 `generateLink(options.redirectTo)` 를 봤다. 그 인자는 Supabase 가
 * 만드는 링크의 목적지였는데, 그 링크 자체가 결과를 해시로 돌려줘 서버에서
 * 쓸 수 없었다(2026-08-22). 이제 링크는 우리가 만들어 메일에 넣으므로,
 * 사용자가 누르는 그 URL 을 직접 본다.
 */
function confirmLinkFromSentEmail(): URL {
  const html = String(mocks.send.mock.calls[0]?.[0]?.html ?? "");
  // 정규식을 쓰지 않는다 — 이 저장소에서 이스케이프가 깨진 정규식이 조용히
  // 다른 것을 매칭한 적이 있다. 경계 문자로 자르는 편이 눈으로 검증된다.
  const start = html.indexOf("https://hanbang.ai/api/auth/confirm");
  if (start === -1) throw new Error("보낸 메일에 인증 링크가 없다");
  let end = start;
  while (end < html.length && !['"', "'", "<", " ", "\n"].includes(html[end])) end += 1;
  return new URL(html.slice(start, end).replace(/&amp;/g, "&"));
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
      data: { user: { id: "synthetic-new-user", email: "sample@example.test", app_metadata: { provider: "email" } }, properties: { hashed_token: "tok_test" } },
      error: null,
    });
    mocks.createAdminClient.mockReturnValue({
      auth: { admin: { createUser: mocks.createUser, generateLink: mocks.generateLink, updateUserById: mocks.updateUserById } },
    });
    mocks.updateUserById.mockResolvedValue({ error: null });
    mocks.createUser.mockResolvedValue({ data: { user: { id: "synthetic-new-user", email: "sample@example.test" } }, error: null });
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
      ageOver14Confirmed: true,
  consentPolicyVersion: SIGNUP_CONSENT_POLICY_VERSION,
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
      ageOver14Confirmed: true,
  consentPolicyVersion: SIGNUP_CONSENT_POLICY_VERSION,
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
      ageOver14Confirmed: true,
  consentPolicyVersion: SIGNUP_CONSENT_POLICY_VERSION,
      turnstileToken: "proof",
      redirect: "/wedding/chat",
    }));

    const confirmLink = confirmLinkFromSentEmail();
    expect(confirmLink.pathname).toBe("/api/auth/confirm");
    expect(confirmLink.searchParams.get("redirect")).toBe("/wedding/chat");
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
      ageOver14Confirmed: true,
  consentPolicyVersion: SIGNUP_CONSENT_POLICY_VERSION,
      turnstileToken: "proof",
      redirect: "https://attacker.example/steal",
    }));

    const confirmLink = confirmLinkFromSentEmail();
    expect(confirmLink.origin).toBe("https://hanbang.ai");
    expect(confirmLink.pathname).toBe("/api/auth/confirm");
    expect(confirmLink.searchParams.has("redirect")).toBe(false);
    expect(confirmLink.href).not.toContain("attacker.example");
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
      ageOver14Confirmed: true,
  consentPolicyVersion: SIGNUP_CONSENT_POLICY_VERSION,
      turnstileToken: "proof",
    }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(JSON.stringify(body)).not.toContain(providerMessage);
    expect(body).toEqual({ error: "인증 링크를 준비하지 못했어요. 잠시 후 다시 시도해 주세요." });
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
