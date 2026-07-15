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
  actorId?: string | null;
  isAuthenticated?: boolean;
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

  const isAuthor = Boolean(viewer.actorId && post.author_id === viewer.actorId);
  if (post.under_review === true) return isAuthor;

  if (post.visibility === "public") return true;
  if (post.visibility === "members") return viewer.isAuthenticated === true;
  if (post.visibility === "draft") return isAuthor;

  return false;
}
