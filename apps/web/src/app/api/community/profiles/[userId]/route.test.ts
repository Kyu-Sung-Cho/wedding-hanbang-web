// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  viewerCanSee: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { GET } from "./route";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const TARGET_USER_ID = "10000000-0000-4000-8000-000000000002";
const ROOM_ID = "20000000-0000-4000-8000-000000000001";

function request() {
  return new NextRequest(
    `https://hanbang.ai/api/community/profiles/${TARGET_USER_ID}?room_id=${ROOM_ID}`,
  );
}

function serviceClient(options: {
  memberships?: Array<{ user_id: string }>;
  profile?: {
    user_id: string;
    nickname: string;
    avatar_url: string | null;
    badge: string | null;
    rank: string;
  } | null;
} = {}) {
  const rpc = mocks.viewerCanSee;
  const membershipsQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(async () => ({
      data: options.memberships ?? [
        { user_id: USER_ID },
        { user_id: TARGET_USER_ID },
      ],
      error: null,
    })),
  };
  membershipsQuery.select.mockReturnValue(membershipsQuery);
  membershipsQuery.eq.mockReturnValue(membershipsQuery);

  const profileQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({
      data: options.profile === undefined
        ? {
            user_id: TARGET_USER_ID,
            nickname: "테스트커플",
            avatar_url: null,
            badge: "founding",
            rank: "sprout",
          }
        : options.profile,
      error: null,
    })),
  };
  profileQuery.select.mockReturnValue(profileQuery);
  profileQuery.eq.mockReturnValue(profileQuery);

  const postsQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(async () => ({ data: [], error: null })),
  };
  postsQuery.select.mockReturnValue(postsQuery);
  postsQuery.eq.mockReturnValue(postsQuery);
  postsQuery.order.mockReturnValue(postsQuery);

  const from = vi.fn((table: string) => {
    if (table === "cohort_members") return membershipsQuery;
    if (table === "community_public_profiles") return profileQuery;
    if (table === "community_posts") return postsQuery;
    throw new Error(`Unexpected table: ${table}`);
  });

  return { from, rpc, membershipsQuery, profileQuery, postsQuery };
}

describe("GET /api/community/profiles/[userId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewerCanSee.mockResolvedValue({ data: true, error: null });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
      },
      rpc: vi.fn(() => {
        throw new Error("viewer-scoped client must not expose the block oracle");
      }),
    });
  });

  it("returns only the safe public projection after same-cohort authorization", async () => {
    const service = serviceClient();
    mocks.createAdminClient.mockReturnValue(service);

    const response = await GET(request(), {
      params: Promise.resolve({ userId: TARGET_USER_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toContain("Authorization");
    expect(service.membershipsQuery.eq).toHaveBeenCalledWith("room_id", ROOM_ID);
    expect(service.membershipsQuery.eq).toHaveBeenCalledWith("is_active", true);
    expect(service.from).toHaveBeenCalledWith("community_public_profiles");
    expect(service.from).not.toHaveBeenCalledWith("community_profiles");
    expect(service.profileQuery.select).toHaveBeenCalledWith(
      "user_id, nickname, avatar_url, badge, rank",
    );
    expect(body.profile).toEqual({
      user_id: TARGET_USER_ID,
      nickname: "테스트커플",
      avatar_url: null,
      badge: "founding",
      rank: "sprout",
    });
    expect(JSON.stringify(body)).not.toMatch(
      /wedding_(?:year|month|completed)|post_count|comment_count|total_upvotes_received|created_at/u,
    );
  });

  it("returns 404 and does not enumerate posts when the projection hides a suspended profile", async () => {
    const service = serviceClient({ profile: null });
    mocks.createAdminClient.mockReturnValue(service);

    const response = await GET(request(), {
      params: Promise.resolve({ userId: TARGET_USER_ID }),
    });

    expect(response.status).toBe(404);
    expect(service.from).toHaveBeenCalledWith("community_public_profiles");
    expect(service.from).not.toHaveBeenCalledWith("community_posts");
  });

  it("keeps the same-cohort boundary before any target profile lookup", async () => {
    const service = serviceClient({ memberships: [{ user_id: USER_ID }] });
    mocks.createAdminClient.mockReturnValue(service);

    const response = await GET(request(), {
      params: Promise.resolve({ userId: TARGET_USER_ID }),
    });

    expect(response.status).toBe(403);
    expect(service.from).toHaveBeenCalledTimes(1);
    expect(service.from).not.toHaveBeenCalledWith("community_public_profiles");
    expect(mocks.viewerCanSee).not.toHaveBeenCalled();
  });

  it("returns 404 without reading the target profile when either member blocked the other", async () => {
    const service = serviceClient();
    mocks.viewerCanSee.mockResolvedValue({ data: false, error: null });
    mocks.createAdminClient.mockReturnValue(service);

    const response = await GET(request(), {
      params: Promise.resolve({ userId: TARGET_USER_ID }),
    });

    expect(response.status).toBe(404);
    expect(mocks.viewerCanSee).toHaveBeenCalledWith(
      "community_viewer_can_see",
      {
        p_viewer_user_id: USER_ID,
        p_other_user_id: TARGET_USER_ID,
      },
    );
    expect(service.rpc).toHaveBeenCalledOnce();
    expect(service.from).not.toHaveBeenCalledWith("community_public_profiles");
    expect(service.from).not.toHaveBeenCalledWith("community_posts");
  });

  it("fails closed when the server cannot verify the viewer-control boundary", async () => {
    const service = serviceClient();
    mocks.viewerCanSee.mockResolvedValue({
      data: null,
      error: { message: "schema unavailable" },
    });
    mocks.createAdminClient.mockReturnValue(service);

    const response = await GET(request(), {
      params: Promise.resolve({ userId: TARGET_USER_ID }),
    });

    expect(response.status).toBe(503);
    expect(service.from).not.toHaveBeenCalledWith("community_public_profiles");
  });
});
