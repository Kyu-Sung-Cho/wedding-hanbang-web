import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import {
  createResearchEmailVerificationToken,
  RESEARCH_EMAIL_VERIFICATION_TTL_SECONDS,
} from "@/lib/researchEmailVerification";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  updateResult: vi.fn(),
  lookupResult: vi.fn(),
  checkRateLimit: vi.fn(),
  checkRateLimitPersistentStrict: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  checkRateLimitPersistentStrict: mocks.checkRateLimitPersistentStrict,
}));

import { GET, POST } from "../route";

const APPLICATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const COHORT_CODE = "research-2026-h2";
const STRONG_SECRET = "R7vY0M5sK8qN2bF9xW4cL6jH1pT3dG5zA9uE";

function chainWithResult(result: ReturnType<typeof vi.fn>) {
  const chain = {
    eq: vi.fn(),
    gt: vi.fn(),
    is: vi.fn(),
    select: vi.fn(),
    maybeSingle: result,
  };
  chain.eq.mockReturnValue(chain);
  chain.gt.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  return chain;
}

function validToken(now = Date.now(), cohortCode = COHORT_CODE) {
  return createResearchEmailVerificationToken({
    applicationId: APPLICATION_ID,
    cohortCode,
  }, now)!;
}

function confirmationRequest(token: string, overrides: {
  origin?: string | null;
  fetchSite?: string | null;
  verificationHeader?: string | null;
  contentType?: string;
  body?: string;
  requestUrl?: string;
} = {}) {
  const headers = new Headers();
  const origin = overrides.origin === undefined ? "https://hanbang.ai" : overrides.origin;
  const fetchSite = overrides.fetchSite === undefined ? "same-origin" : overrides.fetchSite;
  const verificationHeader = overrides.verificationHeader === undefined
    ? "1"
    : overrides.verificationHeader;
  if (origin !== null) headers.set("origin", origin);
  if (fetchSite !== null) headers.set("sec-fetch-site", fetchSite);
  if (verificationHeader !== null) {
    headers.set("x-research-email-verification", verificationHeader);
  }
  headers.set("content-type", overrides.contentType ?? "application/json");

  return new NextRequest(
    overrides.requestUrl ?? "https://hanbang.ai/api/preregister/verify",
    {
      method: "POST",
      headers,
      body: overrides.body ?? JSON.stringify({ token }),
    }
  );
}

