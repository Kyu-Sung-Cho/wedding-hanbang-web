import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
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
    mocks.createServerClient.mockReturnValue(authenticatedClient());
  });

  it("returns an onboarded user to the requested internal price page", async () => {
    const response = await GET(new Request(
      "https://hanbang.ai/api/auth/callback?code=one-time-code&redirect=%2Fprice%2Fwishlist",
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/price/wishlist");
  });

  it("preserves the safe destination when OAuth returns without a code", async () => {
    const response = await GET(new Request(
      "https://hanbang.ai/api/auth/callback?redirect=%2Fprice%2Fwishlist",
    ));

    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/login?error=no_code&redirect=%2Fprice%2Fwishlist",
    );
  });

  it("redirects a failed session exchange with a stable error code", async () => {
    const rawProviderError = "database connection refused for project abc";
    const client = authenticatedClient();
    client.auth.exchangeCodeForSession.mockResolvedValueOnce({
      error: { message: rawProviderError },
    });
    mocks.createServerClient.mockReturnValue(client);

    const response = await GET(new Request(
      "https://hanbang.ai/api/auth/callback?code=one-time-code",
    ));
    const location = response.headers.get("location");

    expect(location).toBe(
      "https://hanbang.ai/login?error=oauth_session_exchange_failed",
    );
    expect(location).not.toContain(encodeURIComponent(rawProviderError));
  });

  it("redirects an unexpected callback exception with a stable error code", async () => {
    const rawConfigurationError =
      "@supabase/ssr: Your project's URL and API key are required";
    mocks.createServerClient.mockImplementationOnce(() => {
      throw new Error(rawConfigurationError);
    });

    const response = await GET(new Request(
      "https://hanbang.ai/api/auth/callback?code=one-time-code",
    ));
    const location = response.headers.get("location");

    expect(location).toBe(
      "https://hanbang.ai/login?error=oauth_callback_failed",
    );
    expect(location).not.toContain(encodeURIComponent(rawConfigurationError));
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
