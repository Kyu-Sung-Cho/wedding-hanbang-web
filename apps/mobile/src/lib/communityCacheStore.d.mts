import type { CommunityCacheScopeToken } from "./communityCacheSession.mjs";

export interface CommunityCacheStoreOptions {
  now?: () => number;
  feedTtlMs?: number;
  postTtlMs?: number;
  commentTtlMs?: number;
  cohortTtlMs?: number;
}

export interface CommunityCacheStore {
  setViewer(viewerId: string | null): boolean;
  capture(): CommunityCacheScopeToken;
  isCurrent(token: CommunityCacheScopeToken | null): boolean;
  getFeed<T>(category: string | null | undefined): T[] | null;
  putFeed<T>(category: string, posts: T[], token?: CommunityCacheScopeToken): boolean;
  getPost<T>(id: string | null | undefined): T | null;
  putPost<T extends { id: string }>(post: T, token?: CommunityCacheScopeToken): boolean;
  putPosts<T extends { id: string }>(posts: T[], token?: CommunityCacheScopeToken): boolean;
  getComments<T>(postId: string | null | undefined): T[] | null;
  putComments<T>(postId: string, comments: T[], token?: CommunityCacheScopeToken): boolean;
  getCohort<T>(): T | null;
  putCohort<T>(cohort: T, token?: CommunityCacheScopeToken): boolean;
  clear(): void;
}

export function createCommunityCacheStore(options?: CommunityCacheStoreOptions): CommunityCacheStore;
