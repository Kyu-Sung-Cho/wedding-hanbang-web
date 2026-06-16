import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCommunityStore } from "../communityStore";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function post(id: string, createdAt: string) {
  return {
    id,
    author_id: "author-1",
    category: "free",
    title: id,
    content: "",
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
    created_at: createdAt,
    updated_at: createdAt,
    author: {
      user_id: "author-1",
      nickname: "tester",
      avatar_url: null,
      rank: "sprout",
      wedding_year: null,
      wedding_month: null,
    },
    user_vote: null,
    user_bookmarked: false,
    poll: null,
  };
}

describe("useCommunityStore feed cache", () => {
  beforeEach(() => {
    useCommunityStore.getState().reset();
    sessionStorage.clear();
    mockFetch.mockReset();
  });

  it("revalidates latest feed even when a fresh cached feed exists", async () => {
    const cachedPost = post("cached-old", "2026-06-15T00:00:00.000Z");
    const networkPost = post("network-new", "2026-06-16T00:00:00.000Z");
    sessionStorage.setItem(
      "community:feed:all:new:_:_:_",
      JSON.stringify({ posts: [cachedPost], total: 1, hasMore: false, ts: Date.now() })
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ posts: [networkPost], total: 1, hasMore: false }),
    });

    await useCommunityStore.getState().fetchPosts(true);

    expect(mockFetch).toHaveBeenCalledWith("/api/community/posts?sort=new&page=1&limit=20");
    expect(useCommunityStore.getState().posts[0].id).toBe("network-new");
  });

  it("keeps the short fresh-cache skip for non-latest feeds", async () => {
    useCommunityStore.getState().setSort("hot");
    const cachedPost = post("cached-hot", "2026-06-15T00:00:00.000Z");
    sessionStorage.setItem(
      "community:feed:all:hot:_:_:_",
      JSON.stringify({ posts: [cachedPost], total: 1, hasMore: false, ts: Date.now() })
    );

    await useCommunityStore.getState().fetchPosts(true);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(useCommunityStore.getState().posts[0].id).toBe("cached-hot");
  });
});
