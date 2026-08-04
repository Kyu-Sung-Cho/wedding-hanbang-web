const COMMUNITY_SESSION_PREFIX = "community:";
const COMMUNITY_POST_DRAFT_PREFIX = "community:post-draft:v2:";
const LEGACY_COMMUNITY_POST_DRAFT_KEY = "community_post_draft";
const GUEST_DRAFT_HANDOFF_KEY = "community:draft-handoff:v1";
const GUEST_DRAFT_HANDOFF_VALUE = "guest-login";

export function communityViewerToken(viewerId: string | null): string {
  return viewerId ? encodeURIComponent(viewerId) : "guest";
}

export function scopedCommunitySessionCacheKey(
  key: string,
  viewerId: string | null,
): string {
  const suffix = key.startsWith(COMMUNITY_SESSION_PREFIX)
    ? key.slice(COMMUNITY_SESSION_PREFIX.length)
    : key;
  return `${COMMUNITY_SESSION_PREFIX}viewer:${communityViewerToken(viewerId)}:${suffix}`;
}

export function communityPostDraftKey(viewerId: string | null): string {
  return `${COMMUNITY_POST_DRAFT_PREFIX}${communityViewerToken(viewerId)}`;
}

export function markGuestCommunityDraftHandoff(): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(
      GUEST_DRAFT_HANDOFF_KEY,
      GUEST_DRAFT_HANDOFF_VALUE,
    );
    return true;
  } catch {
    return false;
  }
}

export function hasGuestCommunityDraftHandoff(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(GUEST_DRAFT_HANDOFF_KEY)
      === GUEST_DRAFT_HANDOFF_VALUE
      && window.localStorage.getItem(communityPostDraftKey(null)) !== null;
  } catch {
    return false;
  }
}

export function claimGuestCommunityDraftForViewer(viewerId: string): boolean {
  if (typeof window === "undefined" || !viewerId || !hasGuestCommunityDraftHandoff()) {
    return false;
  }

  const guestKey = communityPostDraftKey(null);
  const viewerKey = communityPostDraftKey(viewerId);
  try {
    const raw = window.localStorage.getItem(guestKey);
    if (!raw) return false;
    // Copy first: if quota/storage blocks the write, the source remains recoverable.
    window.localStorage.setItem(viewerKey, raw);
    window.localStorage.removeItem(guestKey);
    window.sessionStorage.removeItem(GUEST_DRAFT_HANDOFF_KEY);
    return true;
  } catch {
    return false;
  }
}

function matchingStorageKeys(
  storage: Storage,
  predicate: (key: string) => boolean,
): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && predicate(key)) keys.push(key);
  }
  return keys;
}

/** Clears browser-persisted community data that can be viewer-specific. */
export function purgeCommunityBrowserPrivacyCache(options?: {
  preserveGuestDraftHandoff?: boolean;
}): void {
  if (typeof window === "undefined") return;
  const preserveGuestDraftHandoff =
    options?.preserveGuestDraftHandoff === true
    && hasGuestCommunityDraftHandoff();

  try {
    matchingStorageKeys(window.sessionStorage, (key) =>
      key.startsWith(COMMUNITY_SESSION_PREFIX)
      && !(preserveGuestDraftHandoff && key === GUEST_DRAFT_HANDOFF_KEY),
    ).forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }

  try {
    matchingStorageKeys(
      window.localStorage,
      (key) =>
        (key === LEGACY_COMMUNITY_POST_DRAFT_KEY
          || key.startsWith(COMMUNITY_POST_DRAFT_PREFIX))
        && !(
          preserveGuestDraftHandoff
          && key === communityPostDraftKey(null)
        ),
    ).forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // A failed purge must not make an auth transition throw.
  }
}

export function isCommunityFeedSessionKey(key: string): boolean {
  return key.startsWith("community:feed:")
    || (key.startsWith("community:viewer:") && key.includes(":feed:"));
}
