import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn(),
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
  sendPreregistrationConfirmationEmail: vi.fn(),
  verifyTurnstile: vi.fn(),
  encryptPayload: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  getClientIp: () => "203.0.113.5",
  rateLimitKey: (prefix: string) => `${prefix}:ip-key`,
  rateLimitSubjectKey: (_prefix: string, subject: string) => `preregister-email:${subject}`,
}));

vi.mock("@/lib/turnstile", () => ({
  normalizeEmailForRateLimit: (value: string) => value.trim().toLowerCase(),
  verifyTurnstile: mocks.verifyTurnstile,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/resend", () => ({
  sendPreregistrationConfirmationEmail: mocks.sendPreregistrationConfirmationEmail,
}));

vi.mock("@/lib/preregistration/preregistrationIntent", () => ({
  PREREGISTRATION_INTENT_RPC: "issue_preregistration_intent",
  REVOKE_PREREGISTRATION_INTENT_RPC: "revoke_preregistration_intent",
  createPreregistrationIntentToken: () => "A".repeat(43),
  digestPreregistrationIntentToken: () => "a".repeat(64),
  digestPreregistrationEmail: () => "b".repeat(64),
  encryptPreregistrationPayload: mocks.encryptPayload,
  buildPreregistrationConfirmationLink: () =>
    `https://hanbang.ai/preregister/confirm#token=${"A".repeat(43)}`,
}));

import { POST } from "./route";

function preregisterRequest(
  email = "person@example.com",
  overrides: Record<string, unknown> = {},
) {
  return new NextRequest("https://hanbang.ai/api/preregister", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      name: "신청자 이름",
      role: "bride",
      isBetaCandidate: true,
      turnstileToken: "captcha-token",
      privacyAgreed: true,
      privacyVersion: "2026-08-02",
      ...overrides,
    }),
  });
}

function oversizedChunkedRequest(maxBytes: number) {
  let pullCount = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount += 1;
      if (pullCount === 1) controller.enqueue(new Uint8Array(maxBytes));
      else if (pullCount === 2) controller.enqueue(new Uint8Array([1]));
      else controller.enqueue(new Uint8Array(1_000_000));
    },
  }, { highWaterMark: 0 });

  return {
    url: "https://hanbang.ai/api/preregister",
    headers: new Headers({ "content-type": "application/json" }),
    body,
  } as unknown as NextRequest;
}

describe("public preregistration double-opt-in boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.encryptPayload.mockReturnValue(
      `v1.${"I".repeat(16)}.${"T".repeat(22)}.${"C".repeat(32)}`,
    );
    mocks.sendPreregistrationConfirmationEmail.mockResolvedValue(true);
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "issue_preregistration_intent") return { data: true, error: null };
      if (name === "revoke_preregistration_intent") return { data: true, error: null };
      return { data: null, error: new Error("unexpected RPC") };
    });
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
  });

  it("requires exact, current, affirmative privacy consent before CAPTCHA or storage", async () => {
    for (const overrides of [
      { privacyAgreed: false },
      { privacyVersion: "2026-07-01" },
      { privacyAgreed: undefined },
    ]) {
      const response = await POST(preregisterRequest("person@example.com", overrides));
      expect(response.status).toBe(400);
    }
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("does not consume the email-specific limit before CAPTCHA succeeds", async () => {
    mocks.verifyTurnstile.mockResolvedValue({ ok: false, skipped: false });

    const response = await POST(preregisterRequest());

    expect(response.status).toBe(400);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(1);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "preregister:ingress:ip-key",
      expect.any(Object),
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects an oversized chunked body without Content-Length before CAPTCHA or storage", async () => {
    const request = oversizedChunkedRequest(16 * 1024);
    expect(request.headers.get("content-length")).toBeNull();

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("stores an encrypted pending intent and sends a fragment confirmation link, not a final row", async () => {
    const response = await POST(preregisterRequest("new@example.com"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.verifyTurnstile).toHaveBeenCalledWith(
      "captcha-token",
      "203.0.113.5",
      "preregister",
      "hanbang.ai",
    );
    expect(mocks.rpc).toHaveBeenCalledWith("issue_preregistration_intent", {
      p_token_digest_hex: "a".repeat(64),
      p_email_lookup_digest_hex: "b".repeat(64),
      p_payload_envelope: expect.stringMatching(/^v1\./u),
      p_privacy_version: "2026-08-02",
      p_consent_confirmed: true,
    });
    expect(mocks.sendPreregistrationConfirmationEmail).toHaveBeenCalledWith(
      "new@example.com",
      `https://hanbang.ai/preregister/confirm#token=${"A".repeat(43)}`,
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      expect.stringContaining("insert"),
      expect.anything(),
    );
  });

  it("drops PII- and credential-shaped attribution before encryption", async () => {
    const response = await POST(preregisterRequest("new@example.com", {
      utmSource: "person@example.com",
      utmMedium: "social",
      utmCampaign: "sk_live_1234567890",
    }));

    expect(response.status).toBe(202);
    expect(mocks.encryptPayload).toHaveBeenCalledWith(expect.objectContaining({
      email: "new@example.com",
      utmSource: null,
      utmMedium: "social",
      utmCampaign: null,
      privacyVersion: "2026-08-02",
    }));
  });

  it("revokes the newly issued intent and fails closed when delivery is ambiguous", async () => {
    mocks.sendPreregistrationConfirmationEmail.mockResolvedValue(false);

    const response = await POST(preregisterRequest());

    expect(response.status).toBe(503);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "issue_preregistration_intent", expect.any(Object));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "revoke_preregistration_intent", {
      p_token_digest_hex: "a".repeat(64),
    });
  });

  it("never sends an email when atomic issuance fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "57014" } });

    const response = await POST(preregisterRequest());

    expect(response.status).toBe(503);
    expect(mocks.sendPreregistrationConfirmationEmail).not.toHaveBeenCalled();
  });
});
