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

type OwnedCacheEntry<T> = {
  ownerId: string;
  value: T;
  cachedAt: number;
};

const FEED_TTL_MS = 2 * 60_000;
const POST_TTL_MS = 2 * 60_000;
const COMMENT_TTL_MS = 30_000;
const COHORT_TTL_MS = 60_000;

let activeOwnerId: string | null = null;
let ownerRevision = 0;
const postCache = new Map<string, OwnedCacheEntry<CachedCommunityPost>>();
const commentCache = new Map<string, OwnedCacheEntry<CachedCommunityComment[]>>();
const feedCache = new Map<string, OwnedCacheEntry<CachedCommunityPost[]>>();
let cohortCache: OwnedCacheEntry<unknown> | null = null;

function isReadableByOwner(ownerId: string | null | undefined): ownerId is string {
  return Boolean(ownerId) && ownerId === activeOwnerId;
}

function readOwnedEntry<T>(
  ownerId: string | null | undefined,
  entry: OwnedCacheEntry<T> | undefined,
  ttlMs: number,
  onExpired: () => void,
): T | null {
  if (!isReadableByOwner(ownerId) || !entry || entry.ownerId !== ownerId) return null;

  if (Date.now() - entry.cachedAt > ttlMs) {
    onExpired();
    return null;
  }

  return entry.value;
}

export function isCommunityCacheOwner(ownerId: string | null | undefined) {
  return isReadableByOwner(ownerId);
}

export function getCommunityCacheOwnerRevision() {
  return ownerRevision;
}

export function setCommunityCacheOwner(ownerId: string | null | undefined) {
  const nextOwnerId = ownerId || null;
  if (nextOwnerId === activeOwnerId) return;

  clearCommunityCaches();
  activeOwnerId = nextOwnerId;
  ownerRevision += 1;
}

export function getCachedCommunityFeed<T extends CachedCommunityPost>(
  ownerId: string | null | undefined,
  category: string | null | undefined,
) {
  if (!category) return null;

  return readOwnedEntry(
    ownerId,
    feedCache.get(category),
    FEED_TTL_MS,
    () => feedCache.delete(category),
  ) as T[] | null;
}

export function putCachedCommunityFeed<T extends CachedCommunityPost>(
  ownerId: string | null | undefined,
  category: string,
  posts: T[],
) {
  if (!isReadableByOwner(ownerId)) return false;
  feedCache.set(category, { ownerId, value: posts, cachedAt: Date.now() });
  return true;
}

export function clearCommunityCaches() {
  postCache.clear();
  commentCache.clear();
  feedCache.clear();
  cohortCache = null;
}

export function getCachedCommunityPost(
  ownerId: string | null | undefined,
  id: string | null | undefined,
) {
  if (!id) return null;

  return readOwnedEntry(
    ownerId,
    postCache.get(id),
    POST_TTL_MS,
    () => postCache.delete(id),
  );
}

export function putCachedCommunityPost(
  ownerId: string | null | undefined,
  post: CachedCommunityPost,
) {
  if (!isReadableByOwner(ownerId)) return false;
  postCache.set(post.id, { ownerId, value: post, cachedAt: Date.now() });
  return true;
}

export function putCachedCommunityPosts(
  ownerId: string | null | undefined,
  posts: CachedCommunityPost[],
) {
  if (!isReadableByOwner(ownerId)) return false;

  const cachedAt = Date.now();
  for (const post of posts) {
    postCache.set(post.id, { ownerId, value: post, cachedAt });
  }
  return true;
}

export function getCachedCommunityComments(
  ownerId: string | null | undefined,
  postId: string | null | undefined,
) {
  if (!postId) return null;

  return readOwnedEntry(
    ownerId,
    commentCache.get(postId),
    COMMENT_TTL_MS,
    () => commentCache.delete(postId),
  );
}

export function putCachedCommunityComments(
  ownerId: string | null | undefined,
  postId: string,
  comments: CachedCommunityComment[],
) {
  if (!isReadableByOwner(ownerId)) return false;
  commentCache.set(postId, { ownerId, value: comments, cachedAt: Date.now() });
  return true;
}

export function getCachedCommunityCohort<T>(
  ownerId: string | null | undefined,
) {
  return readOwnedEntry(
    ownerId,
    cohortCache ?? undefined,
    COHORT_TTL_MS,
    () => {
      cohortCache = null;
    },
  ) as T | null;
}

export function putCachedCommunityCohort<T>(
  ownerId: string | null | undefined,
  value: T,
) {
  if (!isReadableByOwner(ownerId)) return false;
  cohortCache = { ownerId, value, cachedAt: Date.now() };
  return true;
}
