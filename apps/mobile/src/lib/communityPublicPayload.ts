export type MobileCommunityAuthor = {
  user_id: string;
  nickname: string;
  avatar_url?: string | null;
};

export type MobileCommunityActorPayload = {
  author_id: string;
  viewer_is_author: boolean;
  author: MobileCommunityAuthor;
};

const PUBLIC_EMOJI_AVATAR_MAX_CODE_UNITS = 16;

export function normalizeMobileCommunityAvatar(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const candidate = value.trim();
  if (!candidate || candidate.length > PUBLIC_EMOJI_AVATAR_MAX_CODE_UNITS) return null;
  if (!/\p{Extended_Pictographic}/u.test(candidate)) return null;
  // ZWJ emoji sequences intentionally combine multiple Unicode characters.
  // eslint-disable-next-line no-misleading-character-class
  if (/[^\p{Extended_Pictographic}\p{Emoji_Modifier}\u200D\uFE0F]/u.test(candidate)) {
    return null;
  }
  return candidate;
}

export function hasTrustedCommunityActor(
  value: unknown,
): value is MobileCommunityActorPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const author = item.author;
  if (!author || typeof author !== "object" || Array.isArray(author)) return false;
  const actor = author as Record<string, unknown>;

  return (
    typeof item.author_id === "string" &&
    item.author_id.length > 0 &&
    typeof item.viewer_is_author === "boolean" &&
    typeof actor.user_id === "string" &&
    actor.user_id === item.author_id &&
    typeof actor.nickname === "string" &&
    actor.nickname.trim().length > 0 &&
    (actor.avatar_url === undefined ||
      actor.avatar_url === null ||
      normalizeMobileCommunityAvatar(actor.avatar_url) === actor.avatar_url)
  );
}
