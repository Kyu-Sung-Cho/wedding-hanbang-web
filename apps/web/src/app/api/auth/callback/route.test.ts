import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: vi.fn(() => []),
    set: vi.fn(),
  })),
}));

vi.mock("@/lib/demoSession", () => ({
  clearDemoCookies: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (scope: string) => `${scope}:test-ip`,
}));

import { GET } from "./route";

function authenticatedClient(onboardingCompleted = true) {
  return {
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { onboarding_completed: onboardingCompleted },
            error: null,
          }),
        })),
      })),
    })),
  };
}

describe("OAuth callback post-login destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.createServerClient.mockReturnValue(authenticatedClient());
  });

  it("returns an onboarded user to the requested internal price page", async () => {
    const response = await GET(new Request(
      "https://hanbang.ai/api/auth/callback?code=one-time-code&redirect=%2Fprice%2Fwishlist",
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/price/wishlist");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0, must-revalidate",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("preserves the safe destination when OAuth returns without a code", async () => {
    const response = await GET(new Request(
      "https://hanbang.ai/api/auth/callback?redirect=%2Fprice%2Fwishlist",
    ));

    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/login?error=no_code&redirect=%2Fprice%2Fwishlist",
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0, must-revalidate",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("stops repeated provider exchanges at a persistent ingress bucket", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "limited" }), { status: 429 }),
    );

    const response = await GET(new Request(
      "https://hanbang.ai/api/auth/callback?code=one-time-code&redirect=%2Fprice%2Fwishlist",
    ));

    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/login?error=rate_limited&redirect=%2Fprice%2Fwishlist",
    );
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("never reflects or logs a provider error message", async () => {
    const privateMarker = "bride@example.com access_token=provider-secret-marker";
    const client = authenticatedClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({
      error: {
        name: "AuthApiError",
        code: "bad_oauth_state",
        status: 400,
        message: privateMarker,
        details: { accessToken: "provider-secret-marker" },
      },
    });
    mocks.createServerClient.mockReturnValue(client);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(new Request(
      "https://hanbang.ai/api/auth/callback?code=one-time-code&redirect=%2Fprice%2Fwishlist",
    ));

    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/login?error=session_exchange_failed&redirect=%2Fprice%2Fwishlist",
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(privateMarker);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("provider-secret-marker");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(String),
      { name: "AuthApiError", code: "unknown", status: 400 },
    );
  });

  it("uses a fixed callback failure code for unexpected exceptions", async () => {
    const privateMarker = "unexpected-private-wedding-plan";
    mocks.createServerClient.mockImplementation(() => {
      throw new Error(privateMarker);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(new Request(
      "https://hanbang.ai/api/auth/callback?code=one-time-code",
    ));

    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/login?error=callback_failed",
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(privateMarker);
  });

  it.each([
    "https%3A%2F%2Fattacker.example%2Fsteal",
    "%2F%2Fattacker.example%2Fsteal",
    "%2F%5Cattacker.example%2Fsteal",
  ])("never redirects to an external destination: %s", async (redirect) => {
    const response = await GET(new Request(
      `https://hanbang.ai/api/auth/callback?code=one-time-code&redirect=${redirect}`,
    ));

    expect(response.headers.get("location")).toBe("https://hanbang.ai/wedding/lounge");
  });

  it("does not reflect a rejected destination into the login error URL", async () => {
    const response = await GET(new Request(
      "https://hanbang.ai/api/auth/callback?redirect=%2F%2Fattacker.example%2Fsteal",
    ));

    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/login?error=no_code",
    );
  });

  it("keeps onboarding ahead of the requested destination", async () => {
    mocks.createServerClient.mockReturnValue(authenticatedClient(false));
    const response = await GET(new Request(
      "https://hanbang.ai/api/auth/callback?code=one-time-code&redirect=%2Fprice%2Fwishlist",
    ));

    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/wedding/onboarding?redirect=%2Fprice%2Fwishlist",
    );
  });

  it.each([
    "https%3A%2F%2Fattacker.example%2Fsteal",
    "%2Fprice%2F%25252F%25252Fattacker.example",
    "%2Fsafe%2F%252e%252e%2F%2Fattacker.example",
  ])("does not carry an unsafe destination into onboarding: %s", async (redirect) => {
    mocks.createServerClient.mockReturnValue(authenticatedClient(false));
    const response = await GET(new Request(
      `https://hanbang.ai/api/auth/callback?code=one-time-code&redirect=${redirect}`,
    ));

    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/wedding/onboarding",
    );
  });

  it("does not change the demo callback's onboarding destination", async () => {
    mocks.createServerClient.mockReturnValue(authenticatedClient(false));
    const response = await GET(new Request(
      "https://hanbang.ai/api/auth/callback?code=one-time-code&from=demo&redirect=%2Fprice%2Fwishlist",
    ));

    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/wedding/onboarding",
    );
  });

  it("does not change the completed demo callback destination", async () => {
    const response = await GET(new Request(
      "https://hanbang.ai/api/auth/callback?code=one-time-code&from=demo&redirect=%2Fprice%2Fwishlist",
    ));

    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/wedding/lounge",
    );
  });
});
