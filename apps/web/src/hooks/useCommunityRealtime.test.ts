import { describe, expect, it } from "vitest";
import {
  decideCommunityRealtimeChange,
  matchesCommunityRealtimeFeed,
  reduceCommunityRealtimeFeed,
  type CommunityRealtimeFeedFilter,
} from "./useCommunityRealtime";
import type { PostWithAuthor } from "@/types/community.types";

const baseFilter: CommunityRealtimeFeedFilter = {
  category: null,
  sort: "new",
  period: "all",
  tag: null,
  authorId: null,
};

const basePost: Record<string, unknown> = {
  id: "post-1",
  author_id: "author-1",
  category: "is_normal",
  visibility: "public",
  under_review: false,
  ad_disclosure: "general",
  tags: ["계약", "추가금"],
  is_resolved: false,
  comment_count: 0,
  created_at: "2026-07-31T00:00:00.000Z",
};

function visiblePost(overrides: Partial<PostWithAuthor> = {}): PostWithAuthor {
  return {
    id: "post-1",
    author_id: "author-1",
    content_origin: "member",
    category: "is_normal",
    title: "계약 고민",
    content: "내용",
    images: [],
    slides: null,
    visibility: "public",
    ad_disclosure: "general",
    sponsorship_detail: null,
    ai_comment: null,
    is_resolved: false,
    is_verified_review: false,
    verification_doc_url: null,
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
    tags: ["계약"],
    created_at: "2026-07-31T00:00:00.000Z",
    updated_at: "2026-07-31T00:00:00.000Z",
    author: {
      user_id: "author-1",
      nickname: "예비부부",
      avatar_url: null,
      rank: "sprout",
      wedding_year: null,
      wedding_month: null,
      wedding_completed: false,
      progress_percent: 0,
      region: null,
      post_count: 1,
      comment_count: 0,
      total_upvotes_received: 0,
      warning_count: 0,
      is_suspended: false,
      created_at: "2026-07-31T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("matchesCommunityRealtimeFeed", () => {
  it("requires a public, non-review post matching category, tag, and author", () => {
    const filter: CommunityRealtimeFeedFilter = {
      ...baseFilter,
      category: "is_normal",
      tag: "계약",
      authorId: "author-1",
    };

    expect(matchesCommunityRealtimeFeed(basePost, filter)).toBe(true);
    expect(matchesCommunityRealtimeFeed({ ...basePost, visibility: "members" }, filter)).toBe(false);
    expect(matchesCommunityRealtimeFeed({ ...basePost, under_review: true }, filter)).toBe(false);
    expect(matchesCommunityRealtimeFeed({ ...basePost, category: "ama" }, filter)).toBe(false);
    expect(matchesCommunityRealtimeFeed({ ...basePost, tags: ["예산"] }, filter)).toBe(false);
    expect(matchesCommunityRealtimeFeed({ ...basePost, author_id: "author-2" }, filter)).toBe(false);
  });

  it("allows disclosed posts in new but only general posts in ranked and status feeds", () => {
    const sponsored = { ...basePost, ad_disclosure: "sponsored" };

    expect(matchesCommunityRealtimeFeed(sponsored, baseFilter)).toBe(true);
    for (const sort of ["hot", "top", "unanswered", "resolved"] as const) {
      expect(
        matchesCommunityRealtimeFeed(sponsored, { ...baseFilter, sort }),
      ).toBe(false);
    }
  });

  it("matches unanswered and resolved only for explicit question categories", () => {
    const unanswered = { ...baseFilter, sort: "unanswered" } as const;
    const resolved = { ...baseFilter, sort: "resolved" } as const;

    expect(matchesCommunityRealtimeFeed(basePost, unanswered)).toBe(true);
    expect(
      matchesCommunityRealtimeFeed({ ...basePost, category: "ama" }, unanswered),
    ).toBe(true);
    expect(
      matchesCommunityRealtimeFeed({ ...basePost, category: "free" }, unanswered),
    ).toBe(false);
    expect(
      matchesCommunityRealtimeFeed({ ...basePost, comment_count: 1 }, unanswered),
    ).toBe(false);
    expect(
      matchesCommunityRealtimeFeed({ ...basePost, is_resolved: true }, unanswered),
    ).toBe(false);

    expect(matchesCommunityRealtimeFeed(basePost, resolved)).toBe(false);
    expect(
      matchesCommunityRealtimeFeed({ ...basePost, is_resolved: true }, resolved),
    ).toBe(true);
  });

  it("never declares personalized feeds safe for direct insertion", () => {
    expect(
      matchesCommunityRealtimeFeed(basePost, { ...baseFilter, sort: "my_posts" }),
    ).toBe(false);
    expect(
      matchesCommunityRealtimeFeed(basePost, { ...baseFilter, sort: "my_cohort" }),
    ).toBe(false);
  });
});

describe("decideCommunityRealtimeChange", () => {
  const unansweredFilter: CommunityRealtimeFeedFilter = {
    ...baseFilter,
    sort: "unanswered",
  };

  it("removes a visible question when an update makes it leave the active status", () => {
    expect(
      decideCommunityRealtimeChange(
        "UPDATE",
        { ...basePost, comment_count: 1 },
        unansweredFilter,
        true,
      ),
    ).toBe("remove");
    expect(
      decideCommunityRealtimeChange(
        "UPDATE",
        { ...basePost, is_resolved: true },
        unansweredFilter,
        true,
      ),
    ).toBe("remove");
  });

  it("refetches matching inserts and newly-entered updates that are not visible", () => {
    expect(
      decideCommunityRealtimeChange("INSERT", basePost, unansweredFilter, false),
    ).toBe("refetch");
    expect(
      decideCommunityRealtimeChange("UPDATE", basePost, unansweredFilter, false),
    ).toBe("refetch");
  });

  it("merges visible matches and ignores absent non-matches", () => {
    expect(
      decideCommunityRealtimeChange("UPDATE", basePost, unansweredFilter, true),
    ).toBe("merge");
    expect(
      decideCommunityRealtimeChange(
        "UPDATE",
        { ...basePost, category: "tour_review" },
        unansweredFilter,
        false,
      ),
    ).toBe("ignore");
  });

  it("uses refetch instead of direct insertion for personalized feeds", () => {
    expect(
      decideCommunityRealtimeChange(
        "INSERT",
        basePost,
        { ...baseFilter, sort: "my_posts" },
        false,
      ),
    ).toBe("refetch");
    expect(
      decideCommunityRealtimeChange(
        "UPDATE",
        basePost,
        { ...baseFilter, sort: "my_cohort" },
        true,
      ),
    ).toBe("refetch");
  });
});

describe("reduceCommunityRealtimeFeed", () => {
  it("merges is_resolved into a visible post", () => {
    const post = visiblePost();
    const next = reduceCommunityRealtimeFeed(
      { posts: [post], total: 1 },
      { ...basePost, is_resolved: true },
      "merge",
    );

    expect(next.posts[0]?.is_resolved).toBe(true);
    expect(next.total).toBe(1);
    expect(next.posts[0]?.author).toBe(post.author);
  });

  it("removes only a visible post and decrements total without going below zero", () => {
    const next = reduceCommunityRealtimeFeed(
      { posts: [visiblePost()], total: 1 },
      basePost,
      "remove",
    );
    expect(next.posts).toHaveLength(0);
    expect(next.total).toBe(0);

    const unchanged = reduceCommunityRealtimeFeed(
      { posts: [], total: 0 },
      basePost,
      "remove",
    );
    expect(unchanged.total).toBe(0);
  });
});