describe("/api/preregister/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RESEARCH_EMAIL_VERIFICATION_SECRET", STRONG_SECRET);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-for-route-tests");
    vi.stubEnv("RATE_LIMIT_KEY_SECRET", "another-distinct-rate-limit-secret-123456");

    const updateChain = chainWithResult(mocks.updateResult);
    const lookupChain = chainWithResult(mocks.lookupResult);
    mocks.update.mockReturnValue(updateChain);
    mocks.updateResult.mockResolvedValue({ data: { id: APPLICATION_ID }, error: null });
    mocks.lookupResult.mockResolvedValue({ data: null, error: null });
    mocks.from.mockReturnValue({
      update: mocks.update,
      select: vi.fn(() => lookupChain),
    });
    mocks.createClient.mockReturnValue({ from: mocks.from });
    mocks.checkRateLimit.mockReturnValue(null);
    mocks.checkRateLimitPersistentStrict.mockResolvedValue(null);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("keeps legacy GET requests mutation-free and removes their query token", async () => {
    const token = validToken();
    const response = await GET(new NextRequest(
      `https://hanbang.ai/api/preregister/verify?token=${encodeURIComponent(token)}`
    ));
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/beta/verify");
    expect(location.searchParams.get("status")).toBe("invalid");
    expect(response.headers.get("location")).not.toContain(token);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("confirms only through a same-origin JSON POST and never exposes the token in its response", async () => {
    const token = validToken();
    const response = await POST(confirmationRequest(token));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "verified" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.update).toHaveBeenCalledWith({
      email_verified_at: expect.any(String),
    });
    expect(mocks.from).toHaveBeenCalledWith("research_cohort_applications");

    const localKey = mocks.checkRateLimit.mock.calls[0]?.[0] as string;
    const persistentKey = mocks.checkRateLimitPersistentStrict.mock.calls[0]?.[0] as string;
    expect(localKey).toMatch(/^research-email-verification:[0-9a-f]{64}$/);
    expect(persistentKey).toBe(localKey);
    expect(localKey).not.toContain(token);
  });

  it("rejects tampered and expired capabilities before any limiter or database call", async () => {
    const token = validToken();
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    const expired = validToken(
      Date.now() - (RESEARCH_EMAIL_VERIFICATION_TTL_SECONDS + 1) * 1000
    );

    const tamperedResponse = await POST(confirmationRequest(tampered));
    const expiredResponse = await POST(confirmationRequest(expired));

    await expect(tamperedResponse.json()).resolves.toEqual({ status: "invalid" });
    await expect(expiredResponse.json()).resolves.toEqual({ status: "expired" });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("treats a replay as verified without replacing the original timestamp", async () => {
    mocks.updateResult.mockResolvedValueOnce({ data: null, error: null });
    mocks.lookupResult.mockResolvedValueOnce({
      data: { id: APPLICATION_ID, email_verified_at: "2026-07-12T03:00:00.000Z" },
      error: null,
    });

    const response = await POST(confirmationRequest(validToken()));

    await expect(response.json()).resolves.toEqual({ status: "verified" });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.lookupResult).toHaveBeenCalledTimes(1);
  });

  it("does not confirm a missing or application-level expired row", async () => {
    mocks.updateResult.mockResolvedValueOnce({ data: null, error: null });
    mocks.lookupResult.mockResolvedValueOnce({ data: null, error: null });

    const response = await POST(confirmationRequest(validToken()));

    await expect(response.json()).resolves.toEqual({ status: "invalid" });
  });

  it("rejects a signed capability for a different cohort before rate limiting", async () => {
    const response = await POST(confirmationRequest(validToken(Date.now(), "research-2026-h3")));

    await expect(response.json()).resolves.toEqual({ status: "invalid" });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    { origin: "https://attacker.example" },
    { verificationHeader: null },
    { fetchSite: "cross-site" },
  ])("rejects cross-site or non-client POSTs without consuming a capability", async (overrides) => {
    const response = await POST(confirmationRequest(validToken(), overrides));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ status: "invalid" });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("requires the exact canonical request origin in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(confirmationRequest(validToken(), {
      requestUrl: "https://hanbang.ai:444/api/preregister/verify",
      origin: "https://hanbang.ai:444",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ status: "invalid" });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("requires JSON and rejects a bounded oversized body before verification", async () => {
    const token = validToken();
    const wrongType = await POST(confirmationRequest(token, { contentType: "text/plain" }));
    const oversized = await POST(confirmationRequest(token, {
      body: JSON.stringify({ token: "x".repeat(3_000) }),
    }));

    expect(wrongType.status).toBe(415);
    expect(oversized.status).toBe(413);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("fails closed when the verification secret is missing", async () => {
    const token = validToken();
    vi.stubEnv("RESEARCH_EMAIL_VERIFICATION_SECRET", "");

    const response = await POST(confirmationRequest(token));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("blocks a replay bucket before querying the application table", async () => {
    mocks.checkRateLimit.mockReturnValueOnce(NextResponse.json(
      { error: "too many" },
      { status: 429, headers: { "Retry-After": "60" } }
    ));

    const response = await POST(confirmationRequest(validToken()));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
    expect(mocks.checkRateLimitPersistentStrict).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("fails closed when distributed replay protection is unavailable", async () => {
    mocks.checkRateLimitPersistentStrict.mockResolvedValueOnce(NextResponse.json(
      { code: "RATE_LIMIT_UNAVAILABLE" },
      { status: 503, headers: { "Retry-After": "5" } }
    ));

    const response = await POST(confirmationRequest(validToken()));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("returns only a generic unavailable state for an ambiguous storage failure", async () => {
    mocks.updateResult.mockResolvedValueOnce({
      data: null,
      error: { code: "storage_unavailable", message: "internal infrastructure detail" },
    });

    const response = await POST(confirmationRequest(validToken()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
    expect(console.error).toHaveBeenCalledWith("RESEARCH_EMAIL_VERIFICATION_UPDATE_FAILED");
  });
});
