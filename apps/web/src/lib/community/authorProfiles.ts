import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCommunityAvatar } from "@/lib/community/avatar";
import type { PublicCommunityAuthor } from "@/types/community.types";

export type CommunityAuthorProfile = PublicCommunityAuthor;
export class CommunityAuthorProfileUnavailableError extends Error {
  constructor() {
    super("Community author profile data is unavailable");
    this.name = "CommunityAuthorProfileUnavailableError";
  }
}

export function requireCommunityAuthor(
  authorMap: Record<string, CommunityAuthorProfile>,
  authorId: string,
): CommunityAuthorProfile {
  const author = authorMap[authorId];
  if (!author) throw new CommunityAuthorProfileUnavailableError();
  return author;
}

export async function getCommunityAuthorMap(
  client: SupabaseClient,
  actorIds: Array<string | null | undefined>
): Promise<Record<string, CommunityAuthorProfile>> {
  const uniqueActorIds = [...new Set(actorIds.filter((id): id is string => Boolean(id)))];
  if (uniqueActorIds.length === 0) return {};

  const { data: communityProfiles, error: communityProfileError } = await client
    .from("community_profiles")
    .select("user_id:public_actor_id, nickname, avatar_url")
    .in("public_actor_id", uniqueActorIds);

  if (communityProfileError) {
    console.error("[community.authors] community profile lookup failed:", communityProfileError);
    throw new CommunityAuthorProfileUnavailableError();
  }

  const authorMap = Object.fromEntries(
    (communityProfiles ?? []).map((profile) => {
      const userId = profile.user_id;
      const nickname = profile.nickname;
      if (
        typeof userId !== "string" ||
        typeof nickname !== "string" ||
        nickname.trim().length === 0
      ) {
        throw new CommunityAuthorProfileUnavailableError();
      }
      return [
        userId,
        {
          user_id: userId,
          nickname: nickname.trim(),
          avatar_url: normalizeCommunityAvatar(profile.avatar_url),
        },
      ];
    })
  );

  if (uniqueActorIds.some((actorId) => !authorMap[actorId])) {
    throw new CommunityAuthorProfileUnavailableError();
  }

  return authorMap;
}
