// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

import { GET } from "./route";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "10000000-0000-4000-8000-000000000002";
const ROOM_ID = "20000000-0000-4000-8000-000000000001";

function request() {
  return new NextRequest(`https://hanbang.ai/api/community/cohort/${ROOM_ID}/members`);
}

function authenticatedClient(options: { member?: boolean } = {}) {
  const membershipQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({
      data: options.member === false ? null : { id: "membership-id" },
      error: null,
    })),
  };
  membershipQuery.select.mockReturnValue(membershipQuery);
  membershipQuery.eq.mockReturnValue(membershipQuery);

  const membersQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(async () => ({
      data: [
        { user_id: USER_ID, joined_at: "2026-08-01T00:00:00.000Z" },
        { user_id: OTHER_USER_ID, joined_at: "2026-08-02T00:00:00.000Z" },
      ],
      error: null,
    })),
  };
  membersQuery.select.mockReturnValue(membersQuery);
  membersQuery.eq.mockReturnValue(membersQuery);
  membersQuery.order.mockReturnValue(membersQuery);

  const profilesQuery = {
    select: vi.fn(),
    in: vi.fn(async () => ({
      data: [{ user_id: USER_ID, nickname: "테스터", rank: "expert" }],
      error: null,
    })),
  };
  profilesQuery.select.mockReturnValue(profilesQuery);

  let memberReads = 0;
  const from = vi.fn((table: string) => {
    if (table === "cohort_members") {
      memberReads += 1;
      return memberReads === 1 ? membershipQuery : membersQuery;
    }
    if (table === "community_public_profiles") return profilesQuery;
    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
    from,
    membershipQuery,
    membersQuery,
    profilesQuery,
  };
}

describe("GET /api/community/cohort/[id]/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks active membership and returns only the public identity projection", async () => {
    const client = authenticatedClient();
    mocks.createClientFromRequest.mockResolvedValue(client);

    const response = await GET(request(), {
      params: Promise.resolve({ id: ROOM_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(client.membershipQuery.eq).toHaveBeenCalledWith("room_id", ROOM_ID);
    expect(client.membershipQuery.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(client.membershipQuery.eq).toHaveBeenCalledWith("is_active", true);
    expect(client.from).toHaveBeenCalledWith("community_public_profiles");
    expect(client.profilesQuery.select).toHaveBeenCalledWith("user_id, nickname, rank");
    expect(body).toEqual({
      members: [{
        user_id: USER_ID,
        profile: { nickname: "테스터", rank: "expert" },
      }],
    });
    expect(JSON.stringify(body)).not.toMatch(/wedding_(?:year|month)/u);
  });

  it("fails closed before listing members when the caller is not active", async () => {
    const client = authenticatedClient({ member: false });
    mocks.createClientFromRequest.mockResolvedValue(client);

    const response = await GET(request(), {
      params: Promise.resolve({ id: ROOM_ID }),
    });

    expect(response.status).toBe(403);
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(client.from).not.toHaveBeenCalledWith("community_public_profiles");
  });

  it("rejects invalid room IDs before auth or database access", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ id: "not-a-room" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });
});
