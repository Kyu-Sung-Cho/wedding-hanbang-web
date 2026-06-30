import { CATEGORY_MAP } from "@/constants/communityCategories";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import type { CommunityCategory } from "@/types/community.types";

const COMMUNITY_FEED_HASH = "community-feed";

function normalizeFragment(fragment?: string): string {
  if (!fragment) return "";
  if (fragment.startsWith("#")) return fragment;
  return `#${encodeURIComponent(fragment)}`;
}

export function isCommunityCategory(value: string | null | undefined): value is CommunityCategory {
  return Boolean(value && Object.prototype.hasOwnProperty.call(CATEGORY_MAP, value));
}

export function communityPostRoute(postId: string, fragment?: string): string {
  return `/community/post/${encodeURIComponent(postId)}${normalizeFragment(fragment)}`;
}

export function communityPostPath(postId: string, fragment?: string): string {
  return weddingPath(communityPostRoute(postId, fragment));
}

export function communityPostLinkProps(postId: string, fragment?: string) {
  return weddingLinkProps(communityPostRoute(postId, fragment));
}

export function communityPostUrl(origin: string, postId: string, fragment?: string): string {
  return `${origin}${communityPostPath(postId, fragment)}`;
}

export function communityCategoryFeedPath(category: CommunityCategory, tag?: string): string {
  const query = new URLSearchParams({
    category,
    feed: "all",
  });

  if (tag) query.set("tag", tag);

  return weddingPath(`/community?${query.toString()}#${COMMUNITY_FEED_HASH}`);
}
