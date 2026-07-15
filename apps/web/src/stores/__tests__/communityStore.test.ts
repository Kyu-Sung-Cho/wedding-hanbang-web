import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCommunityStore } from "../communityStore";
import type { CommentWithAuthor, CommunityProfile, PostDetail, PostWithAuthor } from "@/types/community.types";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function post(id: string, createdAt: string): PostWithAuthor {
  return {
    id,
    author_id: "author-1",
    viewer_is_author: false,
    category: "free",
    title: id,
    content: "",
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
    viewer_is_author: false,
    content,
    upvote_count: 0,
    is_deleted: false,
    created_at: "2026-06-15T00:00:00.000Z",
    updated_at: "2026-06-15T00:00:00.000Z",
    author,
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

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/community/posts?sort=new&page=1&limit=20",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(useCommunityStore.getState().posts[0].id).toBe("network-new");
  });

  it("does not disguise a malformed feed response as a genuine empty feed", async () => {
    const existingPost = post("already-rendered", "2026-06-15T00:00:00.000Z");
    useCommunityStore.setState({ posts: [existingPost], total: 1 });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await useCommunityStore.getState().fetchPosts(true);

    const state = useCommunityStore.getState();
    expect(state.posts.map((item) => item.id)).toEqual(["already-rendered"]);
    expect(state.total).toBe(1);
    expect(state.errorMessage).toBeTruthy();
  });

  it("does not turn a malformed successful vote response into zero counts", async () => {
    const existingPost = {
      ...post("vote-target", "2026-06-15T00:00:00.000Z"),
      upvote_count: 7,
      downvote_count: 2,
    };
    useCommunityStore.setState({ posts: [existingPost] });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    await expect(
      useCommunityStore.getState().votePost(existingPost.id, 1),
    ).rejects.toThrow();

    expect(useCommunityStore.getState().posts[0]).toMatchObject({
      upvote_count: 7,
      downvote_count: 2,
    });
  });

  it("does not claim create, update, or delete success from malformed 2xx bodies", async () => {
    const existingPost = post("post-existing", "2026-06-15T00:00:00.000Z");
    useCommunityStore.setState({ posts: [existingPost] });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    const created = await useCommunityStore.getState().createPost({
      category: "free",
      title: "title",
      content: "content",
      visibility: "public",
      ad_disclosure: "general",
    });
    const updated = await useCommunityStore.getState().updatePost(existingPost.id, {
      title: "updated",
    });
    const deleted = await useCommunityStore.getState().deletePost(existingPost.id);

    expect(created).toBeNull();
    expect(updated).toBe(false);
    expect(deleted).toBe(false);
    expect(useCommunityStore.getState().posts.map((item) => item.id)).toContain(existingPost.id);
    expect(useCommunityStore.getState().errorMessage).toBeTruthy();
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

  it("rebuilds the selected feed without reusing another identity's cached projections", async () => {
    useCommunityStore.getState().setCategory("tips_v2");
    useCommunityStore.getState().setSort("hot");
    const cachedPost = {
      ...post("previous-user-bookmark", "2026-06-15T00:00:00.000Z"),
      user_bookmarked: true,
    };
    const networkPost = post("current-user-feed", "2026-06-16T00:00:00.000Z");
    const cacheKey = "community:feed:tips_v2:hot:_:_:_";
    sessionStorage.setItem(
      cacheKey,
      JSON.stringify({ posts: [cachedPost], total: 1, hasMore: false, ts: Date.now() }),
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ posts: [networkPost], total: 1, hasMore: false }),
    });

    await useCommunityStore.getState().refreshAfterAuthChange();

    expect(sessionStorage.getItem(cacheKey)).not.toContain("previous-user-bookmark");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/community/posts?category=tips_v2&sort=hot&page=1&limit=20",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(useCommunityStore.getState().currentCategory).toBe("tips_v2");
    expect(useCommunityStore.getState().currentSort).toBe("hot");
    expect(useCommunityStore.getState().posts[0].id).toBe("current-user-feed");
  });

  it("ignores a late feed response after the active selection changes", async () => {
    const stalePost = post("stale-all-feed", "2026-06-15T00:00:00.000Z");
    const currentPost = post("current-budget-feed", "2026-06-16T00:00:00.000Z");
    let resolveStaleFetch: (value: unknown) => void = () => {
      throw new Error("stale feed fetch was not started");
    };
    mockFetch
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStaleFetch = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ posts: [currentPost], total: 1, hasMore: false }),
      });

    const staleRequest = useCommunityStore.getState().fetchPosts(true);
    useCommunityStore.getState().setCategory("tips_v2");
    const currentRequest = useCommunityStore.getState().fetchPosts(true);
    await currentRequest;
    resolveStaleFetch({
      ok: true,
      json: async () => ({ posts: [stalePost], total: 1, hasMore: false }),
    });
    await staleRequest;

    expect(useCommunityStore.getState().currentCategory).toBe("tips_v2");
    expect(useCommunityStore.getState().posts.map((item) => item.id)).toEqual([
      "current-budget-feed",
    ]);
  });

  it("applies the current user's new nickname to cached community state", () => {
    const oldAuthor = communityProfile("author-1", "old-name");
    const otherAuthor = communityProfile("author-2", "other-name");
    const ownPost = {
      ...post("own-post", "2026-06-15T00:00:00.000Z"),
      author: oldAuthor,
      viewer_is_author: true,
    };
    const otherPost = {
      ...post("other-post", "2026-06-15T00:00:00.000Z"),
      author_id: otherAuthor.user_id,
      author: otherAuthor,
    };
    const currentPost = { ...ownPost } as PostDetail;
    const ownReply = comment("reply-1", oldAuthor);
    const ownComment = comment("comment-1", oldAuthor, [ownReply]);
    ownReply.viewer_is_author = true;
    ownComment.viewer_is_author = true;
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

    useCommunityStore.getState().applyConfirmedOwnCommunityNickname("new-name");

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

  it("removes a newly muted author from memory and every feed cache immediately", () => {
    const mutedAuthor = communityProfile("author-1", "muted");
    const visibleAuthor = communityProfile("author-2", "visible");
    const mutedPost = { ...post("muted-post", "2026-06-15T00:00:00.000Z"), author: mutedAuthor };
    const visiblePost = {
      ...post("visible-post", "2026-06-16T00:00:00.000Z"),
      author_id: visibleAuthor.user_id,
      author: visibleAuthor,
    };
    sessionStorage.setItem(
      "community:feed:all:hot:_:_:_",
      JSON.stringify({ posts: [mutedPost, visiblePost], total: 2, hasMore: false, ts: Date.now() }),
    );
    useCommunityStore.setState({
      posts: [mutedPost, visiblePost],
      total: 2,
      currentPost: mutedPost as PostDetail,
      comments: [comment("muted-comment", mutedAuthor), comment("visible-comment", visibleAuthor)],
      commentsPostId: mutedPost.id,
    });

    useCommunityStore.getState().hideAuthorLocally(mutedAuthor.user_id);

    const state = useCommunityStore.getState();
    expect(state.posts.map((item) => item.id)).toEqual(["visible-post"]);
    expect(state.total).toBe(1);
    expect(state.currentPost?.id).toBe("muted-post");
    expect(state.comments).toEqual([]);
    expect(state.commentsPostId).toBeNull();
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

  it("preserves already rendered comments and exposes a retryable error when refresh fails", async () => {
    const author = communityProfile("author-1", "tester");
    const existing = comment("comment-existing", author, [], "post-1");
    useCommunityStore.setState({
      comments: [existing],
      commentsPostId: "post-1",
      commentsLoadStatus: "ready",
      commentsLoadError: null,
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "댓글 조회가 일시적으로 불가능합니다." }),
    });

    const ok = await useCommunityStore.getState().fetchComments("post-1");

    const state = useCommunityStore.getState();
    expect(ok).toBe(false);
    expect(state.comments.map((item) => item.id)).toEqual(["comment-existing"]);
    expect(state.commentsLoadStatus).toBe("error");
    expect(state.commentsLoadError).toContain("일시적으로");
  });

  it("marks an initial comments failure as an error instead of a genuine empty result", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    const ok = await useCommunityStore.getState().fetchComments("post-1");

    const state = useCommunityStore.getState();
    expect(ok).toBe(false);
    expect(state.comments).toEqual([]);
    expect(state.commentsPostId).toBe("post-1");
    expect(state.commentsLoadStatus).toBe("error");
    expect(state.commentsLoadError).toBeTruthy();
  });

  it("has no dormant new-comment mutation while publishing is retired", () => {
    const author = communityProfile("author-1", "tester");
    const existing = comment("comment-existing", author, [], "post-1", "keep me");
    useCommunityStore.setState({
      comments: [existing],
      commentsPostId: "post-1",
      commentsLoadStatus: "ready",
      commentsLoadError: null,
    });

    expect(useCommunityStore.getState()).not.toHaveProperty("createComment");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(useCommunityStore.getState().comments.map((item) => item.id)).toEqual(["comment-existing"]);
    expect(useCommunityStore.getState().commentsLoadStatus).toBe("ready");
  });

  it("leaves the existing comment untouched when edit or delete is rejected", async () => {
    const author = communityProfile("author-1", "tester");
    const existing = comment("comment-1", author, [], "post-1", "keep me");
    useCommunityStore.setState({ comments: [existing], commentsPostId: "post-1" });
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    const edited = await useCommunityStore.getState().updateComment("comment-1", "replace me");
    const deleted = await useCommunityStore.getState().deleteComment("comment-1");

    const stored = useCommunityStore.getState().comments[0];
    expect(edited).toBe(false);
    expect(deleted).toBe(false);
    expect(stored.content).toBe("keep me");
    expect(stored.is_deleted).toBe(false);
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

  it("keeps a post request failure distinct from a missing post", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "게시글 조회가 일시적으로 불가능합니다." }),
    });

    await useCommunityStore.getState().fetchPostDetail("post-1");

    const state = useCommunityStore.getState();
    expect(state.currentPost).toBeNull();
    expect(state.postLoadStatus).toBe("error");
    expect(state.postLoadError).toContain("일시적으로");
  });

  it("uses the missing state only for an explicit 404 response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "게시글을 찾을 수 없습니다." }),
    });

    await useCommunityStore.getState().fetchPostDetail("post-1");

    const state = useCommunityStore.getState();
    expect(state.currentPost).toBeNull();
    expect(state.postLoadStatus).toBe("not_found");
    expect(state.postLoadError).toBeNull();
  });
});
