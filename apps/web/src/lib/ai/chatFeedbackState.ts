export type StoredChatFeedbackRating = "good" | "bad";
export type StoredChatFeedbackState = Record<string, StoredChatFeedbackRating>;

export const MAX_STORED_CHAT_FEEDBACK = 500;
const MAX_MESSAGE_ID_CHARS = 128;

function isSafeMessageId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_MESSAGE_ID_CHARS &&
    value !== "__proto__" &&
    value !== "prototype" &&
    value !== "constructor"
  );
}

export function parseStoredChatFeedback(value: string | null): StoredChatFeedbackState {
  if (!value) return {};

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const safe: StoredChatFeedbackState = Object.create(null);
    const entries = Object.entries(parsed).slice(-MAX_STORED_CHAT_FEEDBACK);
    for (const [messageId, rating] of entries) {
      if (
        isSafeMessageId(messageId) &&
        (rating === "good" || rating === "bad")
      ) {
        safe[messageId] = rating;
      }
    }
    return safe;
  } catch {
    return {};
  }
}

export function addStoredChatFeedback(
  current: StoredChatFeedbackState,
  messageId: string,
  rating: StoredChatFeedbackRating,
): StoredChatFeedbackState {
  if (!isSafeMessageId(messageId)) return current;

  const next: StoredChatFeedbackState = Object.create(null);
  const retained = Object.entries(current)
    .filter(([id, value]) => isSafeMessageId(id) && (value === "good" || value === "bad"))
    .filter(([id]) => id !== messageId)
    .slice(-(MAX_STORED_CHAT_FEEDBACK - 1));
  for (const [id, value] of retained) next[id] = value;
  next[messageId] = rating;
  return next;
}
