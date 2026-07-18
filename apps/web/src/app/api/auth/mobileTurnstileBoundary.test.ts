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
});
