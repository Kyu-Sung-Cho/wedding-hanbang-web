import type { PostVisibility } from "@/types/community.types";

export const PUBLIC_COMMUNITY_POST_VISIBILITY = "public" as const;
export const PUBLIC_COMMUNITY_POST_UNDER_REVIEW = false as const;
export const PUBLIC_COMMUNITY_POST_QUERY_FILTERS = {
  visibility: PUBLIC_COMMUNITY_POST_VISIBILITY,
  underReview: PUBLIC_COMMUNITY_POST_UNDER_REVIEW,
} as const;

export type CommunityPostAccessRow = {
  author_id: string | null;
  visibility: PostVisibility | string | null;
  under_review?: boolean | null;
};

export type CommunityPostViewer = {
  userId?: string | null;
  isAdmin?: boolean;
};

export function isPublicCommunityPost(post: CommunityPostAccessRow): boolean {
  return (
    post.visibility === PUBLIC_COMMUNITY_POST_VISIBILITY &&
    post.under_review !== true
  );
}

export function canReadCommunityPost(
  post: CommunityPostAccessRow,
  viewer: CommunityPostViewer = {},
): boolean {
  if (viewer.isAdmin) return true;

  const isAuthor = Boolean(viewer.userId && post.author_id === viewer.userId);
  if (post.under_review === true) return isAuthor;

  if (post.visibility === "public") return true;
  if (post.visibility === "members") return Boolean(viewer.userId);
  if (post.visibility === "draft") return isAuthor;

  return false;
}

export function communityReadablePostOrFilter(viewerId: string): string {
  return [
    "and(visibility.eq.public,under_review.eq.false)",
    "and(visibility.eq.members,under_review.eq.false)",
    `and(visibility.eq.draft,author_id.eq.${viewerId})`,
    `and(under_review.eq.true,author_id.eq.${viewerId})`,
  ].join(",");
}
