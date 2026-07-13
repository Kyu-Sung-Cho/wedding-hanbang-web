import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClientFromRequest } from "@/lib/supabase/server";
import { GET } from "../route";

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: vi.fn(() => false),
}));

const USER = { id: "user-1", email: "user@example.com", user_metadata: {} };

function request() {
  return new Request("http://localhost/api/auth/me");
}

function mockSupabase(options: {
  profileResults: Array<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  ensureError?: { message: string } | null;
}) {
  const profileQuery = {
    select: vi.fn(() => profileQuery),
    eq: vi.fn(() => profileQuery),
    maybeSingle: vi.fn(),
    update: vi.fn(() => profileQuery),
  };
  for (const result of options.profileResults) {
    profileQuery.maybeSingle.mockResolvedValueOnce(result);
  }

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: USER } }),
    },
    from: vi.fn(() => profileQuery),
    rpc: vi.fn().mockResolvedValue({ data: null, error: options.ensureError ?? null }),
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClientFromRequest>>
  );
  return client;
}

describe("/api/auth/me GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("returns a retryable error instead of treating a profile lookup failure as incomplete onboarding", async () => {
    mockSupabase({
      profileResults: [{ data: null, error: { message: "database unavailable" } }],
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("3");
    expect(body).toMatchObject({
      code: "PROFILE_UNAVAILABLE",
      error: expect.stringContaining("다시 시도"),
    });
  });

  it("returns the same retryable error when a genuinely missing profile cannot be created", async () => {
    const client = mockSupabase({
      profileResults: [{ data: null, error: null }],
      ensureError: { message: "rpc unavailable" },
    });

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(client.rpc).toHaveBeenCalledWith("ensure_my_profile", {
      p_name: "user",
    });
  });

  it("continues onboarding only after a missing profile is successfully ensured and read back", async () => {
    mockSupabase({
      profileResults: [
        { data: null, error: null },
        {
          data: {
            id: USER.id,
            name: "사용자",
            couple_id: null,
            onboarding_completed: false,
          },
          error: null,
        },
      ],
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profile).toMatchObject({
      id: USER.id,
      onboarding_completed: false,
    });
  });
});
