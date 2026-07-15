import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export interface SafeProfileDto {
  id: string;
  name: string;
  role: "bride" | "groom" | null;
  couple_id: string | null;
  onboarding_completed: boolean;
  onboarding_step: number;
  has_phone: boolean;
}

export interface MyChatViewState {
  shared_chat_cleared_at: string | null;
  private_chat_cleared_at: string | null;
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" && !Array.isArray(row)
    ? (row as Record<string, unknown>)
    : null;
}

export async function readMySafeProfile(): Promise<{
  data: SafeProfileDto | null;
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc("get_my_profile_safe");
  const row = firstRow(data);
  if (!row || typeof row.id !== "string") return { data: null, error };

  return {
    data: {
      id: row.id,
      name: typeof row.name === "string" ? row.name : "",
      role: row.role === "bride" || row.role === "groom" ? row.role : null,
      couple_id: typeof row.couple_id === "string" ? row.couple_id : null,
      onboarding_completed: row.onboarding_completed === true,
      onboarding_step:
        typeof row.onboarding_step === "number" && Number.isInteger(row.onboarding_step)
          ? row.onboarding_step
          : 0,
      has_phone: row.has_phone === true,
    },
    error,
  };
}

export async function readMyChatViewState(): Promise<{
  data: MyChatViewState | null;
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc("get_my_chat_view_state");
  const row = firstRow(data);
  if (!row) return { data: null, error };

  return {
    data: {
      shared_chat_cleared_at:
        typeof row.shared_cleared_at === "string" ? row.shared_cleared_at : null,
      private_chat_cleared_at:
        typeof row.private_cleared_at === "string" ? row.private_cleared_at : null,
    },
    error,
  };
}
