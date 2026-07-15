import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { getInitialCommunityFeed } from "@/lib/community/initialFeed";

const mocks = vi.hoisted(() => {
  const postRow = {
    id: "listed-post",
    author_id: "author-1",
    category: "is_normal",
    title: "Listed post",
    content: "Body",
    visibility: "public",
    ad_disclosure: "general",
    sponsorship_detail: null,
    is_resolved: false,
    under_review: false,
    upvote_count: 0,
    downvote_count: 0,
    comment_count: 0,
    view_count: 0,
    bookmark_count: 0,
    is_pinned: false,
    is_weekly_best: false,
    tags: [],
    created_at: "2026-06-20T00:00:00.000Z",
    updated_at: "2026-06-20T00:00:00.000Z",
  };

  const postsQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
  };
  postsQuery.select.mockReturnValue(postsQuery);
  postsQuery.eq.mockReturnValue(postsQuery);
  postsQuery.order.mockReturnValue(postsQuery);
  postsQuery.range.mockResolvedValue({ data: [postRow], count: 1, error: null });

  const profilesQuery = {
    select: vi.fn(),
    in: vi.fn(),
  };
  profilesQuery.select.mockReturnValue(profilesQuery);
  profilesQuery.in.mockResolvedValue({
    data: [
      {
        user_id: "author-1",
        nickname: "Tester",
        avatar_url: null,
      },
    ],
    error: null,
  });

  const pollsQuery = {
    select: vi.fn(),
    in: vi.fn(),
  };
  pollsQuery.select.mockReturnValue(pollsQuery);
  pollsQuery.in.mockResolvedValue({ data: [], error: null });

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "community_posts") return postsQuery;
      if (table === "community_profiles") return profilesQuery;
      if (table === "community_polls") return pollsQuery;
      throw new Error(`Unexpected table ${table}`);
    }),
  };

  return {
    createPublicClient: vi.fn(() => supabase),
    postsQuery,
    profilesQuery,
    pollsQuery,
    supabase,
  };
});

vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: mocks.createPublicClient,
}));

describe("getInitialCommunityFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists posts through the same public visibility/select rule that detail pages can read", async () => {
    const result = await getInitialCommunityFeed(1);

    expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
    expect(mocks.supabase.from).toHaveBeenCalledWith("community_posts");
    expect(mocks.postsQuery.select).toHaveBeenCalledWith(COMMUNITY_POST_PUBLIC_SELECT, { count: "exact" });
    expect(mocks.postsQuery.eq).toHaveBeenCalledWith("visibility", "public");
    expect(mocks.postsQuery.eq).toHaveBeenCalledWith("under_review", false);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready feed");
    expect(result.feed.posts).toHaveLength(1);
    expect(result.feed.posts[0]?.id).toBe("listed-post");
    expect(result.feed.posts[0]?.category).toBe("is_normal");
    expect(result.feed.posts[0]?.author).not.toHaveProperty("role");
  });

  it("returns an unavailable result instead of disguising a post query failure as an empty feed", async () => {
    mocks.postsQuery.range.mockResolvedValueOnce({
      data: null,
      count: null,
      error: { message: "posts database unavailable" },
    });

    const result = await getInitialCommunityFeed(1);

    expect(result).toEqual({
      status: "unavailable",
      message: "게시글을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
    });
  });

  it("keeps a successful zero-post query as a genuine empty feed", async () => {
    mocks.postsQuery.range.mockResolvedValueOnce({ data: [], count: 0, error: null });

    const result = await getInitialCommunityFeed(1);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready feed");
    expect(result.feed).toMatchObject({ posts: [], total: 0, hasMore: false });
  });

  it("does not infer a total when the exact post count is missing", async () => {
    mocks.postsQuery.range.mockResolvedValueOnce({
      data: [
        {
          id: "listed-post",
          author_id: "author-1",
          category: "is_normal",
          title: "Listed post",
          content: "Body",
          visibility: "public",
          ad_disclosure: "general",
          sponsorship_detail: null,
          is_resolved: false,
          under_review: false,
          upvote_count: 0,
          downvote_count: 0,
          comment_count: 0,
          view_count: 0,
          bookmark_count: 0,
          is_pinned: false,
          is_weekly_best: false,
          tags: [],
          created_at: "2026-06-20T00:00:00.000Z",
          updated_at: "2026-06-20T00:00:00.000Z",
        },
      ],
      count: null,
      error: null,
    });

    const result = await getInitialCommunityFeed(1);

    expect(result.status).toBe("unavailable");
  });

  it("does not render a post with a fabricated anonymous author when its profile is missing", async () => {
    mocks.profilesQuery.in.mockResolvedValueOnce({ data: [], error: null });

    const result = await getInitialCommunityFeed(1);

    expect(result.status).toBe("unavailable");
  });

  it("does not disguise a poll lookup failure as posts without polls", async () => {
    mocks.pollsQuery.in.mockResolvedValueOnce({
      data: null,
      error: { message: "poll database unavailable" },
    });

    const result = await getInitialCommunityFeed(1);

    expect(result.status).toBe("unavailable");
  });
});
