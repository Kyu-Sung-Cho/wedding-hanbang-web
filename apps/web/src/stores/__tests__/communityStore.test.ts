import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCommunityStore } from "../communityStore";
import type { CommentWithAuthor, CommunityProfile, PostDetail, PostWithAuthor } from "@/types/community.types";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function post(id: string, createdAt: string): PostWithAuthor {
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
    tags: [],
    cost_data: null,
    created_at: createdAt,
    updated_at: createdAt,
    author: communityProfile("author-1", "tester"),
    user_vote: null,
    user_bookmarked: false,
    poll: null,
  };
}

function communityProfile(userId: string, nickname: string): CommunityProfile {
  return {
    user_id: userId,
    nickname,
    avatar_url: null,
    rank: "sprout",
    wedding_year: null,
    wedding_month: null,
    wedding_completed: false,
    progress_percent: 0,
    region: null,
    post_count: 0,
    comment_count: 0,
    total_upvotes_received: 0,
    warning_count: 0,
    is_suspended: false,
    created_at: "2026-06-15T00:00:00.000Z",
  };
}

function comment(
  id: string,
  author: CommunityProfile,
  replies: CommentWithAuthor[] = [],
  postId = "post-1",
  content = "comment"
): CommentWithAuthor {
  return {
    id,
    post_id: postId,
    parent_id: null,
    author_id: author.user_id,
    content,
    upvote_count: 0,
    is_deleted: false,
    created_at: "2026-06-15T00:00:00.000Z",
    updated_at: "2026-06-15T00:00:00.000Z",
    author,
    user_vote: null,
    replies,
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

  it("applies the current user's new nickname to cached community state", () => {
    const oldAuthor = communityProfile("author-1", "old-name");
    const otherAuthor = communityProfile("author-2", "other-name");
    const ownPost = { ...post("own-post", "2026-06-15T00:00:00.000Z"), author: oldAuthor };
    const otherPost = {
      ...post("other-post", "2026-06-15T00:00:00.000Z"),
      author_id: otherAuthor.user_id,
      author: otherAuthor,
    };
    const currentPost = { ...ownPost, vendor_details: [] } as PostDetail;
    const ownReply = comment("reply-1", oldAuthor);
    const ownComment = comment("comment-1", oldAuthor, [ownReply]);
    const otherComment = comment("comment-2", otherAuthor);

    sessionStorage.setItem(
      "community:feed:all:hot:_:_:_",
      JSON.stringify({ posts: [ownPost], total: 1, hasMore: false, ts: Date.now() })
    );
    useCommunityStore.setState({
      communityProfile: oldAuthor,
      posts: [ownPost, otherPost],
      currentPost,
      comments: [ownComment, otherComment],
    });

    useCommunityStore.getState().applyOwnNickname("author-1", "new-name");

    const state = useCommunityStore.getState();
    expect(state.communityProfile?.nickname).toBe("new-name");
    expect(state.posts[0].author.nickname).toBe("new-name");
    expect(state.posts[1].author.nickname).toBe("other-name");
    expect(state.currentPost?.author.nickname).toBe("new-name");
    expect(state.comments[0].author.nickname).toBe("new-name");
    expect(state.comments[0].replies?.[0].author.nickname).toBe("new-name");
    expect(state.comments[1].author.nickname).toBe("other-name");
    expect(sessionStorage.getItem("community:feed:all:hot:_:_:_")).toBeNull();
  });

  it("clears stale comments immediately when loading a different post", async () => {
    const author = communityProfile("author-1", "tester");
    const staleComment = comment("comment-old", author, [], "post-1");
    const freshComment = comment("comment-new", author, [], "post-2");
    useCommunityStore.setState({
      comments: [staleComment],
      commentsPostId: "post-1",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [freshComment] }),
    });

    const promise = useCommunityStore.getState().fetchComments("post-2");

    expect(useCommunityStore.getState().comments).toEqual([]);
    expect(useCommunityStore.getState().commentsPostId).toBe("post-2");

    await promise;

    expect(useCommunityStore.getState().comments.map((c) => c.id)).toEqual(["comment-new"]);
  });

  it("ignores a late comments response for a post that is no longer active", async () => {
    const author = communityProfile("author-1", "tester");
    const oldComment = comment("comment-old", author, [], "post-1");
    const newComment = comment("comment-new", author, [], "post-2");
    let resolveOldFetch: (value: unknown) => void = () => {
      throw new Error("old comments fetch was not started");
    };

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("postId=post-1")) {
        return new Promise((resolve) => {
          resolveOldFetch = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ comments: [newComment] }),
      });
    });

    const oldPromise = useCommunityStore.getState().fetchComments("post-1");
    const newPromise = useCommunityStore.getState().fetchComments("post-2");

    await newPromise;
    resolveOldFetch({
      ok: true,
      json: async () => ({ comments: [oldComment] }),
    });
    await oldPromise;

    const state = useCommunityStore.getState();
    expect(state.commentsPostId).toBe("post-2");
    expect(state.comments.map((c) => c.id)).toEqual(["comment-new"]);
  });

  it("updates edited comments inside the current comment tree", async () => {
    const author = communityProfile("author-1", "tester");
    const reply = {
      ...comment("reply-1", author, [], "post-1", "old reply"),
      parent_id: "comment-1",
    };
    const topLevel = comment("comment-1", author, [reply], "post-1", "old comment");
    useCommunityStore.setState({
      comments: [topLevel],
      commentsPostId: "post-1",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        comment: {
          id: "reply-1",
          content: "나을듯욯ㅎ",
          updated_at: "2026-06-15T01:00:00.000Z",
        },
      }),
    });

    const ok = await useCommunityStore.getState().updateComment("reply-1", "  나을듯욯ㅎ  ");

    expect(ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/community/comments/reply-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ content: "나을듯욯ㅎ" }),
      })
    );
    const editedReply = useCommunityStore.getState().comments[0].replies?.[0];
    expect(editedReply?.content).toBe("나을듯욯ㅎ");
    expect(editedReply?.updated_at).toBe("2026-06-15T01:00:00.000Z");
  });

  it("does not submit empty comment edits", async () => {
    const ok = await useCommunityStore.getState().updateComment("comment-1", "   ");

    expect(ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
