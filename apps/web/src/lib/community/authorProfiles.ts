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
    const admin = createAdminClient();
    const { data: profiles, error: profileError } = await admin
      .from("profiles")
      .select("id, role, couple_id")
      .in("id", uniqueAuthorIds);

    if (profileError) {
      console.error("[community.authors] profile role lookup failed:", profileError);
    } else {
      // 중립 준비 공간의 작성자는 role을 고른 적이 없다. 그 슬롯값으로 아바타를
      // 그리면 본인이 고르지도 않은 성별이 남에게 보인다. 여기 한 곳에서 null로
      // 만들면 웹·모바일의 모든 아바타 표면이 함께 해결된다.
      const coupleIds = Array.from(
        new Set(
          (profiles ?? [])
            .map((profile) => profile.couple_id as string | null)
            .filter((id): id is string => typeof id === "string"),
        ),
      );
      const neutralCoupleIds = new Set<string>();
      let memberModelLookupFailed = false;
      if (coupleIds.length > 0) {
        // 컬럼이 없는 DB에서는 조회가 실패한다. 그 상태에선 중립 커플이 존재할
        // 수 없으므로 아무도 중립이 아니다 — 커뮤니티를 죽이지 않는다.
        const { data: couples, error: coupleError } = await admin
          .from("couples")
          .select("id, member_model_version")
          .in("id", coupleIds);
        if (coupleError) {
          // 컬럼이 아직 없는 것과 조회가 잠깐 실패한 것은 다르다. 전자는 중립 커플이
          // 존재할 수 없다는 증거이므로 기존 방식으로 봐도 안전하지만, 후자는 아무것도
          // 모르는 상태다 — 거기서 슬롯값을 그리면 고르지도 않은 성별이 남에게 보인다.
          // 같은 구분을 api/chat/route.ts 가 이미 schemaNotReady 로 쓰고 있다.
          if (["42703", "PGRST202", "PGRST204"].includes(coupleError.code ?? "")) {
            console.warn(
              "[community.authors] member_model_version 미적용 — 전원 기존 방식으로 본다",
              coupleError.code,
            );
          } else {
            console.error(
              "[community.authors] member model lookup failed:",
              coupleError.code,
            );
            memberModelLookupFailed = true;
          }
        } else {
          for (const couple of couples ?? []) {
            if ((couple as { member_model_version?: unknown }).member_model_version === 2) {
              neutralCoupleIds.add(couple.id as string);
            }
          }
        }
      }

      roleMap = Object.fromEntries(
        (profiles ?? []).map((profile) => {
          const coupleId = profile.couple_id as string | null;
          const isNeutral = coupleId !== null && neutralCoupleIds.has(coupleId);
          return [
            profile.id as string,
            isNeutral || memberModelLookupFailed || !isUserRole(profile.role)
              ? null
              : profile.role,
          ];
        })
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
