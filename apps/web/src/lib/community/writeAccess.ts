import type { SupabaseClient } from "@supabase/supabase-js";

export type CommunityWriteAccessResult =
  | { allowed: true }
  | {
      allowed: false;
      status: 403 | 503;
      code: "COMMUNITY_SUSPENDED" | "COMMUNITY_WRITE_ACCESS_UNAVAILABLE";
      message: string;
    };

/**
 * API-level explanation for the DB suspension fence.
 *
 * Missing community profiles are allowed because a first-time member may not
 * have one until their first post is created. Lookup failures fail closed so a
 * database outage cannot silently bypass a suspension.
 */
export async function checkCommunityWriteAccess(
  client: SupabaseClient,
  userId: string,
): Promise<CommunityWriteAccessResult> {
  const { data, error } = await client
    .from("community_profiles")
    .select("is_suspended")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return {
      allowed: false,
      status: 503,
      code: "COMMUNITY_WRITE_ACCESS_UNAVAILABLE",
      message: "커뮤니티 이용 상태를 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
    };
  }

  if (data?.is_suspended === true) {
    return {
      allowed: false,
      status: 403,
      code: "COMMUNITY_SUSPENDED",
      message: "현재 커뮤니티 작성 기능을 사용할 수 없어요. 자세한 내용은 고객지원에 문의해 주세요.",
    };
  }

  return { allowed: true };
}
