import { createCommunityCacheSession } from "./communityCacheSession.mjs";

const DEFAULT_FEED_TTL_MS = 2 * 60_000;
const DEFAULT_POST_TTL_MS = 2 * 60_000;
const DEFAULT_COMMENT_TTL_MS = 30_000;
const DEFAULT_COHORT_TTL_MS = 60_000;

export function createCommunityCacheStore(options = {}) {
  const now = options.now ?? Date.now;
  const feedTtlMs = options.feedTtlMs ?? DEFAULT_FEED_TTL_MS;
  const postTtlMs = options.postTtlMs ?? DEFAULT_POST_TTL_MS;
  const commentTtlMs = options.commentTtlMs ?? DEFAULT_COMMENT_TTL_MS;
  const cohortTtlMs = options.cohortTtlMs ?? DEFAULT_COHORT_TTL_MS;
  const session = createCommunityCacheSession();

  const feedCache = new Map();
  const postCache = new Map();
  const commentCache = new Map();
  const cohortCache = new Map();

  function scopedKey(resourceKey) {
    return `${session.capture().viewerKey}:${resourceKey}`;
  }

  function getFresh(cache, key, ttlMs) {
    const cached = cache.get(key);
    if (!cached) return null;
    if (now() - cached.cachedAt > ttlMs) {
      cache.delete(key);
      return null;
    }
    return cached.value;
  }

  function mayCommit(token) {
    return token === undefined || session.isCurrent(token);
  }

  function clear() {
    feedCache.clear();
    postCache.clear();
    commentCache.clear();
    cohortCache.clear();
  }

  return {
    setViewer(viewerId) {
      const changed = session.setViewer(viewerId);
      if (changed) clear();
      return changed;
    },

    capture() {
      return session.capture();
    },

    isCurrent(token) {
      return session.isCurrent(token);
    },

    getFeed(category) {
      if (!category) return null;
      return getFresh(feedCache, scopedKey(`feed:${category}`), feedTtlMs);
    },

    putFeed(category, posts, token) {
      if (!mayCommit(token)) return false;
      feedCache.set(scopedKey(`feed:${category}`), { value: posts, cachedAt: now() });
      return true;
    },

    getPost(id) {
      if (!id) return null;
      return getFresh(postCache, scopedKey(`post:${id}`), postTtlMs);
    },

    putPost(post, token) {
      if (!mayCommit(token)) return false;
      postCache.set(scopedKey(`post:${post.id}`), { value: post, cachedAt: now() });
      return true;
    },

    putPosts(posts, token) {
      if (!mayCommit(token)) return false;
      const cachedAt = now();
      for (const post of posts) {
        postCache.set(scopedKey(`post:${post.id}`), { value: post, cachedAt });
      }
      return true;
    },

    getComments(postId) {
      if (!postId) return null;
      return getFresh(commentCache, scopedKey(`comments:${postId}`), commentTtlMs);
    },

    putComments(postId, comments, token) {
      if (!mayCommit(token)) return false;
      commentCache.set(scopedKey(`comments:${postId}`), { value: comments, cachedAt: now() });
      return true;
    },

    getCohort() {
      return getFresh(cohortCache, scopedKey("cohort"), cohortTtlMs);
    },

    putCohort(cohort, token) {
      if (!mayCommit(token)) return false;
      cohortCache.set(scopedKey("cohort"), { value: cohort, cachedAt: now() });
      return true;
    },

    clear,
  };
}
