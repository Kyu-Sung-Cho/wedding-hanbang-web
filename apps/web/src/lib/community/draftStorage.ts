const COMMUNITY_POST_DRAFT_PREFIX = "community_post_draft:";
const LEGACY_COMMUNITY_POST_DRAFT_KEY = "community_post_draft";
const COMMUNITY_POST_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface OwnedCommunityPostDraft {
  ownerId: string;
  savedAt: number;
}

export function communityPostDraftKey(userId: string): string {
  return `${COMMUNITY_POST_DRAFT_PREFIX}${encodeURIComponent(userId)}`;
}

export function readOwnedCommunityPostDraft<T extends OwnedCommunityPostDraft>(
  storage: Storage,
  userId: string,
  now = Date.now(),
): T | null {
  // 구버전의 계정 미귀속 초안은 누구 것인지 증명할 수 없으므로 복원하지 않는다.
  storage.removeItem(LEGACY_COMMUNITY_POST_DRAFT_KEY);
  const key = communityPostDraftKey(userId);
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    const draft = JSON.parse(raw) as T;
    if (
      draft.ownerId !== userId
      || !Number.isFinite(draft.savedAt)
      || now - draft.savedAt > COMMUNITY_POST_DRAFT_MAX_AGE_MS
      || draft.savedAt > now + 60_000
    ) {
      storage.removeItem(key);
      return null;
    }
    return draft;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function removeCommunityPostDraft(storage: Storage, userId: string): void {
  storage.removeItem(communityPostDraftKey(userId));
}

export function clearCommunityPostDrafts(storage: Storage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (
      key === LEGACY_COMMUNITY_POST_DRAFT_KEY
      || key?.startsWith(COMMUNITY_POST_DRAFT_PREFIX)
    ) {
      keys.push(key);
    }
  }
  keys.forEach((key) => storage.removeItem(key));
}
