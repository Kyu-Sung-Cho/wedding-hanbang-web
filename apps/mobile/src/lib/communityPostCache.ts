import type { CommunityAvatarRole } from "@/components/community/CommunityAvatar";
import type {
  CommunityAdDisclosure,
  CommunityContentOrigin,
} from "./communityTrust.mjs";
import { createCommunityCacheStore } from "./communityCacheStore.mjs";
import type { CommunityCacheScopeToken } from "./communityCacheSession.mjs";

export type CachedCommunityAuthor = {
  nickname: string;
  rank: string;
  role?: CommunityAvatarRole | null;
} | null;

export type CachedCommunityPost = {
  id: string;
  author_id?: string;
  title: string;
  content: string;
  category: string;
  content_origin: CommunityContentOrigin;
  ad_disclosure: CommunityAdDisclosure;
  sponsorship_detail: string | null;
  is_resolved: boolean;
  under_review: boolean;
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
  author_id?: string;
  content: string;
  created_at: string;
  content_origin: CommunityContentOrigin;
  author: CachedCommunityAuthor;
};

export type CachedCommunityCohort<TMyCohort, TCohortRoom> = {
  myCohort: TMyCohort | null;
  cohortRooms: TCohortRoom[];
};

export type { CommunityCacheScopeToken };

const communityCache = createCommunityCacheStore();

export function setCommunityCacheViewer(viewerId: string | null) {
  return communityCache.setViewer(viewerId);
}

export function captureCommunityCacheScope() {
  return communityCache.capture();
}

export function isCommunityCacheScopeCurrent(token: CommunityCacheScopeToken | null) {
  return communityCache.isCurrent(token);
}

export function getCachedCommunityFeed<T extends CachedCommunityPost>(
  category: string | null | undefined,
) {
  return communityCache.getFeed<T>(category);
}

export function putCachedCommunityFeed<T extends CachedCommunityPost>(
  category: string,
  posts: T[],
  token?: CommunityCacheScopeToken,
) {
  return communityCache.putFeed(category, posts, token);
}

export function clearCommunityCaches() {
  communityCache.clear();
}

export function getCachedCommunityPost(id: string | null | undefined) {
  return communityCache.getPost<CachedCommunityPost>(id);
}

export function putCachedCommunityPost(
  post: CachedCommunityPost,
  token?: CommunityCacheScopeToken,
) {
  return communityCache.putPost(post, token);
}

export function putCachedCommunityPosts(
  posts: CachedCommunityPost[],
  token?: CommunityCacheScopeToken,
) {
  return communityCache.putPosts(posts, token);
}

export function getCachedCommunityComments(postId: string | null | undefined) {
  return communityCache.getComments<CachedCommunityComment>(postId);
}

export function putCachedCommunityComments(
  postId: string,
  comments: CachedCommunityComment[],
  token?: CommunityCacheScopeToken,
) {
  return communityCache.putComments(postId, comments, token);
}

export function getCachedCommunityCohort<TMyCohort, TCohortRoom>() {
  return communityCache.getCohort<CachedCommunityCohort<TMyCohort, TCohortRoom>>();
}

export function putCachedCommunityCohort<TMyCohort, TCohortRoom>(
  cohort: CachedCommunityCohort<TMyCohort, TCohortRoom>,
  token?: CommunityCacheScopeToken,
) {
  return communityCache.putCohort(cohort, token);
}
