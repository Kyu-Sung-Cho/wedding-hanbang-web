import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { getPublicCommunityPostDetail } from "@/lib/community/publicPostDetail";

const mocks = vi.hoisted(() => {
  const postRow = {
    id: "post-1",
    author_id: "author-1",
    content_origin: "operator",
    category: "is_normal",
    title: "계약 전에 확인할 항목",
    content: "<p>계약서 원문을 먼저 확인해 주세요.</p>",
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
    upvote_count: 2,
    downvote_count: 0,
    comment_count: 1,
    view_count: 10,
    bookmark_count: 0,
    is_pinned: false,
    is_weekly_best: false,
    vendor_tags: ["vendor-1"],
    tags: ["계약"],
    cost_data: null,
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
  };

  const postsQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  postsQuery.select.mockReturnValue(postsQuery);
  postsQuery.eq.mockReturnValue(postsQuery);

  const profilesQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  profilesQuery.select.mockReturnValue(profilesQuery);
  profilesQuery.eq.mockReturnValue(profilesQuery);

  const vendorsQuery = {
    select: vi.fn(),
    in: vi.fn(),
  };
  vendorsQuery.select.mockReturnValue(vendorsQuery);

  const pollsQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  pollsQuery.select.mockReturnValue(pollsQuery);
  pollsQuery.eq.mockReturnValue(pollsQuery);

  const pollOptionsQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
  };
  pollOptionsQuery.select.mockReturnValue(pollOptionsQuery);
  pollOptionsQuery.eq.mockReturnValue(pollOptionsQuery);

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "community_posts") return postsQuery;
      if (table === "community_profiles") return profilesQuery;
      if (table === "v_public_vendors") return vendorsQuery;
      if (table === "community_polls") return pollsQuery;
      if (table === "community_poll_options") return pollOptionsQuery;
      throw new Error(`Unexpected table ${table}`);
    }),
  };

  return {
    postRow,
    postsQuery,
    profilesQuery,
    vendorsQuery,
    pollsQuery,
    pollOptionsQuery,
    supabase,
    createPublicClient: vi.fn(() => supabase),
  };
});

vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: mocks.createPublicClient,
}));

describe("getPublicCommunityPostDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.postsQuery.maybeSingle.mockResolvedValue({
      data: mocks.postRow,
      error: null,
    });
    mocks.profilesQuery.maybeSingle.mockResolvedValue({
      data: {
        user_id: "author-1",
        nickname: "웨딩한방 운영팀",
        avatar_url: null,
        rank: "expert",
        wedding_year: null,
        wedding_month: null,
      },
      error: null,
    });
    mocks.vendorsQuery.in.mockResolvedValue({
      data: [
        {
          id: "vendor-1",
          name: "테스트 웨딩홀",
          category: "hall",
          region_code: "seoul_gangnam3",
        },
      ],
      error: null,
    });
    mocks.pollsQuery.maybeSingle.mockResolvedValue({
      data: {
        id: "poll-1",
        post_id: "post-1",
        question: "계약 전 확인했나요?",
        allow_multiple: false,
        is_anonymous: true,
        hide_results_until_voted: false,
        closes_at: null,
        total_voters: 4,
        total_votes: 4,
        created_at: "2026-07-30T00:00:00.000Z",
      },
      error: null,
    });
    mocks.pollOptionsQuery.order.mockResolvedValue({
      data: [
        {
          id: "option-1",
          poll_id: "poll-1",
          position: 0,
          label: "확인했어요",
          image_url: null,
          vote_count: 4,
        },
      ],
      error: null,
    });
  });

  it("builds the initial detail using only the anonymous public boundary", async () => {
    const detail = await getPublicCommunityPostDetail("post-1");

    expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
    expect(mocks.postsQuery.select).toHaveBeenCalledWith(
      COMMUNITY_POST_PUBLIC_SELECT,
    );
    expect(mocks.postsQuery.eq).toHaveBeenCalledWith("id", "post-1");
    expect(mocks.postsQuery.eq).toHaveBeenCalledWith("visibility", "public");
    expect(mocks.postsQuery.eq).toHaveBeenCalledWith("under_review", false);
    expect(detail).toMatchObject({
      id: "post-1",
      title: "계약 전에 확인할 항목",
      content_origin: "operator",
      author: { nickname: "웨딩한방 운영팀" },
      user_vote: null,
      user_bookmarked: false,
      vendor_details: [
        {
          id: "vendor-1",
          vendor_name: "테스트 웨딩홀",
          business_name: "테스트 웨딩홀",
        },
      ],
      poll: {
        id: "poll-1",
        user_voted_option_ids: [],
        options: [{ id: "option-1" }],
      },
    });
  });

  it("returns null instead of inventing a post for missing or non-public rows", async () => {
    mocks.postsQuery.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    await expect(getPublicCommunityPostDetail("private-post")).resolves.toBeNull();
    expect(mocks.profilesQuery.maybeSingle).not.toHaveBeenCalled();
    expect(mocks.pollsQuery.maybeSingle).not.toHaveBeenCalled();
  });

  it("throws on a database failure so the recoverable error boundary is used instead of a false 404", async () => {
    mocks.postsQuery.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "connection unavailable" },
    });

    await expect(getPublicCommunityPostDetail("post-1")).rejects.toThrow(
      "COMMUNITY_PUBLIC_POST_DETAIL_UNAVAILABLE",
    );
  });
});
