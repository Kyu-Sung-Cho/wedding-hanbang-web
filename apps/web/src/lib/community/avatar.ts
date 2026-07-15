const PUBLIC_EMOJI_AVATAR_MAX_CODE_UNITS = 16;

export function normalizeCommunityAvatar(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const candidate = value.trim();
  if (!candidate || candidate.length > PUBLIC_EMOJI_AVATAR_MAX_CODE_UNITS) return null;
  if (!/\p{Extended_Pictographic}/u.test(candidate)) return null;
  if (/[^\p{Extended_Pictographic}\p{Emoji_Modifier}\u200D\uFE0F]/u.test(candidate)) {
    return null;
  }

  return candidate;
}
