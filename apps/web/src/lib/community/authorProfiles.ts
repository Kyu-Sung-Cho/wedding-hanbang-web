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
    const neutralPreparationSpaceEnabled =
      process.env.AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED === "true";
    const adminClient = createAdminClient();
    const { data: profiles, error: profileError } = await adminClient
      .from("profiles")
      .select((neutralPreparationSpaceEnabled ? "id, role, couple_id" : "id, role") as "id, role")
      .in("id", uniqueAuthorIds);

    if (profileError) {
      console.error("[community.authors] profile role lookup failed:", profileError);
    } else {
      const internalProfiles = (profiles ?? []) as unknown as Array<{
        id?: unknown;
        role?: unknown;
        couple_id?: unknown;
      }>;
      let memberModelByCoupleId: Record<string, 1 | 2> = {};
      if (neutralPreparationSpaceEnabled) {
        const coupleIds = [...new Set(internalProfiles.flatMap((profile) => (
          typeof profile.couple_id === "string" ? [profile.couple_id] : []
        )))];
        if (coupleIds.length > 0) {
          const { data: couples, error: coupleError } = await adminClient
            .from("couples")
            .select("id, member_model_version" as "id")
            .in("id", coupleIds);
          if (coupleError) {
            console.error("[community.authors] member model lookup failed:", coupleError);
          } else {
            memberModelByCoupleId = Object.fromEntries(
              ((couples ?? []) as unknown as Array<{
                id?: unknown;
                member_model_version?: unknown;
              }>).flatMap((couple) => (
                typeof couple.id === "string"
                && (couple.member_model_version === 1 || couple.member_model_version === 2)
                  ? [[couple.id, couple.member_model_version] as const]
                  : []
              )),
            );
          }
        }
      }
      roleMap = Object.fromEntries(
        internalProfiles.flatMap((profile) => typeof profile.id === "string" ? [[
          profile.id,
          isUserRole(profile.role)
          && (
            !neutralPreparationSpaceEnabled
            || (
              typeof profile.couple_id === "string"
              && memberModelByCoupleId[profile.couple_id] === 1
            )
          )
            ? profile.role
            : null,
        ] as const] : [])
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
