import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateLink: vi.fn(),
  sendEmail: vi.fn(),
  verifyTurnstile: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { admin: { generateLink: mocks.generateLink } },
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
  rateLimitKey: vi.fn(() => "forgot:ip"),
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: mocks.verifyTurnstile,
  normalizeEmailForRateLimit: vi.fn((email: string) => email),
}));

import { POST } from "../route";

const GENERIC_MESSAGE =
  "요청을 확인했습니다. 해당 이메일로 재설정이 가능하면 안내가 도착합니다.";

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      email: "user@example.com",
      turnstileToken: "verified-token",
    }),
  });
}

describe("/api/auth/forgot-password POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.RESEND_API_KEY = "re_test";
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.generateLink.mockResolvedValue({
      data: { properties: { action_link: "https://auth.example.test/reset?a=1&b=2" } },
      error: null,
    });
    mocks.sendEmail.mockResolvedValue({ data: { id: "email-1" }, error: null });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("does not trust a spoofable mobile header to bypass Turnstile", async () => {
    mocks.verifyTurnstile.mockResolvedValue({ ok: false, skipped: false });

    const response = await POST(request({ "x-hanbang-client": "mobile" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("보안 확인");
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("returns the same neutral response whether link generation succeeds or the account is unavailable", async () => {
    const successResponse = await POST(request());
    const successBody = await successResponse.json();

    mocks.generateLink.mockResolvedValueOnce({
      data: null,
      error: { name: "AuthError", code: "user_not_found", status: 400 },
    });
    const unavailableResponse = await POST(request());
    const unavailableBody = await unavailableResponse.json();

    expect(successResponse.status).toBe(200);
    expect(unavailableResponse.status).toBe(200);
    expect(successBody).toEqual({ success: true, message: GENERIC_MESSAGE });
    expect(unavailableBody).toEqual(successBody);
    expect(GENERIC_MESSAGE).not.toContain("보냈습니다");
  });

  it("keeps delivery failure enumeration-safe and emits an operator-visible signal", async () => {
    mocks.sendEmail.mockResolvedValueOnce({
      data: null,
      error: { name: "ResendError", code: "provider_unavailable" },
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, message: GENERIC_MESSAGE });
    expect(console.error).toHaveBeenCalledWith(
      "AUTH_RECOVERY_EMAIL_DELIVERY_FAILED",
      expect.objectContaining({ severity: "error", code: "provider_unavailable" })
    );
  });

  it("keeps thrown email-client failures enumeration-safe", async () => {
    mocks.sendEmail.mockRejectedValueOnce(new Error("network unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: GENERIC_MESSAGE });
    expect(console.error).toHaveBeenCalledWith(
      "AUTH_RECOVERY_EMAIL_DELIVERY_FAILED",
      expect.objectContaining({ severity: "error", errorName: "Error" })
    );
  });
});
