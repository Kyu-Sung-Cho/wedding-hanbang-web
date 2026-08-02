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
    images: [],
    slides: null,
    visibility: "public",
    ad_disclosure: "general",
    sponsorship_detail: null,
    ai_comment: null,
    is_resolved: false,
    is_verified_review: false,
    price_data: null,
    is_quick_review: false,
    rating: null,
    cohort_room_id: null,
    under_review: false,
    upvote_count: 0,
    downvote_count: 0,
    comment_count: 0,
    view_count: 0,
    bookmark_count: 0,
    is_pinned: false,
    is_weekly_best: false,
    vendor_tags: [],
    tags: [],
    cost_data: null,
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
        rank: "sprout",
        wedding_year: null,
        wedding_month: null,
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

  const adminSupabase = {
    from: vi.fn((table: string) => {
      if (table === "community_polls") return pollsQuery;
      throw new Error(`Unexpected admin table ${table}`);
    }),
  };

  return {
    createPublicClient: vi.fn(() => supabase),
    createAdminClient: vi.fn(() => adminSupabase),
    postsQuery,
    profilesQuery,
    pollsQuery,
    supabase,
    adminSupabase,
  };
});

vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: mocks.createPublicClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

describe("getInitialCommunityFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists posts through the same public visibility/select rule that detail pages can read", async () => {
    const feed = await getInitialCommunityFeed(1);

    expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
    expect(mocks.supabase.from).toHaveBeenCalledWith("community_posts");
    expect(mocks.postsQuery.select).toHaveBeenCalledWith(COMMUNITY_POST_PUBLIC_SELECT, { count: "exact" });
    expect(mocks.postsQuery.eq).toHaveBeenCalledWith("visibility", "public");
    expect(mocks.postsQuery.eq).toHaveBeenCalledWith("under_review", false);
    expect(feed.posts).toHaveLength(1);
    expect(feed.posts[0]?.id).toBe("listed-post");
    expect(feed.posts[0]?.category).toBe("is_normal");
    expect(feed.posts[0]?.author.role).toBeNull();
  });

  it("does not leak an open hidden poll count through the cached anonymous feed", async () => {
    mocks.pollsQuery.in.mockResolvedValueOnce({
      data: [{
        id: "poll-1",
        post_id: "listed-post",
        question: "Hidden result",
        allow_multiple: false,
        is_anonymous: true,
        hide_results_until_voted: true,
        closes_at: "2999-01-01T00:00:00.000Z",
        total_voters: 12,
        total_votes: 12,
        created_at: "2026-06-20T00:00:00.000Z",
      }],
      error: null,
    });

    const feed = await getInitialCommunityFeed(1);

    expect(feed.posts[0]?.poll).toMatchObject({
      id: "poll-1",
      total_voters: 0,
    });
    expect(mocks.adminSupabase.from).toHaveBeenCalledWith("community_polls");
  });
});
