import { readPrivacyConfirmationTarget } from "@hanbang/shared";
import type { createClientFromRequest } from "@/lib/supabase/server";

export async function readOwnPrivacyConfirmationTarget(
  client: Awaited<ReturnType<typeof createClientFromRequest>>, ownerId: string, coupleId: string,
) {
  const { data, error } = await client.rpc("get_own_amora_privacy_epoch", {
    p_couple_id: coupleId, p_visibility: "shared",
  });
  const target = readPrivacyConfirmationTarget({ ownerId, coupleId, privacyEpoch: typeof data === "string" ? Number(data) : data });
  if (error || !target) throw new Error("PRIVACY_CONFIRMATION_UNAVAILABLE");
  return target;
}
