import { create } from "zustand";
import type {
  PostWithAuthor,
  PostDetail,
  CommentWithAuthor,
  CommunityProfile,
  PublicCommunityAuthor,
  CommunityCategory,
  PostSort,
  TimePeriod,
  InitialCommunityFeed,
  CreatePostInput,
} from "@/types/community.types";
import { normalizeCommunityAvatar } from "@/lib/community/avatar";

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
  postLoadPostId: string | null;
  postLoadStatus: "idle" | "loading" | "ready" | "not_found" | "error";
  postLoadError: string | null;
  commentsLoading: boolean;
  commentsLoadStatus: "idle" | "loading" | "ready" | "error";
  commentsLoadError: string | null;

  // 유저
  communityProfile: CommunityProfile | null;

  // 액션
  hydrateInitialFeed: (feed: InitialCommunityFeed) => void;
  fetchPosts: (reset?: boolean) => Promise<void>;
  fetchMorePosts: () => Promise<void>;
  fetchPostDetail: (id: string) => Promise<void>;
  fetchComments: (postId: string) => Promise<boolean>;
  createPost: (input: CreatePostInput) => Promise<string | null>;
  updatePost: (id: string, input: Partial<CreatePostInput>) => Promise<boolean>;
  deletePost: (id: string) => Promise<boolean>;
  votePost: (postId: string, voteType: 1 | 0) => Promise<void>;
  toggleBookmark: (postId: string, bookmarked: boolean) => Promise<boolean>;
  updateComment: (commentId: string, content: string) => Promise<boolean>;
  deleteComment: (commentId: string) => Promise<boolean>;
  incrementView: (postId: string) => Promise<void>;
  fetchProfile: () => Promise<void>;
  applyConfirmedOwnCommunityNickname: (nickname: string) => void;
  hideAuthorLocally: (authorId: string) => void;
  setCategory: (category: CommunityCategory | null) => void;
  setSort: (sort: PostSort) => void;
  setPeriod: (period: TimePeriod) => void;
  setTag: (tag: string | null) => void;
  setAuthorId: (authorId: string | null) => void;
  clearError: () => void;
  refreshAfterAuthChange: () => Promise<void>;
  reset: () => void;
}

const LIMIT = 20;
const COMMUNITY_FEED_TIMEOUT_MS = 5_000;
let feedRequestSequence = 0;
let postRequestSequence = 0;
let commentsRequestSequence = 0;

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

interface CommunityFeedPayload {
  posts: PostWithAuthor[];
  total: number;
  hasMore: boolean;
}

function isPublicCommunityAuthor(value: unknown): value is PublicCommunityAuthor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const author = value as Record<string, unknown>;
  return (
    typeof author.user_id === "string" &&
    author.user_id.length > 0 &&
    typeof author.nickname === "string" &&
    author.nickname.trim().length > 0 &&
    (author.avatar_url === null || normalizeCommunityAvatar(author.avatar_url) === author.avatar_url)
  );
}

function hasTrustedPublicActor(value: unknown): value is {
  author_id: string;
  author: PublicCommunityAuthor;
  viewer_is_author: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.author_id === "string" &&
    item.author_id.length > 0 &&
    isPublicCommunityAuthor(item.author) &&
    item.author.user_id === item.author_id &&
    typeof item.viewer_is_author === "boolean"
  );
}

function isTrustedComment(value: unknown): value is CommentWithAuthor {
  if (!hasTrustedPublicActor(value)) return false;
  const comment = value as unknown as CommentWithAuthor;
  return (
    typeof comment.id === "string" &&
    (!comment.replies || comment.replies.every(isTrustedComment))
  );
}

