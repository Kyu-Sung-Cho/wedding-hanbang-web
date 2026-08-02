import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommunityProfile, CommunityRank } from "@/types/community.types";
import type { UserRole } from "@/types/database.types";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

export type CommunityAuthorProfile = Pick<
  CommunityProfile,
  "user_id" | "nickname" | "avatar_url" | "rank"
> & {
  wedding_year: null;
  wedding_month: null;
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

export async function getCommunityAuthorMap(
  client: SupabaseClient,
  authorIds: Array<string | null | undefined>
): Promise<Record<string, CommunityAuthorProfile>> {
  const uniqueAuthorIds = [...new Set(authorIds.filter((id): id is string => Boolean(id)))];
  if (uniqueAuthorIds.length === 0) return {};

  const { data: communityProfiles, error: communityProfileError } = await client
    .from("community_profiles")
    .select("user_id:community_public_id, nickname, avatar_url, rank")
    .in("community_public_id", uniqueAuthorIds);

  if (communityProfileError) {
    console.error(
      "[community.authors] community profile lookup failed",
      safeErrorDiagnostic(communityProfileError),
    );
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
          // 결혼 시기는 동기방 매칭에만 사용한다. 공개 글·댓글 작성자
          // 응답에서는 본인이 글을 썼다는 이유만으로 자동 공개하지 않는다.
          wedding_year: null,
          wedding_month: null,
          // Account relationship roles are private profile data. Community
          // authors use the neutral avatar unless they expose a dedicated
          // public persona field in the future.
          role: null,
        },
      ];
    })
  );
}
