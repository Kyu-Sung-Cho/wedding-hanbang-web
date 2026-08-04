export interface CommunityCacheScopeToken {
  generation: number;
  viewerKey: string;
}

export interface CommunityCacheSession {
  setViewer(viewerId: string | null): boolean;
  capture(): CommunityCacheScopeToken;
  isCurrent(token: CommunityCacheScopeToken | null): boolean;
}

export function createCommunityCacheSession(): CommunityCacheSession;
