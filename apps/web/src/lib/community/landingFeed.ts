import type { PostWithAuthor } from "@/types/community.types";

const ANSWER_WAITING_CATEGORIES = new Set(["is_normal", "ama"]);

export function selectRecentAnswerWaitingPosts(
  posts: PostWithAuthor[],
  limit = 3,
): PostWithAuthor[] {
  const safeLimit = Math.max(0, Math.min(10, limit));
  return posts
    .filter(
      (post) =>
        !post.is_resolved &&
        (post.comment_count ?? 0) === 0 &&
        ANSWER_WAITING_CATEGORIES.has(post.category) &&
        post.ad_disclosure === "general",
    )
    .slice(0, safeLimit);
}

export function excludeFeaturedPostsWhenFeedRemains(
  posts: PostWithAuthor[],
  featuredPosts: PostWithAuthor[],
): PostWithAuthor[] {
  const featuredIds = new Set(featuredPosts.map((post) => post.id));
  const remainingPosts = posts.filter((post) => !featuredIds.has(post.id));
  return remainingPosts.length > 0 ? remainingPosts : posts;
}
