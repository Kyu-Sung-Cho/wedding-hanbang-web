import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AmoraMemoryVisibility } from "@/lib/ai/amoraMemoryCompiler";

export function isAuxiliaryMemoryRuntimeEnabled(): boolean {
  return process.env.AMORA_AUXILIARY_MEMORY_ENABLED === "true";
}

export async function getAmoraMemoryEnablement(
  coupleId: string,
  visibilities: readonly AmoraMemoryVisibility[],
  admin?: SupabaseClient,
): Promise<Record<AmoraMemoryVisibility, boolean>> {
  const result: Record<AmoraMemoryVisibility, boolean> = {
    shared: false,
    bride_private: false,
    groom_private: false,
  };
  if (!isAuxiliaryMemoryRuntimeEnabled()) return result;
  const client = admin ?? createAdminClient();
  const requested = [...new Set(visibilities)];
  if (requested.length === 0) return result;
  const { data, error } = await client
    .from("amora_memory_settings")
    .select("visibility, enabled")
    .eq("couple_id", coupleId)
    .in("visibility", requested);
  if (error) {
    console.error("[amora-memory] setting lookup failed", error.code ?? "unknown");
    return result;
  }
  for (const row of data ?? []) {
    const rowVisibility = row.visibility as unknown;
    if (rowVisibility === "shared" || rowVisibility === "bride_private" || rowVisibility === "groom_private") {
      result[rowVisibility] = row.enabled === true;
    }
  }
  return result;
}

export async function enqueueAmoraMemoryJob(input: {
  coupleId: string;
  userId: string;
  visibility: AmoraMemoryVisibility;
  toMessageId: string;
  admin?: SupabaseClient;
}): Promise<"queued" | "disabled" | "before_boundary" | "duplicate" | "failed"> {
  if (!isAuxiliaryMemoryRuntimeEnabled()) return "disabled";
  const admin = input.admin ?? createAdminClient();
  const { data, error } = await admin.rpc("enqueue_amora_memory_job", {
    p_couple_id: input.coupleId,
    p_user_id: input.userId,
    p_visibility: input.visibility,
    p_to_message_id: input.toMessageId,
  });
  if (!error && (data === "queued" || data === "disabled" || data === "before_boundary" || data === "duplicate")) {
    return data;
  }
  console.error("[amora-memory] enqueue failed", error?.code ?? "invalid_result");
  return "failed";
}
