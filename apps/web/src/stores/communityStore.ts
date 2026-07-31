import { create } from "zustand";
import type {
  PostWithAuthor,
  PostDetail,
  CommentWithAuthor,
  CommunityProfile,
  CommunityCategory,
  PostSort,
  TimePeriod,
  InitialCommunityFeed,
  CreatePostInput,
  UpdatePostInput,
  CreateCommentInput,
} from "@/types/community.types";

interface CommunityState {
  // 피드
  posts: PostWithAuthor[];
  currentCategory: CommunityCategory | null;
  currentSort: PostSort;
  currentPeriod: TimePeriod;
  currentTag: string | null;
  currentAuthorId: string | null;
  currentPage: number;
  hasMore: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  lastSyncedAt: string | null;
  total: number;

  // 글 상세
  currentPost: PostDetail | null;
  comments: CommentWithAuthor[];
  commentsPostId: string | null;
  postLoading: boolean;
  commentsLoading: boolean;

  // 유저
  communityProfile: CommunityProfile | null;

  // 액션
  hydrateInitialFeed: (feed: InitialCommunityFeed) => void;
  fetchPosts: (reset?: boolean) => Promise<void>;
  fetchMorePosts: () => Promise<void>;
  fetchPostDetail: (id: string) => Promise<void>;
  fetchComments: (postId: string) => Promise<void>;
  createPost: (input: CreatePostInput) => Promise<string | null>;
  updatePost: (id: string, input: UpdatePostInput) => Promise<boolean>;
  deletePost: (id: string) => Promise<boolean>;
  votePost: (postId: string, voteType: 1 | 0) => Promise<void>;
  voteComment: (commentId: string, voteType: 1 | -1 | 0) => Promise<void>;
  toggleBookmark: (postId: string) => Promise<void>;
  createComment: (
    input: CreateCommentInput,
    options?: { idempotencyKey?: string },
  ) => Promise<boolean>;
  updateComment: (commentId: string, content: string) => Promise<boolean>;
  deleteComment: (commentId: string) => Promise<boolean>;
  incrementView: (postId: string) => Promise<void>;
  fetchProfile: () => Promise<void>;
  applyOwnNickname: (userId: string, nickname: string) => void;
  setCategory: (category: CommunityCategory | null) => void;
  setSort: (sort: PostSort) => void;
  setPeriod: (period: TimePeriod) => void;
  setTag: (tag: string | null) => void;
  setAuthorId: (authorId: string | null) => void;
  clearError: () => void;
  reset: () => void;
}

const LIMIT = 20;

// SWR 캐시 — sessionStorage 기반.
// fresh window 안엔 네트워크 skip, 그 후엔 stale-while-revalidate.
const CACHE_FRESH_MS = 30_000; // 30s 안엔 즉시 표시 + 네트워크 skip
const CACHE_MAX_AGE_MS = 5 * 60_000; // 5분 후엔 캐시 버림

interface CachedFeed {
  posts: PostWithAuthor[];
  total: number;
  hasMore: boolean;
  ts: number;
}

function feedCacheKey(
  category: CommunityCategory | null,
  sort: PostSort,
  period: TimePeriod,
  tag: string | null,
  authorId: string | null,
): string {
  return `community:feed:${category ?? "all"}:${sort}:${sort === "top" ? period : "_"}:${tag ?? "_"}:${authorId ?? "_"}`;
}

function readFeedCache(key: string): CachedFeed | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedFeed;
    if (!parsed.ts || Date.now() - parsed.ts > CACHE_MAX_AGE_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeFeedCache(key: string, value: CachedFeed): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — ignore */
  }
}

// 글 작성/삭제 시 모든 피드 캐시 무력화 — 뒤로 가면 신선한 목록 보이게.
// vote/bookmark는 in-memory state만 갱신해도 30s 안엔 stale 캐시 보일 수 있지만,
// 백그라운드 refetch가 바로 정정하므로 무시.
function shouldSkipFreshFeedNetwork(sort: PostSort): boolean {
  // 최신/답변 상태 피드는 작은 변화가 글의 포함 여부 자체를 바꾸므로 항상 재검증한다.
  return sort !== "new" && sort !== "unanswered" && sort !== "resolved";
}

