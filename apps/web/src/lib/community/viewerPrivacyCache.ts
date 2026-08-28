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
  /**
   * 이 전환으로 **들어오는** 뷰어. 그 사람 자신의 임시저장은 지우지 않는다.
   *
   * 없이는 앱을 다시 열 때마다 내 초안이 사라졌다. 스토어에 `persist` 가 없어
   * `viewerId` 가 늘 `null` 로 시작하므로, 로그인한 채 아무 화면이나 새로 열면
   * `null → 내 아이디` 전환이 일어나고 이 purge 가 **내 것까지** 지웠다. 화면은
   * "자동 저장됨" 이라고 알려 준 뒤였다.
   *
   * 초안 키는 사용자별로 나뉘어 있으므로(`communityPostDraftKey`), 들어오는
   * 사람 자신의 키 하나만 남기는 것은 **구조적으로** 남의 글을 남길 수 없다.
   */
  preserveViewerId?: string | null;
}): void {
  if (typeof window === "undefined") return;
  const preserveGuestDraftHandoff =
    options?.preserveGuestDraftHandoff === true
    && hasGuestCommunityDraftHandoff();
  const incomingViewerId = options?.preserveViewerId?.trim() || null;
  const preservedOwnDraftKey =
    incomingViewerId !== null && incomingViewerId !== "demo"
      ? communityPostDraftKey(incomingViewerId)
      : null;

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
        )
        && !(preservedOwnDraftKey !== null && key === preservedOwnDraftKey),
    ).forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // A failed purge must not make an auth transition throw.
  }
}

export function isCommunityFeedSessionKey(key: string): boolean {
  return key.startsWith("community:feed:")
    || (key.startsWith("community:viewer:") && key.includes(":feed:"));
}
