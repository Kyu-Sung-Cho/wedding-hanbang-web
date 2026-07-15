import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { getCommunityUserIdForActor } from "@/lib/community/actorIdentity";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { DELETE, GET, POST } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/community/actorIdentity", () => ({
  getCommunityUserIdForActor: vi.fn(),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn((key: string) => `${key}:test`),
}));

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const MUTED_USER_ID = "223e4567-e89b-42d3-a456-426614174000";
const MUTED_ACTOR_ID = "423e4567-e89b-42d3-a456-426614174000";

function mockAuth(user: { id: string } | null, error: unknown = null) {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error }),
    },
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
}

function jsonRequest(method: "POST" | "DELETE", body: unknown, contentLength?: number) {
  return new NextRequest("http://localhost/api/community/mutes", {
    method,
    headers: {
      "content-type": "application/json",
      ...(contentLength === undefined ? {} : { "content-length": String(contentLength) }),
    },
    body: JSON.stringify(body),
  });
}

function deleteQuery(result: unknown) {
  const query: Record<string, unknown> & PromiseLike<unknown> = {
    delete: vi.fn(() => query),
    eq: vi.fn(() => query),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return query;
}

describe("/api/community/mutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
    vi.mocked(getCommunityUserIdForActor).mockResolvedValue(MUTED_USER_ID);
  });

  it("fails closed when authentication cannot be verified", async () => {
    mockAuth(null, { message: "auth unavailable" });

    const response = await GET(new NextRequest("http://localhost/api/community/mutes"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("requires authentication before exposing private mute state", async () => {
    mockAuth(null);

    const response = await POST(jsonRequest("POST", { userId: MUTED_ACTOR_ID }));

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns only the minimal management DTO", async () => {
    mockAuth({ id: USER_ID });
    const muteQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn().mockResolvedValue({
        data: [{ muted_user_id: MUTED_USER_ID, created_at: "2026-07-13T00:00:00.000Z" }],
        error: null,
      }),
    };
    muteQuery.select.mockReturnValue(muteQuery);
    muteQuery.eq.mockReturnValue(muteQuery);
    const profileQuery = {
      select: vi.fn(),
      in: vi.fn().mockResolvedValue({
        data: [{ user_id: MUTED_USER_ID, public_actor_id: MUTED_ACTOR_ID, nickname: "차분한예비부부", email: "hidden@example.com" }],
        error: null,
      }),
    };
    profileQuery.select.mockReturnValue(profileQuery);
    const admin = {
      from: vi.fn((table: string) =>
        table === "community_user_mutes" ? muteQuery : profileQuery,
      ),
    };
    vi.mocked(createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminClient>,
    );

    const response = await GET(new NextRequest("http://localhost/api/community/mutes"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      users: [
        {
          id: MUTED_ACTOR_ID,
          nickname: "차분한예비부부",
          mutedAt: "2026-07-13T00:00:00.000Z",
        },
      ],
    });
    expect(profileQuery.select).toHaveBeenCalledWith("user_id, public_actor_id, nickname");
    expect(JSON.stringify(body)).not.toContain("hidden@example.com");
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "community:mutes:read:test",
      { maxRequests: 60, windowMs: 60 * 1000 },
      USER_ID,
    );
  });

  it("does not disguise a mute-state read failure as an empty list", async () => {
    mockAuth({ id: USER_ID });
    const muteQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "database unavailable" },
      }),
    };
    muteQuery.select.mockReturnValue(muteQuery);
    muteQuery.eq.mockReturnValue(muteQuery);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => muteQuery),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await GET(new NextRequest("http://localhost/api/community/mutes"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.users).toBeUndefined();
  });

  it("rejects self-mute without writing", async () => {
    mockAuth({ id: USER_ID });
    vi.mocked(getCommunityUserIdForActor).mockResolvedValue(USER_ID);

    const response = await POST(jsonRequest("POST", { userId: MUTED_ACTOR_ID }));

    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects unknown mutation fields without writing", async () => {
    mockAuth({ id: USER_ID });

    const response = await POST(
      jsonRequest("POST", { userId: MUTED_ACTOR_ID, email: "must-not-be-accepted@example.com" }),
    );

    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("treats an existing mute as an idempotent success", async () => {
    mockAuth({ id: USER_ID });
    const insert = vi.fn().mockResolvedValue({ error: { code: "23505" } });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ insert })),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(jsonRequest("POST", { userId: MUTED_ACTOR_ID }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ muted: true });
    expect(insert).toHaveBeenCalledWith({ muter_id: USER_ID, muted_user_id: MUTED_USER_ID });
  });

  it("scopes unmute to both the signed-in owner and target", async () => {
    mockAuth({ id: USER_ID });
    const query = deleteQuery({ error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => query),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await DELETE(jsonRequest("DELETE", { userId: MUTED_ACTOR_ID }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ muted: false });
    expect(query.eq).toHaveBeenNthCalledWith(1, "muter_id", USER_ID);
    expect(query.eq).toHaveBeenNthCalledWith(2, "muted_user_id", MUTED_USER_ID);
  });

  it("rejects oversized mutation bodies explicitly", async () => {
    mockAuth({ id: USER_ID });

    const response = await POST(
      jsonRequest("POST", { userId: MUTED_ACTOR_ID }, 4 * 1024 + 1),
    );

    expect(response.status).toBe(413);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
