import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServerClient } from "@supabase/ssr";
import { GET } from "../route";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
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

function mockSupabase(profileResult: {
  data: { onboarding_completed: boolean } | null;
  error: { message: string } | null;
}) {
  const profileQuery = {
    select: vi.fn(() => profileQuery),
    eq: vi.fn(() => profileQuery),
    maybeSingle: vi.fn().mockResolvedValue(profileResult),
  };
  vi.mocked(createServerClient).mockReturnValue({
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
      }),
    },
    from: vi.fn(() => profileQuery),
  } as unknown as ReturnType<typeof createServerClient>);
}

describe("/api/auth/callback GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("routes a transient profile lookup failure to the retry screen, not onboarding", async () => {
    mockSupabase({ data: null, error: { message: "database unavailable" } });
    const next = "/wedding/community/post/post-123#comments";

    const response = await GET(
      new Request(
        `http://localhost/api/auth/callback?code=oauth-code&next=${encodeURIComponent(next)}`
      )
    );
    const location = response.headers.get("location");

    expect(response.status).toBe(307);
    expect(location).toBe(
      `http://localhost/wedding/onboarding?error=profile_unavailable&next=${encodeURIComponent(next)}`
    );
  });

  it("uses ordinary onboarding only when the profile is genuinely absent", async () => {
    mockSupabase({ data: null, error: null });

    const response = await GET(
      new Request("http://localhost/api/auth/callback?code=oauth-code&next=%2Fwedding%2Flounge")
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost/wedding/onboarding?next=%2Fwedding%2Flounge"
    );
  });
});
