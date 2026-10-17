import type { SupabaseClient } from "@supabase/supabase-js";

export type ChatActorDisplayRole = "bride" | "groom" | "not_selected" | "unavailable";

/** 설정과 같은 정본에서 현재 사용자만 읽는다. 조회 실패는 채팅 권한과 분리한다. */
export async function readChatActorDisplayRole(
  client: Pick<SupabaseClient, "from">,
  actorId: string,
): Promise<ChatActorDisplayRole> {
  try {
    const { data, error } = await client.from("profile_wedding_roles")
      .select("user_id,confirmed_role").eq("user_id", actorId).maybeSingle();
    if (error) return "unavailable";
    if (data === null) return "not_selected";
    if (!data || data.user_id !== actorId) return "unavailable";
    if (data.confirmed_role === "bride" || data.confirmed_role === "groom") return data.confirmed_role;
    return data.confirmed_role === null ? "not_selected" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export function chatActorDisplayRoleLabel(role?: ChatActorDisplayRole): string {
  if (role === "bride") return "신부";
  if (role === "groom") return "신랑";
  if (role === "not_selected") return "미선택";
  return "이번 조회에서 확인하지 못함";
}
