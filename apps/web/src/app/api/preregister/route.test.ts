import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn(),
  createAdminClient: vi.fn(),
  verifyTurnstile: vi.fn(),
  isTrustedMutationRequest: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  getClientIp: () => "203.0.113.1",
  rateLimitKey: () => "preregister:ip",
  rateLimitSubjectKey: () => "preregister:email",
}));

vi.mock("@/lib/turnstile", () => ({
  normalizeEmailForRateLimit: (value: string) => value.toLowerCase(),
  verifyTurnstile: mocks.verifyTurnstile,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: mocks.isTrustedMutationRequest,
}));

import { POST } from "./route";

function request(body: string) {
  return new NextRequest("https://hanbang.ai/api/preregister", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://hanbang.ai",
    },
    body,
  });
}

describe("POST /api/preregister request boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTrustedMutationRequest.mockReturnValue(true);
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.verifyTurnstile.mockResolvedValue({ ok: false, skipped: false });
  });

  it("rejects a streamed oversized body without Content-Length", async () => {
    const oversized = request(JSON.stringify({ padding: "x".repeat(17 * 1024) }));
    expect(oversized.headers.get("content-length")).toBeNull();

    const response = await POST(oversized);

    expect(response.status).toBe(413);
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed on malformed JSON", async () => {
    const response = await POST(request("{"));

    expect(response.status).toBe(400);
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects an untrusted mutation before rate limiting or reading service state", async () => {
    mocks.isTrustedMutationRequest.mockReturnValue(false);

    const response = await POST(request(JSON.stringify({ email: "sample@example.test" })));

    expect(response.status).toBe(403);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("checks the IP budget before Turnstile and defers the email budget until proof succeeds", async () => {
    const response = await POST(request(JSON.stringify({
      email: "sample@example.test",
      turnstileToken: "invalid-proof",
    })));

    expect(response.status).toBe(400);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(1);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "preregister:ip",
      { maxRequests: 10, windowMs: 60 * 60 * 1000 },
    );
    expect(mocks.checkRateLimitPersistent.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.verifyTurnstile.mock.invocationCallOrder[0]);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
