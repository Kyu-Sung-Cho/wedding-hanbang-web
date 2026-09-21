import { createAdminClient } from "@/lib/supabase/admin";
import { arrangePreparationDecisions, DECISION_PAGE_SIZE, parsePreparationDecisions } from "@/lib/amora/preparationBoard";
import type { ToolExecutionResult } from "@/types/database.types";
import type { ToolExecutionContext } from "./toolTypes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 결정보드와 같은 공개 범위·파서로 읽는다. 할 일이나 자동 기억을 결정으로 승격하지 않는다. */
export async function executeGetDecisionRecords(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const failure = (): ToolExecutionResult => ({ toolName: "get_decision_records", toolInput: input,
    success: false, toolOutput: { error: "decision_records_unavailable" },
    displayMessage: "결정 기록을 확인하지 못했어요. 저장 여부를 단정하지 않고, 결정보드에서 다시 확인해 주세요." });
  if (Object.keys(input).some(key => key !== "decision_id")
    || !context.actorProfileId || !UUID.test(context.actorProfileId) || !UUID.test(context.coupleId)
    || (input.decision_id !== undefined && (typeof input.decision_id !== "string" || !UUID.test(input.decision_id)))) return failure();
  try {
    const client = createAdminClient();
    const membership = async () => {
      const profile = await client.from("profiles").select("id,couple_id,role").eq("id", context.actorProfileId!).maybeSingle();
      if (profile.error || !profile.data || profile.data.id !== context.actorProfileId || profile.data.couple_id !== context.coupleId
        || (profile.data.role !== "bride" && profile.data.role !== "groom")) throw new Error("DECISION_MEMBERSHIP_CHANGED");
      const couple = await client.from("couples").select("id,bride_id,groom_id").eq("id", context.coupleId).maybeSingle();
      if (couple.error || !couple.data || couple.data.id !== context.coupleId
        || (profile.data.role === "bride" ? couple.data.bride_id : couple.data.groom_id) !== context.actorProfileId) throw new Error("DECISION_MEMBERSHIP_CHANGED");
      return JSON.stringify([profile.data.role, couple.data.bride_id, couple.data.groom_id]);
    };
    const before = await membership();
    let query = client.from("decision_nodes")
      .select("id,couple_id,visibility,category,title,reasoning,decision_type,source,created_at,superseded_at,memory_key,metadata,chosen_value")
      .eq("couple_id", context.coupleId).eq("visibility", "shared")
      .is("superseded_at", null).is("memory_key", null).is("metadata->>extracted_by", null)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(DECISION_PAGE_SIZE + 1);
    if (typeof input.decision_id === "string") query = query.eq("id", input.decision_id);
    const response = await query;
    if (response.error) return failure();
    const page = parsePreparationDecisions(response.data, context.coupleId);
    const records = arrangePreparationDecisions(page.records).decisions;
    if (before !== await membership()) return failure();
    return { toolName: "get_decision_records", toolInput: input, success: true,
      toolOutput: { list_kind: "decision_records", records, count: records.length,
        truncated: page.nextCursor !== null, count_scope: "returned_records_only" },
      displayMessage: (records.length
        ? `이번에 조회한 결정 기록 ${records.length}개예요.`
        : "이번 조회 조건에 맞는 공유 결정 기록이 없어요.")
        + (page.nextCursor ? " 이전 기록은 결정보드에서 더 볼 수 있어요." : "") };
  } catch { return failure(); }
}
