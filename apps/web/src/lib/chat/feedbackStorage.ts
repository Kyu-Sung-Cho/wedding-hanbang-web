export type ChatFeedbackRating = "good" | "bad";

export const LEGACY_CHAT_FEEDBACK_STORAGE_KEY = "hanbang_chat_feedback";
const CHAT_FEEDBACK_STORAGE_PREFIX = "hanbang_chat_feedback.user.";

function scopedKey(userId: string): string {
  return `${CHAT_FEEDBACK_STORAGE_PREFIX}${encodeURIComponent(userId)}`;
}

function parseFeedbackState(raw: string | null): Record<string, ChatFeedbackRating> {
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, ChatFeedbackRating] =>
          entry[1] === "good" || entry[1] === "bad",
      ),
    );
  } catch {
    return {};
  }
}

export function readChatFeedbackState(
  userId: string | null,
  storage: Storage | null = typeof window === "undefined" ? null : window.localStorage,
): Record<string, ChatFeedbackRating> {
  if (!storage || !userId) return {};

  try {
    // The legacy key mixed message identifiers from every account using the browser.
    storage.removeItem(LEGACY_CHAT_FEEDBACK_STORAGE_KEY);
    return parseFeedbackState(storage.getItem(scopedKey(userId)));
  } catch {
    return {};
  }
}

export function writeChatFeedbackState(
  userId: string | null,
  messageId: string,
  rating: ChatFeedbackRating,
  storage: Storage | null = typeof window === "undefined" ? null : window.localStorage,
): void {
  if (!storage || !userId) return;

  try {
    const state = readChatFeedbackState(userId, storage);
    storage.setItem(scopedKey(userId), JSON.stringify({ ...state, [messageId]: rating }));
  } catch {
    // Storage can be unavailable in private browsing. Feedback still reaches the API.
  }
}

export function clearChatFeedbackStorage(
  storage: Storage | null = typeof window === "undefined" ? null : window.localStorage,
): void {
  if (!storage) return;

  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (
        key === LEGACY_CHAT_FEEDBACK_STORAGE_KEY ||
        key?.startsWith(CHAT_FEEDBACK_STORAGE_PREFIX)
      ) {
        keys.push(key);
      }
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Best effort only: the protected UI is still blanked when storage is unavailable.
  }
}
