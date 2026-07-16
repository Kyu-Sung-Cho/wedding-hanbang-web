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
  const checks = await Promise.all(requested.map(async (visibility) => {
    const { data, error } = await client.rpc("has_current_amora_memory_consent", {
      p_couple_id: coupleId,
      p_visibility: visibility,
    });
    if (error) {
      console.error("[amora-memory] current consent lookup failed", error.code ?? "unknown");
      return [visibility, false] as const;
    }
    return [visibility, data === true] as const;
  }));
  for (const [visibility, enabled] of checks) {
    result[visibility] = enabled;
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
