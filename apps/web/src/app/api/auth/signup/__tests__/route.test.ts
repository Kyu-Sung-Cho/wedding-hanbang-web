import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateLink: vi.fn(),
  deleteUser: vi.fn(),
  sendEmail: vi.fn(),
  verifyTurnstile: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      admin: {
        generateLink: mocks.generateLink,
        deleteUser: mocks.deleteUser,
      },
    },
  })),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.sendEmail };
  },
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  getClientIp: vi.fn(() => "203.0.113.5"),
  rateLimitKey: vi.fn(() => "signup:ip"),
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: mocks.verifyTurnstile,
  normalizeEmailForRateLimit: vi.fn((email: string) => email),
}));

import { POST } from "../route";
import {
  SIGNUP_PRIVACY_VERSION,
  SIGNUP_TERMS_VERSION,
} from "@/lib/auth/signupConsent";

const GENERIC_MESSAGE =
  "요청을 확인했습니다. 가입 가능한 이메일이면 인증 안내가 도착합니다. 받지 못했다면 잠시 후 다시 시도해주세요.";

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      email: "user@example.com",
      password: "Strong1!",
      name: "홍길동",
      turnstileToken: "verified-token",
      termsVersion: SIGNUP_TERMS_VERSION,
      privacyVersion: SIGNUP_PRIVACY_VERSION,
    }),
  });
}

function streamedJsonRequest(payload: unknown, chunkSize = 1024) {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < encoded.byteLength; offset += chunkSize) {
        controller.enqueue(encoded.slice(offset, offset + chunkSize));
      }
      controller.close();
    },
  });

  return new Request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function successfulLink() {
  return {
    data: {
      user: { id: "new-user" },
      properties: { action_link: "https://auth.example.test/confirm?a=1&b=2" },
    },
    error: null,
  };
}

describe("/api/auth/signup POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.RESEND_API_KEY = "re_test";
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.generateLink.mockResolvedValue(successfulLink());
    mocks.deleteUser.mockResolvedValue({ error: null });
    mocks.sendEmail.mockResolvedValue({ data: { id: "email-1" }, error: null });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects a chunked oversized body without trusting Content-Length", async () => {
    const response = await POST(streamedJsonRequest({
      email: "user@example.com",
      password: "Strong1!",
      name: "사용자",
      turnstileToken: "x".repeat(20 * 1024),
    }));

    expect(response.status).toBe(413);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("fails before the Turnstile provider when the persistent limiter denies the request", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "rate limited" }), { status: 429 })
    );

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("does not trust a spoofable mobile header to bypass Turnstile", async () => {
    mocks.verifyTurnstile.mockResolvedValue({ ok: false, skipped: false });

    const response = await POST(request({ "x-hanbang-client": "mobile" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("보안 확인");
    expect(mocks.verifyTurnstile).toHaveBeenCalledWith(
      "verified-token",
      "203.0.113.5",
      "signup"
    );
    expect(
      mocks.checkRateLimitPersistent.mock.calls.map(([key]) => key)
    ).toEqual(["signup:ip"]);
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("returns the same neutral response for a successful signup and an existing account", async () => {
    const successResponse = await POST(request());
    const successBody = await successResponse.json();

    mocks.generateLink.mockResolvedValueOnce({
      data: null,
      error: { message: "A user with this email already exists", code: "email_exists", status: 422 },
    });
    const existingResponse = await POST(request());
    const existingBody = await existingResponse.json();

    expect(successResponse.status).toBe(200);
    expect(existingResponse.status).toBe(200);
    expect(successBody).toEqual({ success: true, message: GENERIC_MESSAGE });
    expect(existingBody).toEqual(successBody);
    expect(GENERIC_MESSAGE).not.toContain("발송했습니다");
  });

  it("deletes the just-created auth user when custom email delivery fails", async () => {
    mocks.sendEmail.mockResolvedValueOnce({
      data: null,
      error: { name: "ResendError", code: "provider_unavailable" },
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, message: GENERIC_MESSAGE });
    expect(mocks.deleteUser).toHaveBeenCalledWith("new-user");
  });

  it("also compensates when the email client throws", async () => {
    mocks.sendEmail.mockRejectedValueOnce(new Error("network unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.deleteUser).toHaveBeenCalledWith("new-user");
  });

  it("logs a critical operator signal without changing the external response when cleanup fails", async () => {
    mocks.sendEmail.mockResolvedValueOnce({
      data: null,
      error: { name: "ResendError", code: "provider_unavailable" },
    });
    mocks.deleteUser.mockResolvedValueOnce({
      error: { name: "AuthError", code: "delete_failed" },
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, message: GENERIC_MESSAGE });
    expect(console.error).toHaveBeenCalledWith(
      "AUTH_SIGNUP_COMPENSATION_FAILED",
      expect.objectContaining({
        severity: "critical",
        userId: "new-user",
        reason: "email_delivery_failed",
      })
    );
  });

  it("compensates when generateLink creates a user but omits the action link", async () => {
    mocks.generateLink.mockResolvedValueOnce({
      data: { user: { id: "new-user" }, properties: {} },
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.deleteUser).toHaveBeenCalledWith("new-user");
  });
});
