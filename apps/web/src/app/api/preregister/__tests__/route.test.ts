import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  purgeExpired: vi.fn(),
  lookupExisting: vi.fn(),
  insertApplication: vi.fn(),
  insertResult: vi.fn(),
  updateApplication: vi.fn(),
  updateReceiptStatus: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  verifyTurnstile: vi.fn(),
  normalizeEmailForRateLimit: vi.fn((email: string) => email),
  sendReceipt: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  getClientIp: vi.fn(() => "203.0.113.10"),
  rateLimitKey: vi.fn(() => "preregister:ip"),
}));
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: mocks.verifyTurnstile,
  normalizeEmailForRateLimit: mocks.normalizeEmailForRateLimit,
}));
vi.mock("@/lib/resend", () => ({
  sendResearchCohortReceiptEmail: mocks.sendReceipt,
}));

import { POST } from "../route";

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/preregister", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "couple@example.com",
      role: "bride",
      isBetaCandidate: true,
      privacyConsent: true,
      turnstileToken: "verified-token",
      ...overrides,
    }),
  });
}

describe("/api/preregister POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RESEND_API_KEY", "re_test_only");
    vi.stubEnv(
      "RESEARCH_EMAIL_VERIFICATION_SECRET",
      "0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.normalizeEmailForRateLimit.mockImplementation((email: string) => email);
    mocks.purgeExpired.mockResolvedValue({ error: null });
    mocks.lookupExisting.mockResolvedValue({ data: null, error: null });
    mocks.insertResult.mockResolvedValue({ data: { id: "new-application" }, error: null });
    mocks.insertApplication.mockReturnValue({
      select: vi.fn(() => ({ single: mocks.insertResult })),
    });
    mocks.updateReceiptStatus.mockResolvedValue({ error: null });
    mocks.updateApplication.mockReturnValue({ eq: mocks.updateReceiptStatus });
    mocks.sendReceipt.mockResolvedValue(true);
    const lookupChain = {
      eq: vi.fn(),
      gt: vi.fn(),
      maybeSingle: mocks.lookupExisting,
    };
    lookupChain.eq.mockReturnValue(lookupChain);
    lookupChain.gt.mockReturnValue(lookupChain);
    mocks.createClient.mockReturnValue({
      from: vi.fn(() => ({
        delete: vi.fn(() => ({ lte: mocks.purgeExpired })),
        select: vi.fn(() => lookupChain),
        insert: mocks.insertApplication,
        update: mocks.updateApplication,
      })),
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("fails before parsing or persistence while the production intake switch is closed", async () => {
    vi.stubEnv("RESEARCH_COHORT_APPLICATIONS_ENABLED", "false");

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({ code: "RESEARCH_INTAKE_CLOSED" });
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects a generic waitlist payload that was not disclosed by the research form", async () => {
    const response = await POST(request({ isBetaCandidate: false }));
    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects an objectively ineligible wedding date even when the checkbox is asserted", async () => {
    const response = await POST(request({ weddingDate: "2027-01-01" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.stringContaining("2026년 7~12월"),
    }));
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("does not let an unverified bot consume another address's daily bucket", async () => {
    mocks.verifyTurnstile.mockResolvedValueOnce({ ok: false, skipped: false });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.verifyTurnstile).toHaveBeenCalledWith(
      "verified-token",
      "203.0.113.10",
      "preregister"
    );
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(1);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "preregister:ip",
      expect.any(Object)
    );
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalledWith(
      expect.stringContaining("preregister-email:"),
      expect.any(Object)
    );
  });

  it("fails before persistence when the verification boundary is not configured", async () => {
    vi.stubEnv("RESEARCH_EMAIL_VERIFICATION_SECRET", "");

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(1);
  });

  it("waits for the receipt attempt after a durable application insert", async () => {
    let finishReceipt!: (delivered: boolean) => void;
    mocks.sendReceipt.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      finishReceipt = resolve;
    }));

    let settled = false;
    const responsePromise = POST(request()).then((response) => {
      settled = true;
      return response;
    });
    await vi.waitFor(() => expect(mocks.sendReceipt).toHaveBeenCalledWith(
      "couple@example.com",
      "new-application",
      "research-2026-h2"
    ));
    expect(mocks.insertApplication).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    finishReceipt(false);
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      verificationEmailSent: false,
    });
    expect(mocks.updateApplication).toHaveBeenCalledWith(expect.objectContaining({
      receipt_email_status: "failed",
      receipt_email_attempted_at: expect.any(String),
    }));
    expect(mocks.updateReceiptStatus).toHaveBeenCalledWith("id", "new-application");
    expect(console.error).toHaveBeenCalledWith("RESEARCH_COHORT_RECEIPT_EMAIL_PENDING");
  });

  it("does not send a receipt when the application insert fails", async () => {
    mocks.insertResult.mockResolvedValueOnce({ data: null, error: { code: "storage_unavailable" } });
    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mocks.sendReceipt).not.toHaveBeenCalled();
  });

  it("records a successful receipt delivery without exposing application state", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, verificationEmailSent: true });
    expect(mocks.updateApplication).toHaveBeenCalledWith(expect.objectContaining({
      receipt_email_status: "sent",
      receipt_email_attempted_at: expect.any(String),
    }));
    expect(mocks.updateReceiptStatus).toHaveBeenCalledWith("id", "new-application");
    const insertedPayload = mocks.insertApplication.mock.calls[0]?.[0];
    expect(insertedPayload.created_at).toBe(insertedPayload.privacy_consent_at);
  });

  it("preserves a legitimate email alias for identity and delivery while canonicalizing only its rate bucket", async () => {
    mocks.normalizeEmailForRateLimit.mockReturnValueOnce("couple@example.com");

    const response = await POST(request({ email: "Couple+research@example.com" }));

    expect(response.status).toBe(200);
    expect(mocks.normalizeEmailForRateLimit).toHaveBeenCalledWith(
      "couple+research@example.com"
    );
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "preregister-email:couple@example.com",
      expect.any(Object)
    );
    expect(mocks.insertApplication).toHaveBeenCalledWith(
      expect.objectContaining({ email: "couple+research@example.com" })
    );
    expect(mocks.sendReceipt).toHaveBeenCalledWith(
      "couple+research@example.com",
      "new-application",
      "research-2026-h2"
    );
  });

  it("keeps a durable application successful when receipt status persistence fails", async () => {
    mocks.updateReceiptStatus.mockResolvedValueOnce({ error: { code: "storage_unavailable" } });
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, verificationEmailSent: true });
    expect(console.error).toHaveBeenCalledWith(
      "RESEARCH_COHORT_RECEIPT_STATUS_UPDATE_FAILED"
    );
  });

  it("fails closed when a successful insert does not return its durable id", async () => {
    mocks.insertResult.mockResolvedValueOnce({ data: {}, error: null });
    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.sendReceipt).not.toHaveBeenCalled();
    expect(mocks.updateApplication).not.toHaveBeenCalled();
  });

  it("treats an exact concurrent cohort row as the same neutral success", async () => {
    mocks.lookupExisting
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: "concurrent" }, error: null });
    mocks.insertResult.mockResolvedValueOnce({ data: null, error: { code: "23505" } });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, verificationEmailSent: true });
    expect(mocks.lookupExisting).toHaveBeenCalledTimes(2);
    expect(mocks.sendReceipt).toHaveBeenCalledWith(
      "couple@example.com",
      "concurrent",
      "research-2026-h2"
    );
  });

  it("does not disguise an unrelated unique violation as an existing application", async () => {
    mocks.lookupExisting
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    mocks.insertResult.mockResolvedValueOnce({ data: null, error: { code: "23505" } });

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mocks.sendReceipt).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("RESEARCH_COHORT_INSERT_FAILED");
  });

  it("fails closed when the post-conflict identity lookup cannot be verified", async () => {
    mocks.lookupExisting
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "storage_unavailable" } });
    mocks.insertResult.mockResolvedValueOnce({ data: null, error: { code: "23505" } });

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mocks.sendReceipt).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "RESEARCH_COHORT_CONCURRENT_LOOKUP_FAILED"
    );
  });

  it("keeps an existing-address response neutral while issuing a fresh verification link", async () => {
    mocks.lookupExisting.mockResolvedValueOnce({ data: { id: "existing" }, error: null });
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, verificationEmailSent: true });
    expect(mocks.insertApplication).not.toHaveBeenCalled();
    expect(mocks.sendReceipt).toHaveBeenCalledWith(
      "couple@example.com",
      "existing",
      "research-2026-h2"
    );
    expect(mocks.updateReceiptStatus).toHaveBeenCalledWith("id", "existing");
  });
});
