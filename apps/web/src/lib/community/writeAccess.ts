import type { SupabaseClient } from "@supabase/supabase-js";

export type CommunityWriteAccessResult =
  | { allowed: true }
  | {
      allowed: false;
      status: 403 | 503;
      code: "COMMUNITY_SUSPENDED" | "COMMUNITY_WRITE_ACCESS_UNAVAILABLE";
      message: string;
    };

type CommunityWriteAccessPayload = {
  profile_exists: boolean;
  is_suspended: boolean;
};

function isCommunityWriteAccessPayload(
  value: unknown,
): value is CommunityWriteAccessPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.profile_exists === "boolean"
    && typeof payload.is_suspended === "boolean"
  );
}

/**
 * API-level explanation for the DB suspension fence.
 *
 * Missing community profiles are allowed because a first-time member may not
 * have one until their first post is created. The base profile table is
 * server-only; this uses the narrow own-actor RPC so counters, wedding timing,
 * and moderation metadata never need client SELECT permission. Lookup failures
 * and malformed RPC payloads fail closed.
 */
export async function checkCommunityWriteAccess(
  client: SupabaseClient,
  userId: string,
): Promise<CommunityWriteAccessResult> {
  const { data, error } = await client.rpc(
    "community_get_write_access" as never,
    { p_user_id: userId } as never,
  );

  if (error || !isCommunityWriteAccessPayload(data)) {
    return {
      allowed: false,
      status: 503,
      code: "COMMUNITY_WRITE_ACCESS_UNAVAILABLE",
      message: "커뮤니티 이용 상태를 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
    };
  }

  if (data.is_suspended) {
    return {
      allowed: false,
      status: 403,
      code: "COMMUNITY_SUSPENDED",
      message: "현재 커뮤니티 작성 기능을 사용할 수 없어요. 자세한 내용은 고객지원에 문의해 주세요.",
    };
  }

  return { allowed: true };
}
