import AsyncStorage from "@react-native-async-storage/async-storage";

export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const POST_DRAFT_PREFIX = "@hanbang/community-post-draft/v1";
const QUICK_REVIEW_DRAFT_PREFIX = "@hanbang/quick-review-draft/v1";

export interface CommunityPostDraft {
  category: string;
  adDisclosure: string;
  sponsorDetail: string;
  title: string;
  content: string;
}

export interface QuickReviewDraft {
  vendorName: string;
  category: string;
  rating: number;
  review: string;
  adDisclosure: string;
}

interface StoredDraft<T> {
  version: 1;
  savedAt: number;
  value: T;
}

function accountDraftKey(prefix: string, userId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) {
    throw new Error("invalid_draft_owner");
  }
  return `${prefix}/${userId}`;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function isCommunityPostDraft(value: unknown): value is CommunityPostDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<CommunityPostDraft>;
  return (
    isBoundedString(draft.category, 40) &&
    isBoundedString(draft.adDisclosure, 20) &&
    isBoundedString(draft.sponsorDetail, 500) &&
    isBoundedString(draft.title, 200) &&
    isBoundedString(draft.content, 50_000)
  );
}

function isQuickReviewDraft(value: unknown): value is QuickReviewDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<QuickReviewDraft>;
  return (
    isBoundedString(draft.vendorName, 200) &&
    isBoundedString(draft.category, 40) &&
    typeof draft.rating === "number" &&
    Number.isInteger(draft.rating) &&
    draft.rating >= 0 &&
    draft.rating <= 5 &&
    isBoundedString(draft.review, 100) &&
    isBoundedString(draft.adDisclosure, 20)
  );
}

async function loadDraft<T>(
  key: string,
  validate: (value: unknown) => value is T,
): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw) as Partial<StoredDraft<unknown>>;
    const isFresh =
      stored.version === 1 &&
      typeof stored.savedAt === "number" &&
      Date.now() - stored.savedAt >= 0 &&
      Date.now() - stored.savedAt <= DRAFT_MAX_AGE_MS;

    if (!isFresh || !validate(stored.value)) {
      await AsyncStorage.removeItem(key);
      return null;
    }
    return stored.value;
  } catch {
    await AsyncStorage.removeItem(key);
    return null;
  }
}

async function saveDraft<T>(key: string, value: T): Promise<void> {
  const stored: StoredDraft<T> = { version: 1, savedAt: Date.now(), value };
  await AsyncStorage.setItem(key, JSON.stringify(stored));
}

export function loadCommunityPostDraft(userId: string) {
  return loadDraft(accountDraftKey(POST_DRAFT_PREFIX, userId), isCommunityPostDraft);
}

export function saveCommunityPostDraft(userId: string, value: CommunityPostDraft) {
  return saveDraft(accountDraftKey(POST_DRAFT_PREFIX, userId), value);
}

export function clearCommunityPostDraft(userId: string) {
  return AsyncStorage.removeItem(accountDraftKey(POST_DRAFT_PREFIX, userId));
}

export function loadQuickReviewDraft(userId: string) {
  return loadDraft(accountDraftKey(QUICK_REVIEW_DRAFT_PREFIX, userId), isQuickReviewDraft);
}

export function saveQuickReviewDraft(userId: string, value: QuickReviewDraft) {
  return saveDraft(accountDraftKey(QUICK_REVIEW_DRAFT_PREFIX, userId), value);
}

export function clearQuickReviewDraft(userId: string) {
  return AsyncStorage.removeItem(accountDraftKey(QUICK_REVIEW_DRAFT_PREFIX, userId));
}
