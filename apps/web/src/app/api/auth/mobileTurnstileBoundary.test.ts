import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyTurnstile: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
  generateLink: vi.fn(),
  updateUserById: vi.fn(),
  deleteUser: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: mocks.verifyTurnstile,
  normalizeEmailForRateLimit: (value: string) => value.toLowerCase(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  getClientIp: () => "203.0.113.1",
  rateLimitKey: (scope: string) => `${scope}:ip-key`,
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

const CURRENT_POLICY_VERSIONS = {
  termsVersion: "2026-08-02",
  privacyVersion: "2026-08-02",
} as const;

const CURRENT_REQUIRED_POLICY_ACCEPTANCE = {
  termsAgreed: true,
  privacyAgreed: true,
  ...CURRENT_POLICY_VERSIONS,
} as const;

describe("mobile Turnstile boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://hanbang.ai");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    mocks.verifyTurnstile.mockResolvedValue({ ok: false, skipped: false });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "issue_signup_consent_intent") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "revoke_signup_consent_intent") {
        return Promise.resolve({ data: false, error: null });
      }
      return Promise.resolve({ data: null, error: new Error("unexpected rpc") });
    });
    mocks.generateLink.mockResolvedValue({
      data: {
        properties: {
          action_link: "https://project.supabase.co/auth/v1/verify?type=signup&token=hashed_signup_token-1234&redirect_to=https%3A%2F%2Fhanbang.ai%2Fapi%2Fauth%2Fcallback",
          hashed_token: "hashed-recovery-marker",
        },
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          app_metadata: { provider: "email", providers: ["email"] },
        },
      },
      error: null,
    });
    mocks.updateUserById.mockResolvedValue({
      data: {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          user_metadata: { name: "Sample User" },
        },
      },
      error: null,
    });
    mocks.deleteUser.mockResolvedValue({ data: null, error: null });
    mocks.createAdminClient.mockReturnValue({
      rpc: mocks.rpc,
      auth: {
        admin: {
          generateLink: mocks.generateLink,
          updateUserById: mocks.updateUserById,
          deleteUser: mocks.deleteUser,
        },
      },
    });
    mocks.send.mockResolvedValue({ data: { id: "mail-id" }, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ["missing", {}],
    ["terms false", { ...CURRENT_POLICY_VERSIONS, termsAgreed: false, privacyAgreed: true }],
    ["privacy false", { ...CURRENT_POLICY_VERSIONS, termsAgreed: true, privacyAgreed: false }],
    ["string true", { ...CURRENT_POLICY_VERSIONS, termsAgreed: "true", privacyAgreed: true }],
    ["stale terms version", {
      ...CURRENT_REQUIRED_POLICY_ACCEPTANCE,
      termsVersion: "2026-07-17",
    }],
  ])("rejects %s required consent before verification or admin work", async (_label, consent) => {
    const response = await signup(mobileRequest("signup", {
      email: "private-bride@example.test",
      password: "Strong1!",
      name: "Sample User",
      ...consent,
    }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "현재 약관을 확인하고 다시 동의해주세요." });
    expect(JSON.stringify(body)).not.toContain("private-bride@example.test");
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not let a spoofed mobile header bypass signup verification", async () => {
    const response = await signup(mobileRequest("signup", {
      email: "sample@example.test",
      password: "Strong1!",
      name: "샘플 사용자",
      ...CURRENT_REQUIRED_POLICY_ACCEPTANCE,
    }));

    expect(response.status).toBe(400);
    expect(mocks.verifyTurnstile).toHaveBeenCalledWith(
      undefined,
      "203.0.113.1",
      "signup",
      "hanbang.ai",
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.verifyTurnstile.mock.invocationCallOrder[0]);
  });

  it("does not let a spoofed mobile header trigger recovery email generation", async () => {
    const response = await forgotPassword(mobileRequest("forgot-password", {
      email: "sample@example.test",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.verifyTurnstile).toHaveBeenCalledWith(
      undefined,
      "203.0.113.1",
      "forgot",
      "hanbang.ai",
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.verifyTurnstile.mock.invocationCallOrder[0]);
  });

  it("never derives a deletion target from an already-registered error response", async () => {
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.generateLink.mockResolvedValueOnce({
      data: {
        properties: {
          action_link: "https://project.supabase.co/auth/v1/verify?type=signup&token=must-not-use",
        },
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          app_metadata: { provider: "email", providers: ["email"] },
        },
      },
      error: new Error("User already registered"),
    });

    const response = await signup(mobileRequest("signup", {
      email: "existing@example.test",
      password: "Strong1!",
      name: "Existing User",
      ...CURRENT_REQUIRED_POLICY_ACCEPTANCE,
      turnstileToken: "verified-turnstile-token",
    }));

    expect(response.status).toBe(200);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    const issuedToken = mocks.rpc.mock.calls[0]?.[1]?.p_token as string;
    expect(issuedToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "revoke_signup_consent_intent",
      { p_token: issuedToken },
    );
  });

  it("fails before Auth user creation when the consent intent cannot be issued", async () => {
    const privateMarker = "private-bride@example.test";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error(privateMarker) });

    const response = await signup(mobileRequest("signup", {
      email: privateMarker,
      password: "Strong1!",
      name: "Sample User",
      ...CURRENT_REQUIRED_POLICY_ACCEPTANCE,
      turnstileToken: "verified-turnstile-token",
    }));

    expect(response.status).toBe(500);
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateMarker);
    consoleError.mockRestore();
  });

  it("revokes the pending intent when generateLink throws", async () => {
    const privateMarker = "private-bride@example.test";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.generateLink.mockRejectedValueOnce(new Error(privateMarker));
    mocks.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    const response = await signup(mobileRequest("signup", {
      email: privateMarker,
      password: "Strong1!",
      name: "Sample User",
      ...CURRENT_REQUIRED_POLICY_ACCEPTANCE,
      turnstileToken: "verified-turnstile-token",
    }));

    expect(response.status).toBe(500);
    const issuedToken = mocks.rpc.mock.calls[0]?.[1]?.p_token as string;
    expect(mocks.rpc.mock.calls[1]).toEqual([
      "revoke_signup_consent_intent",
      { p_token: issuedToken },
    ]);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateMarker);
    consoleError.mockRestore();
  });

  it("deletes a user if Auth reports success without consuming the hook intent", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    const response = await signup(mobileRequest("signup", {
      email: "sample@example.test",
      password: "Strong1!",
      name: "Sample User",
      ...CURRENT_REQUIRED_POLICY_ACCEPTANCE,
      turnstileToken: "verified-turnstile-token",
    }));

    expect(response.status).toBe(500);
    expect(mocks.deleteUser).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("sends only a first-party one-time token_hash recovery link", async () => {
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });

    const response = await forgotPassword(mobileRequest("forgot-password", {
      email: "sample@example.test",
      redirect: "/admin/login",
      turnstileToken: "verified-turnstile-token",
    }));

    expect(response.status).toBe(200);
    expect(mocks.generateLink).toHaveBeenCalledWith({
      type: "recovery",
      email: "sample@example.test",
      options: { redirectTo: "https://hanbang.ai/reset-password" },
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const message = mocks.send.mock.calls[0]?.[0] as { html?: string };
    expect(message.html).toContain(
      "https://hanbang.ai/reset-password?redirect=%2Fadmin%2Flogin#token_hash=hashed-recovery-marker&amp;type=recovery",
    );
    expect(message.html).not.toContain("provider.example.test");
    expect(message.html).not.toContain("must-not-send");
  });

  it("sends only a provider-bound, HTML-escaped signup confirmation link", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T03:04:05.678Z"));
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });

    const response = await signup(mobileRequest("signup", {
      email: "sample@example.test",
      password: "Strong1!",
      name: "Sample User",
      ...CURRENT_REQUIRED_POLICY_ACCEPTANCE,
      marketingAgreed: true,
      turnstileToken: "verified-turnstile-token",
    }));

    expect(response.status).toBe(200);
    const issuedToken = mocks.rpc.mock.calls[0]?.[1]?.p_token as string;
    expect(issuedToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.rpc.mock.calls[0]).toEqual([
      "issue_signup_consent_intent",
      {
        p_email: "sample@example.test",
        p_token: issuedToken,
        p_terms_version: "2026-08-02",
        p_privacy_version: "2026-08-02",
        p_marketing_agreed: true,
      },
    ]);
    expect(mocks.generateLink).toHaveBeenCalledWith({
      type: "signup",
      email: "sample@example.test",
      password: "Strong1!",
      options: {
        data: {
          name: "Sample User",
          signup_consent_intent: issuedToken,
        },
        redirectTo: "https://hanbang.ai/api/auth/callback",
      },
    });
    expect(mocks.rpc.mock.calls[1]).toEqual([
      "revoke_signup_consent_intent",
      { p_token: issuedToken },
    ]);
    expect(mocks.updateUserById).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      {
        user_metadata: {
          name: "Sample User",
          signup_consent_intent: null,
        },
        app_metadata: {
          provider: "email",
          providers: ["email"],
          terms_agreed_at: "2026-08-02T03:04:05.678Z",
          terms_version: "2026-08-02",
          privacy_agreed_at: "2026-08-02T03:04:05.678Z",
          privacy_version: "2026-08-02",
          marketing_agreed: true,
          marketing_agreed_at: "2026-08-02T03:04:05.678Z",
        },
      },
    );
    expect(JSON.stringify(mocks.updateUserById.mock.calls[0]?.[1]))
      .not.toContain(issuedToken);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const message = mocks.send.mock.calls[0]?.[0] as { html?: string };
    expect(message.html).toContain(
      "https://project.supabase.co/auth/v1/verify?type=signup&amp;token=hashed_signup_token-1234&amp;redirect_to=https%3A%2F%2Fhanbang.ai%2Fapi%2Fauth%2Fcallback",
    );
    expect(message.html).not.toContain("?type=signup&token=");
  });

  it("keeps optional marketing consent false without inventing an acceptance timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T04:05:06.789Z"));
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });

    const response = await signup(mobileRequest("signup", {
      email: "sample@example.test",
      password: "Strong1!",
      name: "Sample User",
      ...CURRENT_REQUIRED_POLICY_ACCEPTANCE,
      marketingAgreed: false,
      turnstileToken: "verified-turnstile-token",
    }));

    expect(response.status).toBe(200);
    expect(mocks.generateLink).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        data: expect.objectContaining({ name: "Sample User" }),
      }),
    }));
    const appMetadata = mocks.updateUserById.mock.calls[0]?.[1]?.app_metadata;
    expect(appMetadata).toMatchObject({
      marketing_agreed: false,
      terms_version: "2026-08-02",
      privacy_version: "2026-08-02",
    });
    expect(appMetadata).not.toHaveProperty("marketing_agreed_at");
  });

  it("rolls back a partial signup when trusted consent metadata cannot be persisted", async () => {
    const privateMarker = "private-bride@example.test";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.updateUserById.mockResolvedValueOnce({
      data: { user: null },
      error: new Error(privateMarker),
    });

    const response = await signup(mobileRequest("signup", {
      email: privateMarker,
      password: "Strong1!",
      name: "Sample User",
      ...CURRENT_REQUIRED_POLICY_ACCEPTANCE,
      turnstileToken: "verified-turnstile-token",
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "회원가입 처리 중 오류가 발생했습니다." });
    expect(mocks.deleteUser).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(mocks.send).not.toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateMarker);
    consoleError.mockRestore();
  });

  it("rolls back when Supabase does not prove removal of the one-time intent token", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.updateUserById.mockResolvedValueOnce({
      data: {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          user_metadata: {
            name: "Sample User",
            signup_consent_intent: "residual-one-time-token",
          },
        },
      },
      error: null,
    });

    const response = await signup(mobileRequest("signup", {
      email: "sample@example.test",
      password: "Strong1!",
      name: "Sample User",
      ...CURRENT_REQUIRED_POLICY_ACCEPTANCE,
      turnstileToken: "verified-turnstile-token",
    }));

    expect(response.status).toBe(500);
    expect(mocks.deleteUser).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(mocks.send).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("rejects a generated signup link from a different provider origin", async () => {
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.generateLink.mockResolvedValueOnce({
      data: {
        properties: {
          action_link: "https://attacker.example/auth/v1/verify?type=signup&token=hashed_signup_token-1234&redirect_to=https%3A%2F%2Fhanbang.ai%2Fapi%2Fauth%2Fcallback",
        },
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          app_metadata: { provider: "email", providers: ["email"] },
        },
      },
      error: null,
    });

    const response = await signup(mobileRequest("signup", {
      email: "sample@example.test",
      password: "Strong1!",
      name: "Sample User",
      ...CURRENT_REQUIRED_POLICY_ACCEPTANCE,
      turnstileToken: "verified-turnstile-token",
    }));

    expect(response.status).toBe(500);
    expect(mocks.deleteUser).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(mocks.updateUserById).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        user_metadata: {
          name: "Sample User",
          signup_consent_intent: null,
        },
      }),
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("fails closed without deleting an unvalidated provider user id", async () => {
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.generateLink.mockResolvedValueOnce({
      data: {
        properties: {
          action_link: "https://project.supabase.co/auth/v1/verify?type=signup&token=hashed_signup_token-1234&redirect_to=https%3A%2F%2Fhanbang.ai%2Fapi%2Fauth%2Fcallback",
        },
        user: { id: "not-a-uuid", app_metadata: {} },
      },
      error: null,
    });

    const response = await signup(mobileRequest("signup", {
      email: "sample@example.test",
      password: "Strong1!",
      name: "Sample User",
      ...CURRENT_REQUIRED_POLICY_ACCEPTANCE,
      turnstileToken: "verified-turnstile-token",
    }));

    expect(response.status).toBe(500);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    ["returns an error", "return-error"],
    ["throws", "throw"],
    ["returns no provider receipt", "empty-success"],
  ])("rolls back the generated user when Resend %s", async (_label, mode) => {
    const privateMarker = "private-bride@example.test";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    if (mode === "return-error") {
      mocks.send.mockResolvedValueOnce({ data: null, error: new Error(privateMarker) });
    } else if (mode === "throw") {
      mocks.send.mockRejectedValueOnce(new Error(privateMarker));
    } else {
      mocks.send.mockResolvedValueOnce({ data: null, error: null });
    }

    const response = await signup(mobileRequest("signup", {
      email: privateMarker,
      password: "Strong1!",
      name: "Sample User",
      ...CURRENT_REQUIRED_POLICY_ACCEPTANCE,
      turnstileToken: "verified-turnstile-token",
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "회원가입 처리 중 오류가 발생했습니다." });
    expect(mocks.deleteUser).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateMarker);
    consoleError.mockRestore();
  });

  it("fails closed and logs no private detail when generated-user rollback also fails", async () => {
    const privateMarker = "private-bride@example.test";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.send.mockResolvedValueOnce({ data: null, error: new Error(privateMarker) });
    mocks.deleteUser.mockResolvedValueOnce({
      data: null,
      error: new Error(`rollback-${privateMarker}`),
    });

    const response = await signup(mobileRequest("signup", {
      email: privateMarker,
      password: "Strong1!",
      name: "Sample User",
      ...CURRENT_REQUIRED_POLICY_ACCEPTANCE,
      turnstileToken: "verified-turnstile-token",
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "회원가입 처리 중 오류가 발생했습니다." });
    expect(mocks.deleteUser).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateMarker);
    expect(consoleError.mock.calls).toEqual(expect.arrayContaining([
      expect.arrayContaining(["Generated signup user rollback failed"]),
    ]));
    consoleError.mockRestore();
  });

  it("fails closed on an unapproved production signup origin", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://attacker.example");
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });

    const response = await signup(mobileRequest("signup", {
      email: "sample@example.test",
      password: "Strong1!",
      name: "Sample User",
      ...CURRENT_REQUIRED_POLICY_ACCEPTANCE,
      turnstileToken: "verified-turnstile-token",
    }));

    expect(response.status).toBe(500);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("stops signup abuse at the ingress bucket before parsing or Turnstile", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "limited" }), { status: 429 }),
    );

    const response = await signup(mobileRequest("signup", { malformed: true }));

    expect(response.status).toBe(429);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "signup:ingress:ip-key",
      { maxRequests: 20, windowMs: 10 * 60 * 1000 },
    );
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("masks recovery ingress limiting while skipping Turnstile and email work", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "limited" }), { status: 503 }),
    );

    const response = await forgotPassword(mobileRequest("forgot-password", { malformed: true }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "forgot:ingress:ip-key",
      { maxRequests: 20, windowMs: 10 * 60 * 1000 },
    );
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects an oversized signup body before bot verification or admin access", async () => {
    const response = await signup(new Request("https://hanbang.ai/api/auth/signup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(16 * 1024 + 1),
      },
      body: "{}",
    }));

    expect(response.status).toBe(413);
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("masks an oversized recovery body without verification or email generation", async () => {
    const response = await forgotPassword(new Request(
      "https://hanbang.ai/api/auth/forgot-password",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(8 * 1024 + 1),
        },
        body: "{}",
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
