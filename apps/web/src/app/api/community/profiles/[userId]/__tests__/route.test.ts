import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  checkRateLimitPersistent,
  rateLimitKey,
} from "@/utils/rateLimit";
import { GET } from "../route";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn((scope: string, _request: Request, subject: string) =>
    `${scope}:${subject}`
  ),
}));

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const VIEWER_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "33333333-3333-4333-8333-333333333333";

type PublicProfile = {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  badge: string | null;
  rank: string;
};

type PublicPost = {
  id: string;
  title: string;
  category: string;
  created_at: string;
  upvote_count: number;
  comment_count: number;
};

function request(roomId: string | null = ROOM_ID) {
  const url = new URL(
    `http://localhost/api/community/profiles/${AUTHOR_ID}`
  );
  if (roomId !== null) url.searchParams.set("room_id", roomId);
  return new NextRequest(url);
}

function context(userId = AUTHOR_ID) {
  return { params: Promise.resolve({ userId }) };
}

function mockAuth(userId: string | null = VIEWER_ID) {
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  };

  vi.mocked(createClientFromRequest).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClientFromRequest>>
  );

  return client;
}

function mockService({
  memberships = [{ user_id: VIEWER_ID }, { user_id: AUTHOR_ID }],
  membershipError = null,
  profile = {
    user_id: AUTHOR_ID,
    nickname: "작성자",
    avatar_url: "https://example.com/avatar.png",
    badge: "verified",
    rank: "새싹",
  },
  profileError = null,
  posts = [
    {
      id: "44444444-4444-4444-8444-444444444444",
      title: "공개 준비 기록",
      category: "venue",
      created_at: "2026-07-13T00:00:00.000Z",
      upvote_count: 3,
      comment_count: 1,
    },
  ],
  postsError = null,
}: {
  memberships?: Array<{ user_id: string }>;
  membershipError?: unknown;
  profile?: PublicProfile | null;
  profileError?: unknown;
  posts?: PublicPost[] | null;
  postsError?: unknown;
} = {}) {
  const membershipQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn().mockResolvedValue({
      data: memberships,
      error: membershipError,
    }),
  };
  membershipQuery.select.mockReturnValue(membershipQuery);
  membershipQuery.eq.mockReturnValue(membershipQuery);

  const profileQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: profile,
      error: profileError,
    }),
  };
  profileQuery.select.mockReturnValue(profileQuery);
  profileQuery.eq.mockReturnValue(profileQuery);

  const postsQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn().mockResolvedValue({
      data: posts,
      error: postsError,
    }),
  };
  postsQuery.select.mockReturnValue(postsQuery);
  postsQuery.eq.mockReturnValue(postsQuery);
  postsQuery.order.mockReturnValue(postsQuery);

  const serviceClient = {
    from: vi.fn((table: string) => {
      if (table === "cohort_members") return membershipQuery;
      if (table === "community_profiles") return profileQuery;
      if (table === "community_posts") return postsQuery;
      throw new Error(`Unexpected service-role table access: ${table}`);
    }),
  };

  vi.mocked(createSupabaseClient).mockReturnValue(
    serviceClient as unknown as ReturnType<typeof createSupabaseClient>
  );

  return {
    serviceClient,
    membershipQuery,
    profileQuery,
    postsQuery,
  };
}

describe("/api/community/profiles/[userId] GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
    mockAuth();
  });

  it("rejects an invalid author UUID before authentication or service access", async () => {
    const response = await GET(request(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createSupabaseClient).not.toHaveBeenCalled();
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated viewer before service-role access", async () => {
    mockAuth(null);

    const response = await GET(request(), context());

    expect(response.status).toBe(401);
    expect(createSupabaseClient).not.toHaveBeenCalled();
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("fails closed when membership lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockService({ membershipError: { message: "membership unavailable" } });

    const response = await GET(request(), context());

    expect(response.status).toBe(500);
  });

  it("rejects a profile lookup when viewer and author are not in the same room", async () => {
    const { serviceClient } = mockService({
      memberships: [{ user_id: VIEWER_ID }],
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(403);
    expect(serviceClient.from).not.toHaveBeenCalledWith("community_profiles");
    expect(serviceClient.from).not.toHaveBeenCalledWith("community_posts");
  });

  it("fails closed when the minimized profile lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockService({ profileError: { message: "profile unavailable" } });

    const response = await GET(request(), context());

    expect(response.status).toBe(500);
  });

  it("returns 404 when the author has no community profile", async () => {
    mockService({ profile: null });

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
  });

  it("returns only the minimized author card and public post projection", async () => {
    const { membershipQuery, profileQuery, postsQuery } = mockService();

    const response = await GET(request(), context());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.profile).toEqual({
      user_id: AUTHOR_ID,
      nickname: "작성자",
      avatar_url: "https://example.com/avatar.png",
      badge: "verified",
      rank: "새싹",
    });
    expect(Object.keys(payload.profile).sort()).toEqual(
      ["avatar_url", "badge", "nickname", "rank", "user_id"].sort()
    );
    expect(payload.posts).toEqual([
      {
        id: "44444444-4444-4444-8444-444444444444",
        title: "공개 준비 기록",
        category: "venue",
        created_at: "2026-07-13T00:00:00.000Z",
        upvote_count: 3,
        comment_count: 1,
      },
    ]);

    expect(membershipQuery.eq).toHaveBeenCalledWith("room_id", ROOM_ID);
    expect(membershipQuery.eq).toHaveBeenCalledWith("is_active", true);
    expect(membershipQuery.in).toHaveBeenCalledWith("user_id", [
      VIEWER_ID,
      AUTHOR_ID,
    ]);
    expect(profileQuery.select).toHaveBeenCalledWith(
      "user_id, nickname, avatar_url, badge, rank"
    );
    expect(postsQuery.select).toHaveBeenCalledWith(
      "id, title, category, created_at, upvote_count, comment_count"
    );
    expect(postsQuery.eq).toHaveBeenCalledWith("author_id", AUTHOR_ID);
    expect(postsQuery.eq).toHaveBeenCalledWith("visibility", "public");
    expect(postsQuery.eq).toHaveBeenCalledWith("under_review", false);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("wedding_year");
    expect(serialized).not.toContain("wedding_month");
    expect(serialized).not.toContain("wedding_completed");
    expect(serialized).not.toContain("total_upvotes_received");
    expect(serialized).not.toContain("author_id");
    expect(serialized).not.toContain("content");
  });

  it("fails closed when the public-post lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockService({ postsError: { message: "posts unavailable" } });

    const response = await GET(request(), context());

    expect(response.status).toBe(500);
  });

  it("uses the authenticated viewer as the persistent rate-limit subject", async () => {
    const limited = NextResponse.json(
      { error: "Too many requests" },
      { status: 429 }
    );
    vi.mocked(checkRateLimitPersistent).mockResolvedValueOnce(limited);

    const response = await GET(request(), context());

    expect(response.status).toBe(429);
    expect(rateLimitKey).toHaveBeenCalledWith(
      "community:profile-card:read",
      expect.any(NextRequest),
      VIEWER_ID
    );
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      `community:profile-card:read:${VIEWER_ID}`,
      { maxRequests: 60, windowMs: 60_000 },
      VIEWER_ID
    );
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });
});
