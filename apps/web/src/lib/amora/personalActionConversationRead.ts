import type { SupabaseClient } from "@supabase/supabase-js";

export const PERSONAL_ACTION_SOURCE_JOIN = "source:chat_messages!amora_personal_actions_source_message_id_fkey!inner(couple_id,visibility)";

/** 요청의 인증 클라이언트와 RLS를 유지한다. 현재 커플의 본인 private 출처만 읽는다. */
export async function personalActionConversationVisibility(client: SupabaseClient, actorId: string, coupleId: string): Promise<"bride_private" | "groom_private"> {
  const { data, error } = await client.from("profiles").select("couple_id,role").eq("id", actorId).maybeSingle();
  if (error || !data || data.couple_id !== coupleId || !["bride", "groom"].includes(data.role)) throw new Error("PERSONAL_ACTION_CONVERSATION_SCOPE_CHANGED");
  return data.role === "bride" ? "bride_private" : "groom_private";
}

export async function readPersonalActionConversationCount(client: SupabaseClient, actorId: string, coupleId: string, visibility: "bride_private" | "groom_private", status: "all" | "open" | "done"): Promise<number> {
  if (await personalActionConversationVisibility(client, actorId, coupleId) !== visibility) throw new Error("PERSONAL_ACTION_CONVERSATION_SCOPE_CHANGED");
  let query = client.from("amora_personal_actions").select(`id,${PERSONAL_ACTION_SOURCE_JOIN}`, { head: true, count: "exact" })
    .eq("owner_user_id", actorId).eq("source.couple_id", coupleId).eq("source.visibility", visibility);
  if (status !== "all") query = query.eq("status", status);
  const { count, error } = await query;
  if (error || count === null || !Number.isSafeInteger(count) || count < 0 || count > 300) throw new Error("PERSONAL_ACTION_CONVERSATION_READ_UNAVAILABLE");
  if (await personalActionConversationVisibility(client, actorId, coupleId) !== visibility) throw new Error("PERSONAL_ACTION_CONVERSATION_SCOPE_CHANGED");
  return count;
}
