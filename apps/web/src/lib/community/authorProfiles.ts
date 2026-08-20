import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CommunityProfile, CommunityRank } from "@/types/community.types";
import type { UserRole } from "@/types/database.types";

export type CommunityAuthorProfile = Pick<
  CommunityProfile,
  "user_id" | "nickname" | "avatar_url" | "rank" | "wedding_year" | "wedding_month"
> & {
  role: UserRole | null;
};

export function fallbackCommunityAuthor(userId: string | null | undefined): CommunityAuthorProfile {
  return {
    user_id: userId ?? "anonymous",
    nickname: "익명",
    avatar_url: null,
    rank: "sprout",
    wedding_year: null,
    wedding_month: null,
    role: null,
  };
}

function isUserRole(value: unknown): value is UserRole {
  return value === "bride" || value === "groom";
}

export async function getCommunityAuthorMap(
  client: SupabaseClient,
  authorIds: Array<string | null | undefined>
): Promise<Record<string, CommunityAuthorProfile>> {
  const uniqueAuthorIds = [...new Set(authorIds.filter((id): id is string => Boolean(id)))];
  if (uniqueAuthorIds.length === 0) return {};

  const { data: communityProfiles, error: communityProfileError } = await client
    .from("community_public_profiles")
    .select("user_id, nickname, avatar_url, rank")
    .in("user_id", uniqueAuthorIds);

  if (communityProfileError) {
    console.error("[community.authors] community profile lookup failed:", communityProfileError);
  }

  let roleMap: Record<string, UserRole | null> = {};
  try {
    const { data: profiles, error: profileError } = await createAdminClient()
      .from("profiles")
      .select("id, role")
      .in("id", uniqueAuthorIds);

    if (profileError) {
      console.error("[community.authors] profile role lookup failed:", profileError);
    } else {
      roleMap = Object.fromEntries(
        (profiles ?? []).map((profile) => [
          profile.id as string,
          isUserRole(profile.role) ? profile.role : null,
        ])
      );
    }
  } catch (error) {
    console.error("[community.authors] profile role lookup unavailable:", error);
  }

  return Object.fromEntries(
    (communityProfiles ?? []).map((profile) => {
      const userId = profile.user_id as string;
      return [
        userId,
        {
          user_id: userId,
          nickname: (profile.nickname as string | null) || "익명",
          avatar_url: (profile.avatar_url as string | null) ?? null,
          rank: ((profile.rank as CommunityRank | null) ?? "sprout"),
          wedding_year: null,
          wedding_month: null,
          role: roleMap[userId] ?? null,
        },
      ];
    })
  );
}
