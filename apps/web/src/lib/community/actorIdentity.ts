import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export class CommunityActorIdentityUnavailableError extends Error {
  constructor() {
    super("Community actor identity is unavailable");
    this.name = "CommunityActorIdentityUnavailableError";
  }
}

export async function getCommunityActorIdForUser(
  authUserId: string | null | undefined,
): Promise<string | null> {
  if (!authUserId) return null;

  const { data, error } = await createAdminClient()
    .from("community_profiles")
    .select("public_actor_id")
    .eq("user_id", authUserId)
    .maybeSingle();

  if (error) throw new CommunityActorIdentityUnavailableError();
  if (!data) return null;
  if (typeof data.public_actor_id !== "string" || data.public_actor_id.length === 0) {
    throw new CommunityActorIdentityUnavailableError();
  }
  return data.public_actor_id;
}

export async function getCommunityUserIdForActor(
  publicActorId: string,
): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("community_profiles")
    .select("user_id")
    .eq("public_actor_id", publicActorId)
    .maybeSingle();

  if (error) throw new CommunityActorIdentityUnavailableError();
  if (!data) return null;
  if (typeof data.user_id !== "string" || data.user_id.length === 0) {
    throw new CommunityActorIdentityUnavailableError();
  }
  return data.user_id;
}
