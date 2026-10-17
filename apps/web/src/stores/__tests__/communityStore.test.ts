import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCommunityStore } from "../communityStore";
import { scopedCommunitySessionCacheKey } from "@/lib/community/viewerPrivacyCache";
import type { CommentWithAuthor, CommunityProfile, PostDetail, PostWithAuthor } from "@/types/community.types";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const guestFeedCacheKey = (key: string) =>
  scopedCommunitySessionCacheKey(key, null);

function post(id: string, createdAt: string): PostWithAuthor {
  return {
    id,
    author_id: "author-1",
    content_origin: "member",
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
    content_origin: "member",
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
    localStorage.clear();
    mockFetch.mockReset();
  });

  it("purges A's private community state and browser caches before binding B or guest", () => {
    useCommunityStore.getState().bindViewer("user-a");
    useCommunityStore.setState({
      posts: [post("a-under-review", "2026-06-15T00:00:00.000Z")],
      currentPost: {
        ...post("a-detail", "2026-06-15T00:00:00.000Z"),
        vendor_details: [],
      } as PostDetail,
      communityProfile: communityProfile("user-a", "A"),
    });
    sessionStorage.setItem("community:viewer:user-a:feed:my_posts", "A-feed");
    sessionStorage.setItem("community:viewer:user-a:trending", "A-trending");
    sessionStorage.setItem("community:viewer:user-a:landing", "A-landing");
    localStorage.setItem("community:post-draft:v2:user-a", "A-draft");
    localStorage.setItem("community_post_draft", "A-legacy-draft");

    useCommunityStore.getState().bindViewer("user-b");

    expect(useCommunityStore.getState()).toMatchObject({
      viewerId: "user-b",
      posts: [],
      currentPost: null,
      communityProfile: null,
    });
    expect(
      Array.from({ length: sessionStorage.length }, (_, index) =>
        sessionStorage.key(index),
      ).filter((key) => key?.startsWith("community:")),
    ).toEqual([]);
    expect(localStorage.getItem("community:post-draft:v2:user-a")).toBeNull();
    expect(localStorage.getItem("community_post_draft")).toBeNull();

    useCommunityStore.setState({
      posts: [post("b-private", "2026-06-16T00:00:00.000Z")],
    });
    useCommunityStore.getState().bindViewer(null);

    expect(useCommunityStore.getState().viewerId).toBeNull();
    expect(useCommunityStore.getState().posts).toEqual([]);
  });

  it("ignores an A feed response that finishes after the store is rebound to B", async () => {
    let resolveA: ((value: unknown) => void) | undefined;
    const aResponse = new Promise((resolve) => {
      resolveA = resolve;
    });
    mockFetch.mockReturnValueOnce(aResponse);

    useCommunityStore.getState().bindViewer("user-a");
    useCommunityStore.getState().setSort("my_posts");
    const pendingA = useCommunityStore.getState().fetchPosts(true);

    useCommunityStore.getState().bindViewer("user-b");
    resolveA?.({
      ok: true,
      json: async () => ({
        posts: [post("a-private", "2026-06-15T00:00:00.000Z")],
        total: 1,
        hasMore: false,
      }),
    });
    await pendingA;

    expect(useCommunityStore.getState().viewerId).toBe("user-b");
    expect(useCommunityStore.getState().posts).toEqual([]);
    const cachedValues = Array.from(
      { length: sessionStorage.length },
      (_, index) => {
        const key = sessionStorage.key(index);
        return key ? sessionStorage.getItem(key) : null;
      },
    );
    expect(JSON.stringify(cachedValues)).not.toContain("a-private");
  });

  it("ignores late A detail, profile, and mutation receipts after binding B", async () => {
    let resolveDetail: ((value: unknown) => void) | undefined;
    let resolveProfile: ((value: unknown) => void) | undefined;
    let resolveVote: ((value: unknown) => void) | undefined;
    mockFetch
      .mockReturnValueOnce(new Promise((resolve) => { resolveDetail = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveProfile = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveVote = resolve; }));

    useCommunityStore.getState().bindViewer("user-a");
    useCommunityStore.setState({
      posts: [post("shared-post", "2026-06-15T00:00:00.000Z")],
    });
    const detailRequest = useCommunityStore.getState().fetchPostDetail("a-detail");
    const profileRequest = useCommunityStore.getState().fetchProfile();
    const voteRequest = useCommunityStore.getState().votePost("shared-post", 1);

    useCommunityStore.getState().bindViewer("user-b");
    useCommunityStore.setState({
      posts: [post("shared-post", "2026-06-16T00:00:00.000Z")],
    });
    resolveDetail?.({
      ok: true,
      json: async () => ({
        ...post("a-detail", "2026-06-15T00:00:00.000Z"),
        vendor_details: [],
      }),
    });
    resolveProfile?.({
      ok: true,
      json: async () => ({ profile: communityProfile("user-a", "A") }),
    });
    resolveVote?.({
      ok: true,
      json: async () => ({ upvote_count: 99, downvote_count: 0 }),
    });
    await Promise.all([detailRequest, profileRequest, voteRequest]);

    const state = useCommunityStore.getState();
    expect(state.viewerId).toBe("user-b");
    expect(state.currentPost).toBeNull();
    expect(state.communityProfile).toBeNull();
    expect(state.posts[0]).toMatchObject({
      id: "shared-post",
      upvote_count: 0,
      user_vote: null,
    });
  });

  it("keeps a confirmed retry when an older detail GET succeeds later in the same viewer epoch", async () => {
    let resolveOld: ((value: unknown) => void) | undefined;
    const latest = { ...post("detail-1", "2026-10-18T00:00:00Z"), title: "NEW_CONFIRMED" };
    mockFetch.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ ok: true, json: async () => latest });
    useCommunityStore.getState().bindViewer("user-b");
    const pendingOld = useCommunityStore.getState().fetchPostDetail("detail-1");
    await useCommunityStore.getState().fetchPostDetail("detail-1");
    resolveOld?.({ ok: true, json: async () => ({ ...latest, title: "OLD_LATE" }) });
    await pendingOld;
    expect(useCommunityStore.getState().currentPost?.title).toBe("NEW_CONFIRMED");
    expect(useCommunityStore.getState().postLoading).toBe(false);
    expect(useCommunityStore.getState().errorMessage).toBeNull();
  });

  it("ignores an old detail failure after a newer successful retry", async () => {
    let rejectOld: ((reason: Error) => void) | undefined;
    const latest = { ...post("detail-1", "2026-10-18T00:00:00Z"), title: "NEW_CONFIRMED" };
    mockFetch.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectOld = reject; }))
      .mockResolvedValueOnce({ ok: true, json: async () => latest });
    useCommunityStore.getState().bindViewer("user-b");
    const pendingOld = useCommunityStore.getState().fetchPostDetail("detail-1");
    await useCommunityStore.getState().fetchPostDetail("detail-1");
    rejectOld?.(new Error("late failed request"));
    await pendingOld;
    expect(useCommunityStore.getState().currentPost?.title).toBe("NEW_CONFIRMED");
    expect(useCommunityStore.getState().errorMessage).toBeNull();
  });

  it("revalidates latest feed even when a fresh cached feed exists", async () => {
    const cachedPost = post("cached-old", "2026-06-15T00:00:00.000Z");
    const networkPost = post("network-new", "2026-06-16T00:00:00.000Z");
    sessionStorage.setItem(
      guestFeedCacheKey("community:feed:all:new:_:_:_"),
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
      guestFeedCacheKey("community:feed:all:hot:_:_:_"),
      JSON.stringify({ posts: [cachedPost], total: 1, hasMore: false, ts: Date.now() })
    );

    await useCommunityStore.getState().fetchPosts(true);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(useCommunityStore.getState().posts[0].id).toBe("cached-hot");
  });

  it("always revalidates a fresh unanswered cache because reply state changes membership", async () => {
    useCommunityStore.getState().setSort("unanswered");
    const cachedPost = {
      ...post("cached-question", "2026-06-15T00:00:00.000Z"),
      category: "is_normal" as const,
    };
    const networkPost = {
      ...post("network-question", "2026-06-16T00:00:00.000Z"),
      category: "ama" as const,
    };
    sessionStorage.setItem(
      guestFeedCacheKey("community:feed:all:unanswered:_:_:_"),
      JSON.stringify({ posts: [cachedPost], total: 1, hasMore: false, ts: Date.now() }),
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ posts: [networkPost], total: 1, hasMore: false }),
    });

    await useCommunityStore.getState().fetchPosts(true);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/community/posts?sort=unanswered&page=1&limit=20",
    );
    expect(useCommunityStore.getState().posts[0].id).toBe("network-question");
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
      guestFeedCacheKey("community:feed:all:hot:_:_:_"),
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
    expect(sessionStorage.getItem(guestFeedCacheKey("community:feed:all:hot:_:_:_"))).toBeNull();
  });

  it("initializes a missing community profile with an explicit POST and unwraps it", async () => {
    const createdProfile = communityProfile("author-1", "safe-default");
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ profile: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ profile: createdProfile }),
      });

    await useCommunityStore.getState().fetchProfile();

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "/api/community/profile",
      { cache: "no-store" },
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "/api/community/profile",
      { method: "POST" },
    );
    expect(useCommunityStore.getState().communityProfile).toEqual(createdProfile);
  });

  it("sends explicit bookmark intent so a retry cannot invert the result", async () => {
    const target = {
      ...post("post-bookmark", "2026-06-15T00:00:00.000Z"),
      user_bookmarked: false,
      bookmark_count: 2,
    };
    useCommunityStore.setState({ posts: [target] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ bookmarked: true, bookmark_count: 3 }),
    });

    await useCommunityStore.getState().toggleBookmark(target.id);

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/community/posts/${target.id}/bookmark`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarked: true }),
      },
    );
    expect(useCommunityStore.getState().posts[0]).toMatchObject({
      user_bookmarked: true,
      bookmark_count: 3,
    });
  });

  it("merges a resolved post response into both the feed and current detail", async () => {
    const question = {
      ...post("question-1", "2026-06-15T00:00:00.000Z"),
      category: "is_normal" as const,
    };
    const currentPost = {
      ...question,
      vendor_details: [],
    } as PostDetail;
    useCommunityStore.setState({
      posts: [question],
      currentPost,
    });
    sessionStorage.setItem(
      guestFeedCacheKey("community:feed:all:new:_:_:_"),
      JSON.stringify({ posts: [question], total: 1, hasMore: false, ts: Date.now() }),
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        post: {
          id: question.id,
          is_resolved: true,
          updated_at: "2026-06-16T00:00:00.000Z",
        },
      }),
    });

    const success = await useCommunityStore
      .getState()
      .updatePost(question.id, { is_resolved: true });

    expect(success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/community/posts/${question.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_resolved: true }),
      },
    );
    expect(useCommunityStore.getState().posts[0]).toEqual(
      expect.objectContaining({
        id: question.id,
        is_resolved: true,
        author: question.author,
      }),
    );
    expect(useCommunityStore.getState().currentPost).toEqual(
      expect.objectContaining({
        id: question.id,
        is_resolved: true,
        vendor_details: [],
      }),
    );
    expect(sessionStorage.getItem(guestFeedCacheKey("community:feed:all:new:_:_:_"))).toBeNull();
  });

  it("keeps the current post unchanged when a resolution update fails", async () => {
    const question = {
      ...post("question-1", "2026-06-15T00:00:00.000Z"),
      category: "ama" as const,
    };
    useCommunityStore.setState({
      posts: [question],
      currentPost: { ...question, vendor_details: [] } as PostDetail,
    });
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "상태를 저장하지 못했습니다." }),
    });

    const success = await useCommunityStore
      .getState()
      .updatePost(question.id, { is_resolved: true });

    expect(success).toBe(false);
    expect(useCommunityStore.getState().posts[0].is_resolved).toBe(false);
    expect(useCommunityStore.getState().currentPost?.is_resolved).toBe(false);
    expect(useCommunityStore.getState().errorMessage).toBe(
      "상태를 저장하지 못했습니다.",
    );
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

  it("removes a question from the unanswered feed immediately after the first answer", async () => {
    const question = {
      ...post("question-1", "2026-06-15T00:00:00.000Z"),
      category: "is_normal" as const,
    };
    useCommunityStore.setState({
      currentSort: "unanswered",
      posts: [question],
      total: 1,
      currentPost: { ...question, vendor_details: [] } as PostDetail,
    });
    sessionStorage.setItem(
      guestFeedCacheKey("community:feed:all:unanswered:_:_:_"),
      JSON.stringify({ posts: [question], total: 1, hasMore: false, ts: Date.now() }),
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [] }),
    });

    const ok = await useCommunityStore.getState().createComment({
      post_id: question.id,
      content: "제가 겪은 범위에서는 이 항목부터 확인했어요.",
    });

    expect(ok).toBe(true);
    expect(useCommunityStore.getState().posts).toEqual([]);
    expect(useCommunityStore.getState().total).toBe(0);
    expect(useCommunityStore.getState().currentPost?.comment_count).toBe(1);
    expect(sessionStorage.getItem(guestFeedCacheKey("community:feed:all:unanswered:_:_:_"))).toBeNull();
  });

  it("forwards the caller's stable idempotency key on a comment retry", async () => {
    const stableKey = "70000000-0000-4000-8000-000000000001";
    mockFetch
      .mockRejectedValueOnce(new Error("network interrupted"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ post_comment_count: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ comments: [] }),
      });
    const input = {
      post_id: "post-1",
      content: "같은 제출을 다시 시도합니다.",
    };

    const first = await useCommunityStore.getState().createComment(
      input,
      { idempotencyKey: stableKey },
    );
    const retry = await useCommunityStore.getState().createComment(
      input,
      { idempotencyKey: stableKey },
    );

    expect(first).toBe(false);
    expect(retry).toBe(true);
    const commentCalls = mockFetch.mock.calls.filter(
      ([url]) => url === "/api/community/comments",
    );
    expect(commentCalls).toHaveLength(2);
    for (const [, init] of commentCalls) {
      expect(init).toEqual(expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": stableKey,
        }),
      }));
    }
  });

  it("forwards the caller's stable idempotency key on a post retry", async () => {
    const stableKey = "71000000-0000-4000-8000-000000000001";
    mockFetch
      .mockRejectedValueOnce(new Error("network interrupted"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ post: { id: "post-created" } }),
      });
    const input = {
      category: "free" as const,
      title: "같은 글 재시도",
      content: "응답을 잃어도 한 번만 저장합니다.",
      visibility: "public" as const,
      ad_disclosure: "general" as const,
    };

    const first = await useCommunityStore.getState().createPost(
      input,
      { idempotencyKey: stableKey },
    );
    const retry = await useCommunityStore.getState().createPost(
      input,
      { idempotencyKey: stableKey },
    );

    expect(first).toBeNull();
    expect(retry).toBe("post-created");
    const postCalls = mockFetch.mock.calls.filter(
      ([url]) => url === "/api/community/posts",
    );
    expect(postCalls).toHaveLength(2);
    for (const [, init] of postCalls) {
      expect(init).toEqual(expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": stableKey,
        }),
      }));
    }
  });

  it("uses the server count on an idempotent replay instead of incrementing twice", async () => {
    const answeredPost = {
      ...post("question-1", "2026-06-15T00:00:00.000Z"),
      category: "is_normal" as const,
      comment_count: 3,
    };
    useCommunityStore.setState({
      currentSort: "new",
      posts: [answeredPost],
      currentPost: { ...answeredPost, vendor_details: [] } as PostDetail,
    });
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          replayed: true,
          post_comment_count: 3,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ comments: [] }),
      });

    const ok = await useCommunityStore.getState().createComment(
      { post_id: answeredPost.id, content: "재시도한 같은 답변" },
      { idempotencyKey: "70000000-0000-4000-8000-000000000002" },
    );

    expect(ok).toBe(true);
    expect(useCommunityStore.getState().posts[0]?.comment_count).toBe(3);
    expect(useCommunityStore.getState().currentPost?.comment_count).toBe(3);
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

    const result = await useCommunityStore.getState().updateComment("reply-1", "  나을듯욯ㅎ  ");

    // 결과가 boolean 이 아니다 — 실패하면 **서버가 준 이유**를 함께 들고 온다.
    expect(result.ok).toBe(true);
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
    const result = await useCommunityStore.getState().updateComment("comment-1", "   ");

    expect(result.ok).toBe(false);
    // 거절에는 이유가 붙어야 한다. 화면이 그것을 그린다.
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
