import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: vi.fn(() => false),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn((scope: string, _request: Request, actorId: string) =>
    `${scope}:${actorId}`),
}));

describe("/api/auth/me GET guest probe", () => {
  function expectPrivateResponse(response: Response) {
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("Vary")).toBe("Origin, Sec-Fetch-Site, Authorization");
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasSignedDemoSessionFromCookieHeader).mockReturnValue(false);
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as never);
  });

  it("keeps the normal endpoint authentication-required", async () => {
    const response = await GET(new Request("http://localhost/api/auth/me"));

    expect(response.status).toBe(401);
    expectPrivateResponse(response);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns a cache-disabled anonymous result for the exact guest probe", async () => {
    const response = await GET(
      new Request("http://localhost/api/auth/me?guest_probe=1"),
    );

    expect(response.status).toBe(200);
    expectPrivateResponse(response);
    expect(await response.json()).toEqual({ user: null });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("does not enable the probe for a truthy-looking alternative value", async () => {
    const response = await GET(
      new Request("http://localhost/api/auth/me?guest_probe=true"),
    );

    expect(response.status).toBe(401);
    expectPrivateResponse(response);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects bootstrap mutation without same-origin or Bearer proof", async () => {
    const response = await POST(new Request("https://hanbang.ai/api/auth/me", {
      method: "POST",
    }));

    expect(response.status).toBe(403);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expectPrivateResponse(response);
  });

  it("allows a Bearer-authenticated native bootstrap to reach authentication", async () => {
    const response = await POST(new Request("https://hanbang.ai/api/auth/me", {
      method: "POST",
      headers: { Authorization: "Bearer native-session-token" },
    }));

    expect(response.status).toBe(401);
    expectPrivateResponse(response);
    expect(createClientFromRequest).toHaveBeenCalledOnce();
  });

  it("rate-limits authenticated reads in the shared store before service queries", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "user@example.com" } },
        }),
      },
    } as never);
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(
      new Response(JSON.stringify({ error: "limited" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }) as never,
    );

    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));

    expect(response.status).toBe(429);
    expectPrivateResponse(response);
    expect(rateLimitKey).toHaveBeenCalledWith(
      "auth:me:read",
      expect.any(Request),
      "user-1",
    );
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "auth:me:read:user-1",
      { maxRequests: 120, windowMs: 60 * 1000 },
      { failClosed: true },
    );
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed when the bootstrap limiter store is unavailable", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "user@example.com" } },
        }),
      },
    } as never);
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(
      new Response(JSON.stringify({ error: "limiter unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }) as never,
    );

    const response = await POST(new Request("https://hanbang.ai/api/auth/me", {
      method: "POST",
      headers: { Authorization: "Bearer native-session-token" },
    }));

    expect(response.status).toBe(503);
    expectPrivateResponse(response);
    expect(rateLimitKey).toHaveBeenCalledWith(
      "auth:me:bootstrap",
      expect.any(Request),
      "user-1",
    );
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "auth:me:bootstrap:user-1",
      { maxRequests: 20, windowMs: 10 * 60 * 1000 },
      { failClosed: true },
    );
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("keeps GET read-only when an authenticated profile has missing defaults", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn(),
      update: vi.fn(),
      insert: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.single.mockResolvedValue({
      data: {
        id: "user-1",
        name: "",
        email: "user@example.com",
        couple_id: null,
      },
      error: null,
    });
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "user-1",
              email: "user@example.com",
              user_metadata: { name: "Default Name" },
            },
          },
        }),
      },
    } as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => query),
    } as never);

    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));

    expect(response.status).toBe(200);
    expectPrivateResponse(response);
    expect(query.update).not.toHaveBeenCalled();
    expect(query.insert).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      user: { id: "user-1" },
      profile: { name: "" },
      journey: null,
    });
  });

  it("bootstraps a missing journey through the service client after authenticated reads", async () => {
    function singleQuery(data: unknown) {
      const query = {
        select: vi.fn(),
        eq: vi.fn(),
        single: vi.fn().mockResolvedValue({ data, error: null }),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      return query;
    }

    const profileQuery = singleQuery({
      id: "user-1",
      name: "Alice",
      role: "bride",
      couple_id: "couple-1",
      avatar_url: null,
      onboarding_completed: true,
      onboarding_step: 5,
      care_notifications_enabled: false,
      care_notifications_consented_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    });
    const coupleQuery = singleQuery({
      id: "couple-1",
      bride_id: "user-1",
      groom_id: null,
    });
    const journeyRead = singleQuery(null);
    const insertedJourney = {
      id: "journey-1",
      couple_id: "couple-1",
      wedding_date: null,
      venue: null,
      total_budget: 20_000_000,
      progress: {},
    };
    const journeyInsertSingle = vi.fn().mockResolvedValue({
      data: insertedJourney,
      error: null,
    });
    const journeyInsertSelect = vi.fn(() => ({ single: journeyInsertSingle }));
    const journeyInsert = vi.fn(() => ({ select: journeyInsertSelect }));
    const authenticatedFrom = vi.fn((table: string) => {
      if (table === "couples") return coupleQuery;
      if (table === "wedding_journeys") return journeyRead;
      throw new Error(`unexpected authenticated table: ${table}`);
    });
    const serviceFrom = vi.fn((table: string) => {
      if (table === "profiles") return profileQuery;
      if (table === "wedding_journeys") return { insert: journeyInsert };
      throw new Error(`unexpected service table: ${table}`);
    });

    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "alice@example.com" } },
        }),
      },
      from: authenticatedFrom,
    } as never);
    vi.mocked(createAdminClient).mockReturnValue({ from: serviceFrom } as never);

    const response = await POST(new Request("https://hanbang.ai/api/auth/me", {
      method: "POST",
      headers: { Authorization: "Bearer native-session-token" },
    }));

    expect(response.status).toBe(200);
    expect(authenticatedFrom).toHaveBeenCalledWith("wedding_journeys");
    expect(journeyRead).not.toHaveProperty("insert");
    expect(serviceFrom).toHaveBeenCalledWith("wedding_journeys");
    expect(journeyInsert).toHaveBeenCalledWith({
      couple_id: "couple-1",
      wedding_date: null,
      venue: null,
      total_budget: 20_000_000,
      progress: {},
    });
    await expect(response.json()).resolves.toMatchObject({
      journey: insertedJourney,
    });
  });

  it("returns only the explicit owner-facing profile projection", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.single.mockResolvedValue({
      data: {
        id: "user-1",
        name: "User",
        role: "bride",
        couple_id: null,
        avatar_url: null,
        onboarding_completed: true,
        onboarding_step: 5,
        care_notifications_enabled: true,
        care_notifications_consented_at: "2026-08-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-08-01T00:00:00.000Z",
        email: "profile-email@example.com",
        phone: "01012345678",
        phone_care_consented_at: "2026-08-01T00:00:00.000Z",
        is_admin: true,
        push_token: "ExponentPushToken[sensitive-device]",
        push_notifications_enabled: true,
        push_notifications_consented_at: "2026-08-01T00:00:00.000Z",
        community_push_notifications_enabled: true,
        partner_push_notifications_enabled: true,
        push_token_attached_at: "2026-08-01T00:00:00.000Z",
      },
      error: null,
    });
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "auth-email@example.com" } },
        }),
      },
    } as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => query),
    } as never);

    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(query.select).toHaveBeenCalledWith([
      "id",
      "name",
      "role",
      "couple_id",
      "avatar_url",
      "onboarding_completed",
      "onboarding_step",
      "care_notifications_enabled",
      "care_notifications_consented_at",
      "created_at",
      "updated_at",
    ].join(", "));
    expect(body.user).toEqual({ id: "user-1", email: "auth-email@example.com" });
    expect(body.profile).toEqual({
      id: "user-1",
      name: "User",
      role: "bride",
      couple_id: null,
      avatar_url: null,
      onboarding_completed: true,
      onboarding_step: 5,
      care_notifications_enabled: true,
      care_notifications_consented_at: "2026-08-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    });
    expect(body.profile).not.toHaveProperty("email");
    expect(body.profile).not.toHaveProperty("phone");
    expect(body.profile).not.toHaveProperty("phone_care_consented_at");
    expect(body.profile).not.toHaveProperty("is_admin");
    expect(body.profile).not.toHaveProperty("push_token");
    expect(body.profile).not.toHaveProperty("push_notifications_enabled");
    expect(body.profile).not.toHaveProperty("push_notifications_consented_at");
    expect(body.profile).not.toHaveProperty("community_push_notifications_enabled");
    expect(body.profile).not.toHaveProperty("partner_push_notifications_enabled");
    expect(body.profile).not.toHaveProperty("push_token_attached_at");
  });

  it("keeps partner-name lookup on the safe four-field directory", async () => {
    function queryResult(data: unknown) {
      const query = {
        select: vi.fn(),
        eq: vi.fn(),
        single: vi.fn().mockResolvedValue({ data, error: null }),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      return query;
    }

    const profileQuery = queryResult({
      id: "user-1",
      name: "Alice",
      role: "bride",
      couple_id: "couple-1",
      avatar_url: null,
      onboarding_completed: true,
      onboarding_step: 5,
      care_notifications_enabled: false,
      care_notifications_consented_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    });
    const coupleQuery = queryResult({
      id: "couple-1",
      bride_id: "user-1",
      groom_id: "user-2",
    });
    const partnerQuery = queryResult({
      id: "user-2",
      name: "Bob",
      role: "groom",
      couple_id: "couple-1",
    });
    const journeyQuery = queryResult(null);
    const from = vi.fn((table: string) => {
      if (table === "couples") return coupleQuery;
      if (table === "couple_profile_directory") return partnerQuery;
      if (table === "wedding_journeys") return journeyQuery;
      throw new Error(`unexpected table: ${table}`);
    });

    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "alice@example.com" } },
        }),
      },
      from,
    } as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => profileQuery),
    } as never);

    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("couple_profile_directory");
    expect(partnerQuery.select).toHaveBeenCalledWith("id, name, role, couple_id");
    expect(body.partner).toEqual({
      id: "user-2",
      name: "Bob",
      role: "groom",
      couple_id: "couple-1",
    });
  });

  it("applies the private cache boundary to a signed demo response", async () => {
    vi.mocked(hasSignedDemoSessionFromCookieHeader).mockReturnValue(true);

    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));

    expect(response.status).toBe(200);
    expectPrivateResponse(response);
    await expect(response.json()).resolves.toEqual({ user: null, demo: true });
  });

  it("never returns a raw database diagnostic in the authenticated snapshot", async () => {
    const privateMarker = "person@example.com wedding journey table secret";
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.single.mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: privateMarker },
    });
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "person@example.com" } },
        }),
      },
    } as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => query),
    } as never);

    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expectPrivateResponse(response);
    expect(responseText).not.toContain(privateMarker);
    expect(responseText).not.toContain("_debug");
  });

  it("applies the private cache boundary to an unexpected server error", async () => {
    vi.mocked(createClientFromRequest).mockRejectedValue(new Error("private-marker"));

    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));

    expect(response.status).toBe(500);
    expectPrivateResponse(response);
    expect(await response.text()).not.toContain("private-marker");
  });
});
