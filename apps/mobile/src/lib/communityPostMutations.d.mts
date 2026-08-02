export type ExpectedUserApiFetch = (
  expectedUserId: string,
  path: string,
  options?: RequestInit,
) => Promise<Response>;

export type CommunityVote = -1 | 0 | 1;
export type CommunityPostActionKind = "vote" | "bookmark" | "comment";

export interface CommunityIdentityToken {
  generation: number;
  ownerId: string;
}

export interface CommunityPostActionToken extends CommunityIdentityToken {
  kind: CommunityPostActionKind;
  operationId: number;
}

export interface CommunityPostActionGate {
  setOwner(ownerId: string | null): boolean;
  capture(): CommunityIdentityToken | null;
  begin(kind: CommunityPostActionKind): CommunityPostActionToken | null;
  hasActiveAction(): boolean;
  isCurrent(token: CommunityIdentityToken | CommunityPostActionToken | null): boolean;
  finish(token: CommunityPostActionToken): boolean;
}

export class CommunityPostMutationError extends Error {
  code: string;
  status: number;
  displayMessage: string;
  shouldRefresh: true;
}

export function createCommunityPostActionGate(): CommunityPostActionGate;

export interface CommunityCommentIdempotencyStore {
  keyFor(ownerId: string, postId: string, content: string): string;
  clearIf(key: string): boolean;
  clear(): void;
}

export function createCommunityCommentIdempotencyStore(
  createId: () => string,
): CommunityCommentIdempotencyStore;

export function parseCommunityVoteResponse(value: unknown): {
  upvoteCount: number;
  downvoteCount: number;
};

export function parseCommunityBookmarkResponse(value: unknown): {
  bookmarked: boolean;
  bookmarkCount: number;
};

export function submitCommunityVote(input: {
  apiFetchForExpectedUser: ExpectedUserApiFetch;
  ownerId: string;
  postId: string;
  voteType: 0 | 1;
}): Promise<{
  upvoteCount: number;
  downvoteCount: number;
  userVote: 0 | 1;
}>;

export function setCommunityBookmark(input: {
  apiFetchForExpectedUser: ExpectedUserApiFetch;
  ownerId: string;
  postId: string;
  bookmarked: boolean;
}): Promise<{
  bookmarked: boolean;
  bookmarkCount: number;
}>;

export function fetchCommunityPostSocialState(input: {
  apiFetchForExpectedUser: ExpectedUserApiFetch;
  ownerId: string;
  postId: string;
}): Promise<{
  userVote: CommunityVote;
  bookmarked: boolean;
  upvoteCount: number;
  downvoteCount: number;
}>;
