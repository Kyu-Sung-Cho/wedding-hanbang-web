export const COMMUNITY_AVATAR_OPTIONS = ["🌿", "💍", "🌸", "🤍", "✨", "👑"] as const;

export type CommunityAvatar = (typeof COMMUNITY_AVATAR_OPTIONS)[number];

const communityAvatarSet = new Set<string>(COMMUNITY_AVATAR_OPTIONS);

/**
 * 커뮤니티 아바타는 제품이 제공하는 이모지만 허용한다.
 * URL을 허용하면 프로필을 보는 사용자의 브라우저에서 내부 GET API나
 * 외부 추적 픽셀을 호출할 수 있으므로 저장·렌더링 경계에서 모두 거부한다.
 */
export function normalizeCommunityAvatar(value: unknown): CommunityAvatar | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  return communityAvatarSet.has(normalized) ? (normalized as CommunityAvatar) : null;
}
