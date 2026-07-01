import type { CommunityAvatarRole } from "@/components/community/CommunityAvatar";

export type CachedCommunityAuthor = {
  nickname: string;
  rank: string;
  role?: CommunityAvatarRole | null;
} | null;

export type CachedCommunityPost = {
  id: string;
  title: string;
  content: string;
  category: string;
  ad_disclosure?: string | null;
  upvote_count: number;
  downvote_count: number;
  comment_count: number;
  view_count: number;
  image_urls?: string[] | null;
  created_at: string;
  author: CachedCommunityAuthor;
};

export type CachedCommunityComment = {
  id: string;
  content: string;
  created_at: string;
  author: CachedCommunityAuthor;
};

const POST_TTL_MS = 2 * 60_000;
const COMMENT_TTL_MS = 30_000;

const postCache = new Map<string, { post: CachedCommunityPost; cachedAt: number }>();
const commentCache = new Map<string, { comments: CachedCommunityComment[]; cachedAt: number }>();

export function getCachedCommunityPost(id: string | null | undefined) {
  if (!id) return null;

  const cached = postCache.get(id);
  if (!cached) return null;

  if (Date.now() - cached.cachedAt > POST_TTL_MS) {
    postCache.delete(id);
    return null;
  }

  return cached.post;
}

export function putCachedCommunityPost(post: CachedCommunityPost) {
  postCache.set(post.id, { post, cachedAt: Date.now() });
}

export function putCachedCommunityPosts(posts: CachedCommunityPost[]) {
  const cachedAt = Date.now();
  for (const post of posts) {
    postCache.set(post.id, { post, cachedAt });
  }
}

export function getCachedCommunityComments(postId: string | null | undefined) {
  if (!postId) return null;

  const cached = commentCache.get(postId);
  if (!cached) return null;

  if (Date.now() - cached.cachedAt > COMMENT_TTL_MS) {
    commentCache.delete(postId);
    return null;
  }

  return cached.comments;
}

export function putCachedCommunityComments(
  postId: string,
  comments: CachedCommunityComment[],
) {
  commentCache.set(postId, { comments, cachedAt: Date.now() });
}
