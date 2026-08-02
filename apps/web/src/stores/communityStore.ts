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
  CreateCommentInput,
} from "@/types/community.types";
import { clearCommunityPostDrafts } from "@/lib/community/draftStorage";
import { expectedCommunityActorHeaders } from "@/lib/community/actorFence";

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
  createPost: (input: CreatePostInput, expectedActorId?: string) => Promise<string | null>;
  updatePost: (id: string, input: Partial<CreatePostInput>, expectedActorId?: string) => Promise<boolean>;
  deletePost: (id: string) => Promise<boolean>;
  votePost: (postId: string, voteType: 1 | 0) => Promise<void>;
  voteComment: (commentId: string, voteType: 1 | -1 | 0) => Promise<void>;
  toggleBookmark: (postId: string) => Promise<void>;
  createComment: (input: CreateCommentInput) => Promise<boolean>;
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
let communityLifecycleEpoch = 0;
const communityRequestControllers = new Set<AbortController>();

function isCurrentCommunityLifecycle(epoch: number): boolean {
  return epoch === communityLifecycleEpoch;
}

async function communityFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  communityRequestControllers.add(controller);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    communityRequestControllers.delete(controller);
  }
}

function abortCommunityRequests(): void {
  for (const controller of communityRequestControllers) controller.abort();
  communityRequestControllers.clear();
}

// 커뮤니티 응답에는 회원 전용 제목과 개인화 상태가 섞일 수 있으므로 계정 전환 시
// 피드뿐 아니라 랜딩·트렌딩의 짧은 세션 캐시도 모두 제거한다.
function invalidateCommunityCache(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("community:")) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

