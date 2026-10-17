import type { SupabaseClient } from "@supabase/supabase-js";

export type ChatActorDisplayRole = "bride" | "groom" | "not_selected" | "unavailable";

/** 선택 역할 조회 실패가 준비 상태나 채팅 권한 조회를 무효화하지 않도록 분리한다. */
export async function readChatActorDisplayRole(
  client: Pick<SupabaseClient, "from">,
  actorId: string,
): Promise<ChatActorDisplayRole> {
  try {
    const { data, error } = await client.from("profiles")
      .select("confirmed_role").eq("id", actorId).single();
    if (error || !data) return "unavailable";
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
