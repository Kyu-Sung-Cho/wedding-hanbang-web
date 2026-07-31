import { describe, expect, it } from "vitest";
import {
  excludeFeaturedPostsWhenFeedRemains,
  selectRecentAnswerWaitingPosts,
} from "@/lib/community/landingFeed";
import type { PostWithAuthor } from "@/types/community.types";

function post(
  id: string,
  overrides: Partial<PostWithAuthor> = {},
): PostWithAuthor {
  return {
    id,
    author_id: "author-1",
    content_origin: "member",
    category: "is_normal",
    title: id,
    content: "본문",
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
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
    author: {
      user_id: "author-1",
      nickname: "예비부부",
      avatar_url: null,
      rank: "sprout",
      wedding_year: null,
      wedding_month: null,
      role: null,
    },
    user_vote: null,
    user_bookmarked: false,
    poll: null,
    ...overrides,
  } as PostWithAuthor;
}

describe("community landing feed", () => {
  it("features only unanswered general questions", () => {
    const selected = selectRecentAnswerWaitingPosts([
      post("question"),
      post("ama", { category: "ama" }),
      post("tip", { category: "tips_v2" }),
      post("answered", { comment_count: 1 }),
      post("resolved", { is_resolved: true }),
      post("sponsored", { ad_disclosure: "sponsored", sponsorship_detail: "식사권 제공" }),
      post("ad", { ad_disclosure: "ad" }),
    ]);

    expect(selected.map((item) => item.id)).toEqual(["question", "ama"]);
  });

  it("does not repeat featured questions when other feed rows remain", () => {
    const featured = post("featured");
    const ordinary = post("ordinary", { category: "free" });

    expect(excludeFeaturedPostsWhenFeedRemains(
      [featured, ordinary],
      [featured],
    ).map((item) => item.id)).toEqual(["ordinary"]);
  });

  it("keeps the main feed non-empty when every preview row is featured", () => {
    const only = post("only");

    expect(excludeFeaturedPostsWhenFeedRemains([only], [only])).toEqual([only]);
  });
});
