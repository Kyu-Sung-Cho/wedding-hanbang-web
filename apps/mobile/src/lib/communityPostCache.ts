export type CachedCommunityAuthor = {
  user_id: string;
  nickname: string;
};

export type CachedCommunityPost = {
  id: string;
  author_id: string;
  viewer_is_author: boolean;
  title: string;
  content: string;
  category: string;
  ad_disclosure?: string | null;
  sponsorship_detail?: string | null;
  upvote_count: number;
  downvote_count: number;
  comment_count: number;
  view_count: number;
  visibility: "public" | "members" | "draft";
  under_review: boolean;
  created_at: string;
  author: CachedCommunityAuthor;
};

export type CachedCommunityComment = {
  id: string;
  author_id: string;
  viewer_is_author: boolean;
  content: string;
  created_at: string;
  upvote_count?: number;
  author: CachedCommunityAuthor;
};

const POST_TTL_MS = 2 * 60_000;
const COMMENT_TTL_MS = 30_000;
const FEED_TTL_MS = 30_000;

const postCache = new Map<string, { post: CachedCommunityPost; cachedAt: number }>();
const commentCache = new Map<string, { comments: CachedCommunityComment[]; cachedAt: number }>();
const feedCache = new Map<string, { posts: CachedCommunityPost[]; cachedAt: number }>();
let activeOwnerId: string | null = null;

function isActiveOwner(ownerId: string): boolean {
  return ownerId.length > 0 && ownerId === activeOwnerId;
}

function isCacheablePost(post: CachedCommunityPost): boolean {
  return post.visibility === "public" && post.under_review === false;
}

export function setCommunityCacheOwner(ownerId: string | null) {
  const nextOwnerId = ownerId?.trim() || null;
  if (nextOwnerId === activeOwnerId) return;

  clearCommunityCaches();
  activeOwnerId = nextOwnerId;
}

export function getCachedCommunityFeed<T extends CachedCommunityPost>(
  ownerId: string,
  category: string | null | undefined,
) {
  if (!isActiveOwner(ownerId) || !category) return null;

  const cached = feedCache.get(category);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > FEED_TTL_MS) {
    feedCache.delete(category);
    return null;
  }
  return cached.posts as T[];
}

export function putCachedCommunityFeed<T extends CachedCommunityPost>(
  ownerId: string,
  category: string,
  posts: T[],
) {
  if (!isActiveOwner(ownerId)) return;
  feedCache.set(category, {
    posts: posts.filter(isCacheablePost),
    cachedAt: Date.now(),
  });
}

export function clearCommunityCaches() {
  postCache.clear();
  commentCache.clear();
  feedCache.clear();
}

export function getCachedCommunityPost(ownerId: string, id: string | null | undefined) {
  if (!isActiveOwner(ownerId) || !id) return null;

  const cached = postCache.get(id);
  if (!cached) return null;

  if (Date.now() - cached.cachedAt > POST_TTL_MS) {
    postCache.delete(id);
    return null;
  }

  return cached.post;
}

export function putCachedCommunityPost(ownerId: string, post: CachedCommunityPost) {
  if (!isActiveOwner(ownerId)) return;
  if (!isCacheablePost(post)) {
    postCache.delete(post.id);
    return;
  }
  postCache.set(post.id, { post, cachedAt: Date.now() });
}

export function putCachedCommunityPosts(ownerId: string, posts: CachedCommunityPost[]) {
  if (!isActiveOwner(ownerId)) return;
  const cachedAt = Date.now();
  for (const post of posts) {
    if (isCacheablePost(post)) {
      postCache.set(post.id, { post, cachedAt });
    } else {
      postCache.delete(post.id);
    }
  }
}

export function getCachedCommunityComments(ownerId: string, postId: string | null | undefined) {
  if (!isActiveOwner(ownerId) || !postId) return null;

  const cached = commentCache.get(postId);
  if (!cached) return null;

  if (Date.now() - cached.cachedAt > COMMENT_TTL_MS) {
    commentCache.delete(postId);
    return null;
  }

  return cached.comments;
}

export function putCachedCommunityComments(
  ownerId: string,
  postId: string,
  comments: CachedCommunityComment[],
) {
  if (!isActiveOwner(ownerId)) return;
  commentCache.set(postId, { comments, cachedAt: Date.now() });
}
