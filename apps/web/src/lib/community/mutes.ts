import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export async function getMutedActorIds(userId: string | null | undefined): Promise<string[]> {
  if (!userId) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("community_user_mutes")
    .select("muted_user_id")
    .eq("muter_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("community_mute_state_unavailable");
  }

  const internalUserIds = (data ?? [])
    .map((row) => row.muted_user_id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (internalUserIds.length === 0) return [];

  const { data: profiles, error: profileError } = await admin
    .from("community_profiles")
    .select("public_actor_id, user_id")
    .in("user_id", internalUserIds);

  if (profileError || (profiles ?? []).length !== internalUserIds.length) {
    throw new Error("community_mute_actor_identity_unavailable");
  }

  const actorIdByUserId = new Map(
    (profiles ?? []).map((profile) => [profile.user_id, profile.public_actor_id]),
  );

  return internalUserIds.map((internalUserId) => {
    const actorId = actorIdByUserId.get(internalUserId);
    if (typeof actorId !== "string" || actorId.length === 0) {
      throw new Error("community_mute_actor_identity_unavailable");
    }
    return actorId;
  });
}

export function mutedActorFilterValue(actorIds: readonly string[]): string | null {
  return actorIds.length > 0 ? `(${actorIds.join(",")})` : null;
}