function parseCommunityFeedPayload(value: unknown): CommunityFeedPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("community_feed_invalid_payload");
  }
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate.posts) ||
    !candidate.posts.every(
      (post) =>
        Boolean(post) &&
        typeof post === "object" &&
        !Array.isArray(post) &&
        typeof (post as Record<string, unknown>).id === "string" &&
        hasTrustedPublicActor(post)
    ) ||
    typeof candidate.total !== "number" ||
    !Number.isSafeInteger(candidate.total) ||
    candidate.total < 0 ||
    typeof candidate.hasMore !== "boolean"
  ) {
    throw new Error("community_feed_invalid_payload");
  }
  return candidate as unknown as CommunityFeedPayload;
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
    if (
      !parsed.ts ||
      !Array.isArray(parsed.posts) ||
      !parsed.posts.every(hasTrustedPublicActor) ||
      Date.now() - parsed.ts > CACHE_MAX_AGE_MS
    ) {
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
  // Latest feed should always revalidate so newly published posts appear promptly.
  return sort !== "new";
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

async function fetchCommunityFeed(url: string): Promise<CommunityFeedPayload> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), COMMUNITY_FEED_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("community_feed_request_failed");
    return parseCommunityFeedPayload(await response.json());
  } finally {
    clearTimeout(timeoutId);
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
  postLoadPostId: null,
  postLoadStatus: "idle",
  postLoadError: null,
  commentsLoading: false,
  commentsLoadStatus: "idle",
  commentsLoadError: null,
  communityProfile: null,

  hydrateInitialFeed: (feed) => {
    feedRequestSequence += 1;
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
    const requestSequence = ++feedRequestSequence;
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
      const data = await fetchCommunityFeed(`/api/community/posts?${params}`);
      if (requestSequence !== feedRequestSequence) return;
      const { posts, total, hasMore } = data;
      set({ posts, total, hasMore, currentPage: 1, isLoading: false, errorMessage: null, lastSyncedAt: new Date().toISOString() });
      writeFeedCache(cacheKey, { posts, total, hasMore, ts: Date.now() });
    } catch {
      if (requestSequence !== feedRequestSequence) return;
      set({ isLoading: false, errorMessage: "게시글을 불러오지 못했습니다. 잠시 후 다시 시도해주세요." });
    }
  },

  fetchMorePosts: async () => {
    const { currentCategory, currentSort, currentPeriod, currentTag, currentAuthorId, currentPage, hasMore, isLoading } = get();
    if (!hasMore || isLoading) return;
    const requestSequence = ++feedRequestSequence;
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
      const data = await fetchCommunityFeed(`/api/community/posts?${params}`);
      if (requestSequence !== feedRequestSequence) return;
      set((s) => ({
        posts: [...s.posts, ...data.posts],
        hasMore: data.hasMore,
        currentPage: nextPage,
        isLoading: false,
        errorMessage: null,
        lastSyncedAt: new Date().toISOString(),
      }));
    } catch {
      if (requestSequence !== feedRequestSequence) return;
      set({ isLoading: false, errorMessage: "다음 글을 불러오지 못했습니다." });
    }
  },

  fetchPostDetail: async (id) => {
    const requestSequence = ++postRequestSequence;
    if (get().commentsPostId !== id) commentsRequestSequence += 1;
    set((state) => ({
      postLoading: true,
      postLoadPostId: id,
      postLoadStatus: "loading",
      postLoadError: null,
      errorMessage: null,
      currentPost: null,
      ...(state.commentsPostId !== id
        ? {
            comments: [],
            commentsPostId: null,
            commentsLoading: false,
            commentsLoadStatus: "idle" as const,
            commentsLoadError: null,
          }
        : {}),
    }));
    try {
      const res = await fetch(`/api/community/posts/${id}`);
      if (requestSequence !== postRequestSequence) return;
      if (res.status === 404) {
        set({
          currentPost: null,
          postLoading: false,
          postLoadStatus: "not_found",
          postLoadError: null,
        });
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "게시글을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      }
      const postPayload: unknown = await res.json();
      if (!hasTrustedPublicActor(postPayload)) {
        throw new Error("게시글 작성자 정보를 확인하지 못했습니다.");
      }
      const post = postPayload as PostDetail;
      if (requestSequence !== postRequestSequence) return;
      set({
        currentPost: post,
        postLoading: false,
        postLoadStatus: "ready",
        postLoadError: null,
        errorMessage: null,
      });
    } catch (error) {
      if (requestSequence !== postRequestSequence) return;
      const message =
        error instanceof Error && error.message
          ? error.message
          : "게시글을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
      set({
        currentPost: null,
        postLoading: false,
        postLoadStatus: "error",
        postLoadError: message,
        errorMessage: message,
      });
    }
  },

  fetchComments: async (postId) => {
    const requestSequence = ++commentsRequestSequence;
    set((state) => ({
      commentsLoading: true,
      commentsLoadStatus: "loading",
      commentsLoadError: null,
      ...(state.commentsPostId !== postId
        ? { comments: [], commentsPostId: postId }
        : {}),
    }));
    try {
      const res = await fetch(`/api/community/comments?postId=${postId}`);
      if (!res.ok) {
        const errorData = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorData?.error ?? "댓글을 불러오지 못했습니다.");
      }
      const data = await res.json();
      const nextComments = Array.isArray(data?.comments)
        ? data.comments
        : Array.isArray(data)
          ? data
          : null;
      if (!nextComments || !nextComments.every(isTrustedComment)) {
        throw new Error("댓글 작성자 정보를 확인하지 못했습니다.");
      }
      if (requestSequence !== commentsRequestSequence) return false;
      set((state) =>
        state.commentsPostId === postId
          ? {
              comments: nextComments,
              commentsLoading: false,
              commentsLoadStatus: "ready",
              commentsLoadError: null,
            }
          : state
      );
      return true;
    } catch (error) {
      if (requestSequence !== commentsRequestSequence || get().commentsPostId !== postId) return false;
      set({
        commentsLoading: false,
        commentsLoadStatus: "error",
        commentsLoadError:
          error instanceof Error && error.message
            ? error.message
            : "댓글을 불러오지 못했습니다.",
      });
      return false;
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
      if (typeof id !== "string" || id.length === 0) {
        set({ errorMessage: "게시글 저장 결과를 확인하지 못했습니다." });
        return null;
      }

      // 옵티미스틱 prepend — 서버가 검증한 공개 작성자 카드만 허용한다.
      if (newPost && id) {
        if (!hasTrustedPublicActor(newPost)) {
          set({ errorMessage: "게시글 작성자 정보를 확인하지 못했습니다." });
          return null;
        }
        const { posts } = get();
        const enriched: PostWithAuthor = {
          ...newPost,
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
      if (!res.ok) return false;
      const data = (await res.json().catch(() => null)) as {
        post?: { id?: unknown };
      } | null;
      if (data?.post?.id !== id) return false;
      invalidateFeedCache();
      return true;
    } catch {
      return false;
    }
  },

  deletePost: async (id) => {
    try {
      const res = await fetch(`/api/community/posts/${id}`, { method: "DELETE" });
      if (!res.ok) return false;
      const data = (await res.json().catch(() => null)) as { success?: unknown } | null;
      if (data?.success !== true) return false;
      set((s) => ({ posts: s.posts.filter((p) => p.id !== id) }));
      invalidateFeedCache();
      return true;
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
      const data = (await res.json().catch(() => null)) as {
        upvote_count?: unknown;
        downvote_count?: unknown;
      } | null;
      if (
        typeof data?.upvote_count !== "number" ||
        !Number.isSafeInteger(data.upvote_count) ||
        data.upvote_count < 0 ||
        typeof data.downvote_count !== "number" ||
        !Number.isSafeInteger(data.downvote_count) ||
        data.downvote_count < 0
      ) {
        throw new Error("좋아요 저장 결과를 확인하지 못했습니다.");
      }
      const upvoteCount = data.upvote_count;
      const downvoteCount = data.downvote_count;
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

  toggleBookmark: async (postId, bookmarked) => {
    try {
      const res = await fetch(`/api/community/posts/${postId}/bookmark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarked }),
      });
      if (!res.ok) return false;
      const data = (await res.json().catch(() => null)) as {
        bookmarked?: unknown;
        bookmark_count?: unknown;
      } | null;
      if (data?.bookmarked !== bookmarked) return false;
      const verifiedCount =
        typeof data.bookmark_count === "number" &&
        Number.isSafeInteger(data.bookmark_count) &&
        data.bookmark_count >= 0
          ? data.bookmark_count
          : null;
      set((s) => ({
        posts: s.posts.map((p) =>
          p.id === postId
            ? {
                ...p,
                user_bookmarked: bookmarked,
                bookmark_count: verifiedCount ?? p.bookmark_count,
              }
            : p
        ),
        currentPost: s.currentPost?.id === postId
          ? {
              ...s.currentPost,
              user_bookmarked: bookmarked,
              bookmark_count: verifiedCount ?? s.currentPost.bookmark_count,
            }
          : s.currentPost,
      }));
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
      const data = (await res.json()) as { profile?: CommunityProfile };
      if (data.profile) set({ communityProfile: data.profile });
    } catch { /* ignore */ }
  },

  applyConfirmedOwnCommunityNickname: (nickname) => {
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) return;

    const updateAuthor = <T extends {
      author: PublicCommunityAuthor;
      viewer_is_author: boolean;
    }>(item: T): T => {
      if (!item.viewer_is_author) return item;
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
      communityProfile: state.communityProfile
        ? { ...state.communityProfile, nickname: trimmedNickname }
        : null,
      posts: state.posts.map(updateAuthor),
      currentPost: state.currentPost ? updateAuthor(state.currentPost) : state.currentPost,
      comments: state.comments.map(updateComment),
      lastSyncedAt: new Date().toISOString(),
    }));
  },

  hideAuthorLocally: (authorId) => {
    if (!authorId) return;

    // A successful mute changes every feed's visibility boundary. Cancel an
    // in-flight feed response and remove all account-scoped cache entries so a
    // back navigation cannot briefly resurrect the hidden author.
    feedRequestSequence += 1;
    invalidateFeedCache();

    const filterComments = (comments: CommentWithAuthor[]): CommentWithAuthor[] =>
      comments
        .filter((comment) => comment.author_id !== authorId && comment.author.user_id !== authorId)
        .map((comment) => ({
          ...comment,
          replies: comment.replies ? filterComments(comment.replies) : comment.replies,
        }));

    set((state) => {
      const posts = state.posts.filter(
        (post) => post.author_id !== authorId && post.author.user_id !== authorId,
      );
      const removedLoadedPosts = state.posts.length - posts.length;
      const currentPostIsMuted =
        state.currentPost?.author_id === authorId || state.currentPost?.author.user_id === authorId;

      return {
        posts,
        total: Math.max(posts.length, state.total - removedLoadedPosts),
        comments: currentPostIsMuted ? [] : filterComments(state.comments),
        commentsPostId: currentPostIsMuted ? null : state.commentsPostId,
        lastSyncedAt: null,
      };
    });
  },

  setCategory: (category) => {
    if (get().currentCategory === category) return;
    feedRequestSequence += 1;
    set({ currentCategory: category, posts: [], hasMore: true, currentPage: 1 });
  },

  setSort: (sort) => {
    feedRequestSequence += 1;
    set({ currentSort: sort, posts: [], hasMore: true, currentPage: 1 });
  },

  setPeriod: (period) => {
    feedRequestSequence += 1;
    set({ currentPeriod: period, posts: [], hasMore: true, currentPage: 1 });
  },

  setTag: (tag) => {
    if (get().currentTag === tag) return;
    feedRequestSequence += 1;
    set({ currentTag: tag, posts: [], hasMore: true, currentPage: 1 });
  },

  setAuthorId: (authorId) => {
    if (get().currentAuthorId === authorId) return;
    feedRequestSequence += 1;
    set({ currentAuthorId: authorId, posts: [], hasMore: true, currentPage: 1 });
  },

  clearError: () => set({ errorMessage: null }),

  refreshAfterAuthChange: async () => {
    const {
      currentCategory,
      currentSort,
      currentPeriod,
      currentTag,
      currentAuthorId,
    } = get();

    // Vote/bookmark projections are identity-specific. Invalidate both the
    // in-memory request generation and session cache while keeping the route's
    // active feed selection stable across login/logout reconciliation.
    feedRequestSequence += 1;
    postRequestSequence += 1;
    commentsRequestSequence += 1;
    invalidateFeedCache();
    set({
      posts: [],
      currentCategory,
      currentSort,
      currentPeriod,
      currentTag,
      currentAuthorId,
      currentPage: 1,
      hasMore: true,
      isLoading: true,
      total: 0,
      errorMessage: null,
      lastSyncedAt: null,
      currentPost: null,
      comments: [],
      commentsPostId: null,
      postLoading: false,
      postLoadPostId: null,
      postLoadStatus: "idle",
      postLoadError: null,
      commentsLoading: false,
      commentsLoadStatus: "idle",
      commentsLoadError: null,
      communityProfile: null,
    });
    await get().fetchPosts(true);
  },

  reset: () => {
    feedRequestSequence += 1;
    postRequestSequence += 1;
    commentsRequestSequence += 1;
    set({
      posts: [], currentCategory: null, currentSort: "new", currentPeriod: "week",
      currentTag: null, currentAuthorId: null, currentPage: 1, hasMore: true, isLoading: true, total: 0,
      errorMessage: null, lastSyncedAt: null,
      currentPost: null, comments: [], commentsPostId: null, postLoading: false,
      postLoadPostId: null, postLoadStatus: "idle", postLoadError: null, commentsLoading: false,
      commentsLoadStatus: "idle", commentsLoadError: null,
      communityProfile: null,
    });
  },
}));
