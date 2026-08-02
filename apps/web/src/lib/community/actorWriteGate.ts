const ACTOR_WRITE_DENIAL_MARKERS = [
  "community_actor_suspended",
  "community_actor_write_profile_required",
  "community_actor_write_actor_not_found",
  "community_actor_write_actor_required",
] as const;

type DatabaseErrorLike = {
  code?: unknown;
  message?: unknown;
};

export const COMMUNITY_WRITE_DENIED_MESSAGE =
  "현재 계정은 커뮤니티에 새 내용을 쓰거나 변경할 수 없습니다.";

export function isCommunityActorWriteDenied(
  error: unknown,
): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as DatabaseErrorLike;
  if (candidate.code !== undefined && candidate.code !== "42501") return false;
  if (typeof candidate.message !== "string") return false;

  const message = candidate.message.toLowerCase();
  return ACTOR_WRITE_DENIAL_MARKERS.some((marker) => message.includes(marker));
}