function invalidateFeedCache(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("community:feed:")) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export const useCommunityStore = create<CommunityState>((set, get) => ({
  posts: [],
  currentCategory: null,
  currentSort: "new",
  currentPeriod: "week",
  currentTag: null,
  currentAuthorId: null,
  currentPage: 1,
  hasMore: true,
  isLoading: true,
  errorMessage: null,
  lastSyncedAt: null,
  total: 0,
  currentPost: null,
  comments: [],
  commentsPostId: null,
  postLoading: false,
  commentsLoading: false,
  communityProfile: null,

  hydrateInitialFeed: (feed) => {
    set({
      posts: feed.posts,
      total: feed.total,
      hasMore: feed.hasMore,
      currentCategory: null,
      currentSort: "new",
      currentPeriod: "week",
      currentTag: null,
      currentAuthorId: null,
      currentPage: 1,
      isLoading: false,
      errorMessage: null,
      lastSyncedAt: feed.fetchedAt,
    });
  },

  fetchPosts: async (reset = true) => {
    const { currentCategory, currentSort, currentPeriod, currentTag, currentAuthorId } = get();
    const cacheKey = feedCacheKey(currentCategory, currentSort, currentPeriod, currentTag, currentAuthorId);

    // SWR — reset일 때만 캐시 먹임 (페이지네이션엔 의미 없음)
    let usingFreshCache = false;
    if (reset) {
      const cached = readFeedCache(cacheKey);
      if (cached) {
        // 캐시 즉시 표시 — 화면 깜빡임 제거
        set({
          posts: cached.posts,
          total: cached.total,
          hasMore: cached.hasMore,
          currentPage: 1,
          isLoading: false,
          errorMessage: null,
        });
        usingFreshCache = shouldSkipFreshFeedNetwork(currentSort) && Date.now() - cached.ts < CACHE_FRESH_MS;
        if (usingFreshCache) return; // fresh window — 네트워크 skip
        // stale → 백그라운드 refetch (loading은 안 켬)
      } else {
        set({ isLoading: get().posts.length === 0, currentPage: 1, errorMessage: null });
      }
    }

    const params = new URLSearchParams();
    if (currentCategory) params.set("category", currentCategory);
    if (currentTag) params.set("tag", currentTag);
    if (currentAuthorId) params.set("author_id", currentAuthorId);
    params.set("sort", currentSort);
    if (currentSort === "top") params.set("period", currentPeriod);
    params.set("page", "1");
    params.set("limit", String(LIMIT));

    try {
      const res = await fetch(`/api/community/posts?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const posts = data.posts ?? [];
      const total = data.total ?? 0;
      const hasMore = data.hasMore ?? false;
      set({ posts, total, hasMore, currentPage: 1, isLoading: false, errorMessage: null, lastSyncedAt: new Date().toISOString() });
      writeFeedCache(cacheKey, { posts, total, hasMore, ts: Date.now() });
    } catch {
      set({ isLoading: false, errorMessage: "게시글을 불러오지 못했습니다. 잠시 후 다시 시도해주세요." });
    }
  },

  fetchMorePosts: async () => {
    const { currentCategory, currentSort, currentPeriod, currentTag, currentAuthorId, currentPage, hasMore, isLoading } = get();
    if (!hasMore || isLoading) return;
    set({ isLoading: true, errorMessage: null });

    const nextPage = currentPage + 1;
    const params = new URLSearchParams();
    if (currentCategory) params.set("category", currentCategory);
    if (currentTag) params.set("tag", currentTag);
    if (currentAuthorId) params.set("author_id", currentAuthorId);
    params.set("sort", currentSort);
    if (currentSort === "top") params.set("period", currentPeriod);
    params.set("page", String(nextPage));
    params.set("limit", String(LIMIT));

    try {
      const res = await fetch(`/api/community/posts?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      set((s) => ({
        posts: [...s.posts, ...data.posts],
        hasMore: data.hasMore,
        currentPage: nextPage,
        isLoading: false,
        errorMessage: null,
        lastSyncedAt: new Date().toISOString(),
      }));
    } catch {
      set({ isLoading: false, errorMessage: "다음 글을 불러오지 못했습니다." });
    }
  },

  fetchPostDetail: async (id) => {
    set((state) => ({
      postLoading: true,
      currentPost: null,
      ...(state.commentsPostId !== id
        ? { comments: [], commentsPostId: null, commentsLoading: false }
        : {}),
    }));
    try {
      const res = await fetch(`/api/community/posts/${id}`);
      if (!res.ok) throw new Error();
      const post = await res.json();
      set({ currentPost: post, postLoading: false });
    } catch {
      set({ postLoading: false, errorMessage: "게시글 상세를 불러오지 못했습니다." });
    }
  },

  fetchComments: async (postId) => {
    set((state) => ({
      commentsLoading: true,
      errorMessage: null,
      ...(state.commentsPostId !== postId
        ? { comments: [], commentsPostId: postId }
        : {}),
    }));
    try {
      const res = await fetch(`/api/community/comments?postId=${postId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      set((state) =>
        state.commentsPostId === postId
          ? { comments: data.comments ?? data, commentsLoading: false }
          : state
      );
    } catch {
      if (get().commentsPostId !== postId) return;
      set({ commentsLoading: false, errorMessage: "댓글을 불러오지 못했습니다." });
    }
  },

  createPost: async (input) => {
    try {
      const res = await fetch("/api/community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        // 서버가 구체적인 에러를 주면 그대로 노출 (예: "내용을 입력해주세요.", 컬럼 없음 등)
        let serverMsg: string | null = null;
        try {
          const data = (await res.json()) as { error?: string };
          if (typeof data?.error === "string" && data.error.length > 0) {
            serverMsg = data.error;
          }
        } catch {
          /* JSON 파싱 실패는 무시 — 기본 메시지로 fallback */
        }
        set({ errorMessage: serverMsg ?? "게시글 작성에 실패했습니다." });
        return null;
      }
      const data = (await res.json()) as {
        post?: PostWithAuthor & { id: string };
        id?: string;
      };
      const newPost = data.post;
      const id = newPost?.id ?? data.id ?? null;

      // 옵티미스틱 prepend — 작성자가 곧바로 커뮤니티 리스트로 돌아왔을 때 즉시 보이게.
      // 응답에 author가 없으면 store에 캐싱된 communityProfile로 채움.
      if (newPost && id) {
        const { communityProfile, posts } = get();
        const enriched: PostWithAuthor = {
          ...newPost,
          author: (newPost.author ??
            communityProfile ??
            ({ nickname: "나", rank: "sprout", wedding_year: null, wedding_month: null } as PostWithAuthor["author"])) as PostWithAuthor["author"],
          user_vote: null,
          user_bookmarked: false,
        } as PostWithAuthor;
        // 이미 같은 id가 있으면(드물게 realtime으로 먼저 들어옴) 스킵
        const dedup = posts.some((p) => p.id === id);
        if (!dedup) set({ posts: [enriched, ...posts] });
      }
      invalidateFeedCache();
      set({ errorMessage: null, lastSyncedAt: new Date().toISOString() });
      return id;
    } catch {
      set({ errorMessage: "게시글 작성 중 오류가 발생했습니다." });
      return null;
    }
  },

  updatePost: async (id, input) => {
    try {
      const res = await fetch(`/api/community/posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => null)) as {
        post?: Partial<PostDetail> & { id?: string };
        error?: string;
      } | null;

      if (!res.ok) {
        set({
          errorMessage:
            typeof data?.error === "string"
              ? data.error
              : "게시글 수정에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        });
        return false;
      }

      const returnedPost = data?.post;
      if (returnedPost?.id === id) {
        set((state) => ({
          posts: state.posts.map((post) =>
            post.id === id ? { ...post, ...returnedPost } : post
          ),
          currentPost:
            state.currentPost?.id === id
              ? { ...state.currentPost, ...returnedPost }
              : state.currentPost,
          errorMessage: null,
          lastSyncedAt: new Date().toISOString(),
        }));
      } else {
        set({ errorMessage: null, lastSyncedAt: new Date().toISOString() });
      }

      invalidateFeedCache();
      return true;
    } catch {
      set({
        errorMessage: "게시글 수정 중 연결이 끊겼습니다. 잠시 후 다시 시도해 주세요.",
      });
      return false;
    }
  },

  deletePost: async (id) => {
    try {
      const res = await fetch(`/api/community/posts/${id}`, { method: "DELETE" });
      if (res.ok) {
        set((s) => ({ posts: s.posts.filter((p) => p.id !== id) }));
        invalidateFeedCache();
      }
      return res.ok;
    } catch {
      return false;
    }
  },

  votePost: async (postId, voteType) => {
    try {
      const res = await fetch(`/api/community/posts/${postId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voteType }),
      });
      if (!res.ok) {
        const errorData = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorData?.error ?? "좋아요 처리에 실패했습니다.");
      }
      const data = await res.json();
      const upvoteCount = Math.max(0, data.upvote_count ?? 0);
      const downvoteCount = Math.max(0, data.downvote_count ?? 0);
      const userVote: 1 | null = voteType === 1 ? 1 : null;

      // 피드 목록 업데이트
      set((s) => ({
        posts: s.posts.map((p) =>
          p.id === postId
            ? { ...p, upvote_count: upvoteCount, downvote_count: downvoteCount, user_vote: userVote }
            : p
        ),
        currentPost: s.currentPost?.id === postId
          ? { ...s.currentPost, upvote_count: upvoteCount, downvote_count: downvoteCount, user_vote: userVote }
          : s.currentPost,
      }));
    } catch (error) {
      throw error;
    }
  },

  voteComment: async (commentId, voteType) => {
    try {
      const res = await fetch(`/api/community/comments/${commentId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voteType }),
      });
      if (!res.ok) return;
      const data = await res.json();

      const updateComment = (c: CommentWithAuthor): CommentWithAuthor => {
        if (c.id === commentId) return { ...c, upvote_count: data.upvote_count, user_vote: voteType === 0 ? null : voteType };
        if (c.replies) return { ...c, replies: c.replies.map(updateComment) };
        return c;
      };
      set((s) => ({ comments: s.comments.map(updateComment) }));
    } catch { /* ignore */ }
  },

  toggleBookmark: async (postId) => {
    try {
      const res = await fetch(`/api/community/posts/${postId}/bookmark`, { method: "POST" });
      if (!res.ok) return;
      const data = await res.json();
      set((s) => ({
        posts: s.posts.map((p) =>
          p.id === postId
            ? {
                ...p,
                user_bookmarked: data.bookmarked,
                bookmark_count: Math.max(0, data.bookmark_count ?? p.bookmark_count + (data.bookmarked ? 1 : -1)),
              }
            : p
        ),
        currentPost: s.currentPost?.id === postId
          ? {
              ...s.currentPost,
              user_bookmarked: data.bookmarked,
              bookmark_count: Math.max(0, data.bookmark_count ?? s.currentPost.bookmark_count + (data.bookmarked ? 1 : -1)),
            }
          : s.currentPost,
      }));
    } catch { /* ignore */ }
  },

  createComment: async (input, options) => {
    try {
      const idempotencyKey =
        options?.idempotencyKey ?? globalThis.crypto.randomUUID();
      const res = await fetch("/api/community/comments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(input),
      });
      if (!res.ok) return false;
      const responseBody = (await res.json().catch(() => null)) as {
        post_comment_count?: unknown;
      } | null;
      const postCommentCount =
        typeof responseBody?.post_comment_count === "number"
        && Number.isSafeInteger(responseBody.post_comment_count)
        && responseBody.post_comment_count >= 0
          ? responseBody.post_comment_count
          : null;
      // 댓글 다시 불러오기
      await get().fetchComments(input.post_id);
      invalidateFeedCache();
      // 첫 답변이 달린 글은 즉시 "답변 기다려요" 피드에서 빠져야 한다.
      set((s) => {
        const postWasVisible = s.posts.some((post) => post.id === input.post_id);
        const leavesUnansweredFeed = s.currentSort === "unanswered" && postWasVisible;

        return {
          posts: leavesUnansweredFeed
            ? s.posts.filter((post) => post.id !== input.post_id)
            : s.posts.map((post) =>
                post.id === input.post_id
                  ? {
                      ...post,
                      comment_count:
                        postCommentCount ?? post.comment_count + 1,
                    }
                  : post,
              ),
          total: leavesUnansweredFeed ? Math.max(0, s.total - 1) : s.total,
          currentPost:
            s.currentPost?.id === input.post_id
              ? {
                  ...s.currentPost,
                  comment_count:
                    postCommentCount ?? s.currentPost.comment_count + 1,
                }
              : s.currentPost,
        };
      });
      return true;
    } catch {
      return false;
    }
  },

  updateComment: async (commentId, content) => {
    const trimmed = content.trim();
    if (!trimmed) return false;

    try {
      const res = await fetch(`/api/community/comments/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (!res.ok) return false;

      const data = (await res.json().catch(() => null)) as {
        comment?: Partial<CommentWithAuthor>;
      } | null;
      const nextContent = data?.comment?.content ?? trimmed;
      const nextUpdatedAt = data?.comment?.updated_at ?? new Date().toISOString();

      const updateComment = (c: CommentWithAuthor): CommentWithAuthor => {
        if (c.id === commentId) {
          return { ...c, content: nextContent, updated_at: nextUpdatedAt };
        }
        if (c.replies) return { ...c, replies: c.replies.map(updateComment) };
        return c;
      };

      set((s) => ({ comments: s.comments.map(updateComment) }));
      return true;
    } catch {
      return false;
    }
  },

  deleteComment: async (commentId) => {
    try {
      const res = await fetch(`/api/community/comments/${commentId}`, { method: "DELETE" });
      if (!res.ok) return false;
      // 소프트 삭제 반영
      const updateComment = (c: CommentWithAuthor): CommentWithAuthor => {
        if (c.id === commentId) return { ...c, is_deleted: true, content: "삭제된 댓글입니다." };
        if (c.replies) return { ...c, replies: c.replies.map(updateComment) };
        return c;
      };
      set((s) => ({ comments: s.comments.map(updateComment) }));
      return true;
    } catch {
      return false;
    }
  },

  incrementView: async (postId) => {
    try {
      await fetch(`/api/community/posts/${postId}/view`, { method: "POST" });
    } catch { /* ignore */ }
  },

  fetchProfile: async () => {
    try {
      const res = await fetch("/api/community/profile");
      if (!res.ok) return;
      const data = await res.json();
      set({ communityProfile: data });
    } catch { /* ignore */ }
  },

  applyOwnNickname: (userId, nickname) => {
    const trimmedNickname = nickname.trim();
    if (!userId || !trimmedNickname) return;

    const updateAuthor = <T extends { author_id: string; author: CommunityProfile }>(item: T): T => {
      if (item.author_id !== userId && item.author.user_id !== userId) return item;
      return { ...item, author: { ...item.author, nickname: trimmedNickname } };
    };

    const updateComment = (comment: CommentWithAuthor): CommentWithAuthor => {
      const nextComment = updateAuthor(comment);
      return nextComment.replies
        ? { ...nextComment, replies: nextComment.replies.map(updateComment) }
        : nextComment;
    };

    invalidateFeedCache();
    set((state) => ({
      communityProfile:
        state.communityProfile?.user_id === userId
          ? { ...state.communityProfile, nickname: trimmedNickname }
          : state.communityProfile,
      posts: state.posts.map(updateAuthor),
      currentPost: state.currentPost ? updateAuthor(state.currentPost) : state.currentPost,
      comments: state.comments.map(updateComment),
      lastSyncedAt: new Date().toISOString(),
    }));
  },

  setCategory: (category) => {
    if (get().currentCategory === category) return;
    set({ currentCategory: category, posts: [], hasMore: true, currentPage: 1 });
  },

  setSort: (sort) => {
    set({ currentSort: sort, posts: [], hasMore: true, currentPage: 1 });
  },

  setPeriod: (period) => {
    set({ currentPeriod: period, posts: [], hasMore: true, currentPage: 1 });
  },

  setTag: (tag) => {
    if (get().currentTag === tag) return;
    set({ currentTag: tag, posts: [], hasMore: true, currentPage: 1 });
  },

  setAuthorId: (authorId) => {
    if (get().currentAuthorId === authorId) return;
    set({ currentAuthorId: authorId, posts: [], hasMore: true, currentPage: 1 });
  },

  clearError: () => set({ errorMessage: null }),

  reset: () => {
    set({
      posts: [], currentCategory: null, currentSort: "new", currentPeriod: "week",
      currentTag: null, currentAuthorId: null, currentPage: 1, hasMore: true, isLoading: true, total: 0,
      errorMessage: null, lastSyncedAt: null,
      currentPost: null, comments: [], commentsPostId: null, postLoading: false, commentsLoading: false,
      communityProfile: null,
    });
  },
}));