// 이전 버전이 남긴 계정 미귀속 캐시도 새 번들이 로드되는 즉시 제거한다.
invalidateCommunityCache();

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
    const lifecycleEpoch = communityLifecycleEpoch;
    const { currentCategory, currentSort, currentPeriod, currentTag, currentAuthorId } = get();
    if (reset) {
      set({ isLoading: get().posts.length === 0, currentPage: 1, errorMessage: null });
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
      const res = await communityFetch(`/api/community/posts?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return;
      const posts = data.posts ?? [];
      const total = data.total ?? 0;
      const hasMore = data.hasMore ?? false;
      set({ posts, total, hasMore, currentPage: 1, isLoading: false, errorMessage: null, lastSyncedAt: new Date().toISOString() });
    } catch {
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return;
      set({ isLoading: false, errorMessage: "게시글을 불러오지 못했습니다. 잠시 후 다시 시도해주세요." });
    }
  },

  fetchMorePosts: async () => {
    const lifecycleEpoch = communityLifecycleEpoch;
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
      const res = await communityFetch(`/api/community/posts?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return;
      set((s) => ({
        posts: [...s.posts, ...data.posts],
        hasMore: data.hasMore,
        currentPage: nextPage,
        isLoading: false,
        errorMessage: null,
        lastSyncedAt: new Date().toISOString(),
      }));
    } catch {
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return;
      set({ isLoading: false, errorMessage: "다음 글을 불러오지 못했습니다." });
    }
  },

  fetchPostDetail: async (id) => {
    const lifecycleEpoch = communityLifecycleEpoch;
    set((state) => ({
      postLoading: true,
      currentPost: null,
      ...(state.commentsPostId !== id
        ? { comments: [], commentsPostId: null, commentsLoading: false }
        : {}),
    }));
    try {
      const res = await communityFetch(`/api/community/posts/${id}`);
      if (!res.ok) throw new Error();
      const post = await res.json();
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return;
      set({ currentPost: post, postLoading: false });
    } catch {
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return;
      set({ postLoading: false, errorMessage: "게시글 상세를 불러오지 못했습니다." });
    }
  },

  fetchComments: async (postId) => {
    const lifecycleEpoch = communityLifecycleEpoch;
    set((state) => ({
      commentsLoading: true,
      errorMessage: null,
      ...(state.commentsPostId !== postId
        ? { comments: [], commentsPostId: postId }
        : {}),
    }));
    try {
      const res = await communityFetch(`/api/community/comments?postId=${postId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return;
      set((state) =>
        state.commentsPostId === postId
          ? { comments: data.comments ?? data, commentsLoading: false }
          : state
      );
    } catch {
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return;
      if (get().commentsPostId !== postId) return;
      set({ commentsLoading: false, errorMessage: "댓글을 불러오지 못했습니다." });
    }
  },

  createPost: async (input, expectedActorId) => {
    const lifecycleEpoch = communityLifecycleEpoch;
    try {
      const res = await communityFetch("/api/community/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(expectedActorId ? expectedCommunityActorHeaders(expectedActorId) : {}),
        },
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
        if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return null;
        set({ errorMessage: serverMsg ?? "게시글 작성에 실패했습니다." });
        return null;
      }
      const data = (await res.json()) as {
        post?: PostWithAuthor & { id: string };
        id?: string;
      };
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return null;
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
      invalidateCommunityCache();
      set({ errorMessage: null, lastSyncedAt: new Date().toISOString() });
      return id;
    } catch {
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return null;
      set({ errorMessage: "게시글 작성 중 오류가 발생했습니다." });
      return null;
    }
  },

  updatePost: async (id, input, expectedActorId) => {
    const lifecycleEpoch = communityLifecycleEpoch;
    try {
      const res = await communityFetch(`/api/community/posts/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(expectedActorId ? expectedCommunityActorHeaders(expectedActorId) : {}),
        },
        body: JSON.stringify(input),
      });
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return false;
      if (res.ok) invalidateCommunityCache();
      return res.ok;
    } catch {
      return false;
    }
  },

  deletePost: async (id) => {
    const lifecycleEpoch = communityLifecycleEpoch;
    try {
      const res = await communityFetch(`/api/community/posts/${id}`, { method: "DELETE" });
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return false;
      if (res.ok) {
        set((s) => ({ posts: s.posts.filter((p) => p.id !== id) }));
        invalidateCommunityCache();
      }
      return res.ok;
    } catch {
      return false;
    }
  },

  votePost: async (postId, voteType) => {
    const lifecycleEpoch = communityLifecycleEpoch;
    try {
      const res = await communityFetch(`/api/community/posts/${postId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voteType }),
      });
      if (!res.ok) {
        const errorData = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorData?.error ?? "좋아요 처리에 실패했습니다.");
      }
      const data = await res.json();
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return;
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
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return;
      throw error;
    }
  },

  voteComment: async (commentId, voteType) => {
    const lifecycleEpoch = communityLifecycleEpoch;
    try {
      const res = await communityFetch(`/api/community/comments/${commentId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voteType }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return;

      const updateComment = (c: CommentWithAuthor): CommentWithAuthor => {
        if (c.id === commentId) return { ...c, upvote_count: data.upvote_count, user_vote: voteType === 0 ? null : voteType };
        if (c.replies) return { ...c, replies: c.replies.map(updateComment) };
        return c;
      };
      set((s) => ({ comments: s.comments.map(updateComment) }));
    } catch { /* ignore */ }
  },

  toggleBookmark: async (postId) => {
    const lifecycleEpoch = communityLifecycleEpoch;
    try {
      const res = await communityFetch(`/api/community/posts/${postId}/bookmark`, { method: "POST" });
      if (!res.ok) return;
      const data = await res.json();
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return;
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

  createComment: async (input) => {
    const lifecycleEpoch = communityLifecycleEpoch;
    try {
      const res = await communityFetch("/api/community/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) return false;
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return false;
      // 댓글 다시 불러오기
      await get().fetchComments(input.post_id);
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return false;
      // 글 댓글 수 업데이트
      set((s) => ({
        currentPost: s.currentPost?.id === input.post_id
          ? { ...s.currentPost, comment_count: s.currentPost.comment_count + 1 }
          : s.currentPost,
      }));
      return true;
    } catch {
      return false;
    }
  },

  updateComment: async (commentId, content) => {
    const lifecycleEpoch = communityLifecycleEpoch;
    const trimmed = content.trim();
    if (!trimmed) return false;

    try {
      const res = await communityFetch(`/api/community/comments/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (!res.ok) return false;

      const data = (await res.json().catch(() => null)) as {
        comment?: Partial<CommentWithAuthor>;
      } | null;
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return false;
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
    const lifecycleEpoch = communityLifecycleEpoch;
    try {
      const res = await communityFetch(`/api/community/comments/${commentId}`, { method: "DELETE" });
      if (!res.ok) return false;
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return false;
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
      await communityFetch(`/api/community/posts/${postId}/view`, { method: "POST" });
    } catch { /* ignore */ }
  },

  fetchProfile: async () => {
    const lifecycleEpoch = communityLifecycleEpoch;
    try {
      const res = await communityFetch("/api/community/profile", { method: "POST" });
      if (!res.ok) return;
      const data = (await res.json()) as { profile?: CommunityProfile | null };
      if (!isCurrentCommunityLifecycle(lifecycleEpoch)) return;
      set({ communityProfile: data.profile ?? null });
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

    invalidateCommunityCache();
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
    communityLifecycleEpoch += 1;
    abortCommunityRequests();
    invalidateCommunityCache();
    set({
      posts: [], currentCategory: null, currentSort: "new", currentPeriod: "week",
      currentTag: null, currentAuthorId: null, currentPage: 1, hasMore: true, isLoading: true, total: 0,
      errorMessage: null, lastSyncedAt: null,
      currentPost: null, comments: [], commentsPostId: null, postLoading: false, commentsLoading: false,
      communityProfile: null,
    });
    if (typeof window !== "undefined") {
      try {
        clearCommunityPostDrafts(window.localStorage);
      } catch {
        // The in-memory boundary is already closed when storage is unavailable.
      }
    }
  },
}));
