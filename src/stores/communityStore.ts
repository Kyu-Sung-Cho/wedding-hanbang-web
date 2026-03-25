import { create } from "zustand";
import type {
  PostWithAuthor,
  PostDetail,
  CommentWithAuthor,
  CommunityProfile,
  CommunityCategory,
  PostSort,
  TimePeriod,
  CreatePostInput,
  CreateCommentInput,
} from "@/types/community.types";

interface CommunityState {
  // 피드
  posts: PostWithAuthor[];
  currentCategory: CommunityCategory | null;
  currentSort: PostSort;
  currentPeriod: TimePeriod;
  currentPage: number;
  hasMore: boolean;
  isLoading: boolean;
  total: number;

  // 글 상세
  currentPost: PostDetail | null;
  comments: CommentWithAuthor[];
  postLoading: boolean;
  commentsLoading: boolean;

  // 유저
  communityProfile: CommunityProfile | null;

  // 액션
  fetchPosts: (reset?: boolean) => Promise<void>;
  fetchMorePosts: () => Promise<void>;
  fetchPostDetail: (id: string) => Promise<void>;
  fetchComments: (postId: string) => Promise<void>;
  createPost: (input: CreatePostInput) => Promise<string | null>;
  updatePost: (id: string, input: Partial<CreatePostInput>) => Promise<boolean>;
  deletePost: (id: string) => Promise<boolean>;
  votePost: (postId: string, voteType: 1 | -1 | 0) => Promise<void>;
  voteComment: (commentId: string, voteType: 1 | -1 | 0) => Promise<void>;
  toggleBookmark: (postId: string) => Promise<void>;
  createComment: (input: CreateCommentInput) => Promise<boolean>;
  deleteComment: (commentId: string) => Promise<boolean>;
  incrementView: (postId: string) => Promise<void>;
  fetchProfile: () => Promise<void>;
  setCategory: (category: CommunityCategory | null) => void;
  setSort: (sort: PostSort) => void;
  setPeriod: (period: TimePeriod) => void;
  reset: () => void;
}

const LIMIT = 20;

export const useCommunityStore = create<CommunityState>((set, get) => ({
  posts: [],
  currentCategory: null,
  currentSort: "hot",
  currentPeriod: "week",
  currentPage: 1,
  hasMore: true,
  isLoading: false,
  total: 0,
  currentPost: null,
  comments: [],
  postLoading: false,
  commentsLoading: false,
  communityProfile: null,

  fetchPosts: async (reset = true) => {
    const { currentCategory, currentSort, currentPeriod } = get();
    if (reset) set({ isLoading: true, currentPage: 1 });

    const params = new URLSearchParams();
    if (currentCategory) params.set("category", currentCategory);
    params.set("sort", currentSort);
    if (currentSort === "top") params.set("period", currentPeriod);
    params.set("page", "1");
    params.set("limit", String(LIMIT));

    try {
      const res = await fetch(`/api/community/posts?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      set({ posts: data.posts, total: data.total, hasMore: data.hasMore, currentPage: 1, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchMorePosts: async () => {
    const { currentCategory, currentSort, currentPeriod, currentPage, hasMore, isLoading } = get();
    if (!hasMore || isLoading) return;
    set({ isLoading: true });

    const nextPage = currentPage + 1;
    const params = new URLSearchParams();
    if (currentCategory) params.set("category", currentCategory);
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
      }));
    } catch {
      set({ isLoading: false });
    }
  },

  fetchPostDetail: async (id) => {
    set({ postLoading: true, currentPost: null });
    try {
      const res = await fetch(`/api/community/posts/${id}`);
      if (!res.ok) throw new Error();
      const post = await res.json();
      set({ currentPost: post, postLoading: false });
    } catch {
      set({ postLoading: false });
    }
  },

  fetchComments: async (postId) => {
    set({ commentsLoading: true });
    try {
      const res = await fetch(`/api/community/comments?postId=${postId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      set({ comments: data.comments ?? data, commentsLoading: false });
    } catch {
      set({ commentsLoading: false });
    }
  },

  createPost: async (input) => {
    try {
      const res = await fetch("/api/community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.id ?? null;
    } catch {
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
      return res.ok;
    } catch {
      return false;
    }
  },

  deletePost: async (id) => {
    try {
      const res = await fetch(`/api/community/posts/${id}`, { method: "DELETE" });
      if (res.ok) {
        set((s) => ({ posts: s.posts.filter((p) => p.id !== id) }));
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
      if (!res.ok) return;
      const data = await res.json();

      // 피드 목록 업데이트
      set((s) => ({
        posts: s.posts.map((p) =>
          p.id === postId
            ? { ...p, upvote_count: data.upvote_count, downvote_count: data.downvote_count, user_vote: voteType === 0 ? null : voteType }
            : p
        ),
        currentPost: s.currentPost?.id === postId
          ? { ...s.currentPost, upvote_count: data.upvote_count, downvote_count: data.downvote_count, user_vote: voteType === 0 ? null : voteType }
          : s.currentPost,
      }));
    } catch { /* ignore */ }
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
          p.id === postId ? { ...p, user_bookmarked: data.bookmarked, bookmark_count: p.bookmark_count + (data.bookmarked ? 1 : -1) } : p
        ),
        currentPost: s.currentPost?.id === postId
          ? { ...s.currentPost, user_bookmarked: data.bookmarked, bookmark_count: s.currentPost.bookmark_count + (data.bookmarked ? 1 : -1) }
          : s.currentPost,
      }));
    } catch { /* ignore */ }
  },

  createComment: async (input) => {
    try {
      const res = await fetch("/api/community/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) return false;
      // 댓글 다시 불러오기
      await get().fetchComments(input.post_id);
      // 글 댓글 수 업데이트
      set((s) => ({
        currentPost: s.currentPost ? { ...s.currentPost, comment_count: s.currentPost.comment_count + 1 } : null,
      }));
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

  setCategory: (category) => {
    set({ currentCategory: category, posts: [], hasMore: true, currentPage: 1 });
  },

  setSort: (sort) => {
    set({ currentSort: sort, posts: [], hasMore: true, currentPage: 1 });
  },

  setPeriod: (period) => {
    set({ currentPeriod: period, posts: [], hasMore: true, currentPage: 1 });
  },

  reset: () => {
    set({
      posts: [], currentCategory: null, currentSort: "hot", currentPeriod: "week",
      currentPage: 1, hasMore: true, isLoading: false, total: 0,
      currentPost: null, comments: [], postLoading: false, commentsLoading: false,
    });
  },
}));
