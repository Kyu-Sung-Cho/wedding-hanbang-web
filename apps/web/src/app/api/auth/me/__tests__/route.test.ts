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
  const profileResults = [...options.profileResults];
  const profileQuery = {
    select: vi.fn(() => profileQuery),
    eq: vi.fn(() => profileQuery),
    maybeSingle: vi.fn(),
    update: vi.fn(() => profileQuery),
  };
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: USER } }),
    },
    from: vi.fn(() => profileQuery),
    rpc: vi.fn(async (name: string) => {
      if (name === "get_my_profile_safe") {
        return profileResults.shift() ?? { data: null, error: null };
      }
      if (name === "ensure_my_profile") {
        return { data: null, error: options.ensureError ?? null };
      }
      return { data: null, error: null };
    }),
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClientFromRequest>>
  );
  return client;
}

function mockLinkedSupabase(options: {
  couple?: { data: Record<string, unknown> | null; error: { message: string } | null };
  partner?: { data: Record<string, unknown>[] | null; error: { message: string } | null };
  journey?: { data: Record<string, unknown> | null; error: { message: string } | null };
  journeyInsert?: { data: Record<string, unknown> | null; error: { message: string } | null };
}) {
  const coupleResult = options.couple ?? {
    data: {
      id: "couple-1",
      bride_id: USER.id,
      groom_id: null,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    },
    error: null,
  };
  const journeyResult = options.journey ?? {
    data: { id: "journey-1", couple_id: "couple-1", progress: {} },
    error: null,
  };
  const insertedJourney = options.journeyInsert ?? {
    data: { id: "journey-created", couple_id: "couple-1", progress: {} },
    error: null,
  };

  const makeReadQuery = (result: typeof coupleResult) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      single: vi.fn(async () => result),
      maybeSingle: vi.fn(async () => result),
      insert: vi.fn(() => {
        const insertQuery = {
          select: vi.fn(() => insertQuery),
          single: vi.fn(async () => insertedJourney),
        };
        return insertQuery;
      }),
    };
    return query;
  };

  const coupleQuery = makeReadQuery(coupleResult);
  const journeyQuery = makeReadQuery(journeyResult);
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: USER } }),
    },
    from: vi.fn((table: string) => table === "couples" ? coupleQuery : journeyQuery),
    rpc: vi.fn(async (name: string) => {
      if (name === "get_my_profile_safe") {
        return {
          data: {
            id: USER.id,
            name: "사용자",
            role: "bride",
            couple_id: "couple-1",
            onboarding_completed: true,
            onboarding_step: 5,
            has_phone: false,
          },
          error: null,
        };
      }
      if (name === "get_my_partner_public") {
        return options.partner ?? { data: [], error: null };
      }
      return { data: null, error: null };
    }),
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClientFromRequest>>
  );
  return { client, coupleQuery, journeyQuery };
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
    expect(response.headers.get("cache-control")).toContain("no-store");
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
            email: "raw-profile-email@example.com",
            phone: "01012345678",
            phone_care_consented_at: "2026-07-01T00:00:00.000Z",
            is_admin: true,
            push_token: "ExponentPushToken[secret]",
            consents: { marketing: true },
            account_deleting_at: "2026-07-01T00:00:00.000Z",
            amora_membership_resetting_at: "2026-07-01T00:00:00.000Z",
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
    expect(body.profile).toEqual({
      id: USER.id,
      name: "사용자",
      role: null,
      couple_id: null,
      onboarding_completed: false,
      onboarding_step: 0,
      has_phone: true,
    });
  });

  it("never presents a journey read failure as an empty or newly created journey", async () => {
    const { journeyQuery } = mockLinkedSupabase({
      journey: { data: null, error: { message: "database unavailable" } },
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ code: "ACCOUNT_STATE_UNAVAILABLE" });
    expect(journeyQuery.insert).not.toHaveBeenCalled();
  });

  it("never presents a partner read failure as an unlinked account", async () => {
    mockLinkedSupabase({
      couple: {
        data: {
          id: "couple-1",
          bride_id: USER.id,
          groom_id: "partner-1",
          created_at: "2026-07-01T00:00:00.000Z",
          updated_at: "2026-07-01T00:00:00.000Z",
        },
        error: null,
      },
      partner: { data: null, error: { message: "rpc unavailable" } },
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ code: "ACCOUNT_STATE_UNAVAILABLE" });
  });

  it("never presents a linked-couple read failure as an unlinked account", async () => {
    mockLinkedSupabase({
      couple: { data: null, error: { message: "database unavailable" } },
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ code: "ACCOUNT_STATE_UNAVAILABLE" });
  });

  it("creates a genuinely missing journey and returns only the confirmed row", async () => {
    const { journeyQuery } = mockLinkedSupabase({
      journey: { data: null, error: null },
      journeyInsert: {
        data: { id: "journey-created", couple_id: "couple-1", progress: {} },
        error: null,
      },
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.journey).toMatchObject({
      id: "journey-created",
      couple_id: "couple-1",
    });
    expect(journeyQuery.insert).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a missing journey cannot be created durably", async () => {
    mockLinkedSupabase({
      journey: { data: null, error: null },
      journeyInsert: { data: null, error: { message: "insert failed" } },
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ code: "ACCOUNT_STATE_UNAVAILABLE" });
  });
});
