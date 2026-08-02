import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

export async function getCommunityPublicIdForUser(
  serviceClient: SupabaseClient,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null;

  const { data, error } = await serviceClient
    .from("community_public_identities")
    .select("public_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error(
      "[community.public-identity] lookup failed",
      safeErrorDiagnostic(error),
    );
    return null;
  }

  return typeof data?.public_id === "string"
    ? data.public_id
    : null;
}

export async function getCommunityPublicIdsForUsers(
  serviceClient: SupabaseClient,
  userIds: readonly string[],
): Promise<string[]> {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueUserIds.length === 0) return [];

  const { data, error } = await serviceClient
    .from("community_public_identities")
    .select("public_id")
    .in("user_id", uniqueUserIds);

  if (error) {
    console.error(
      "[community.public-identity] batch lookup failed",
      safeErrorDiagnostic(error),
    );
    return [];
  }

  return [...new Set(
    (data ?? [])
      .map((row) => row.public_id)
      .filter((id): id is string => typeof id === "string"),
  )];
}

export async function getInternalUserIdForCommunityPublicId(
  serviceClient: SupabaseClient,
  publicId: string,
): Promise<string | null> {
  const { data, error } = await serviceClient
    .from("community_public_identities")
    .select("user_id")
    .eq("public_id", publicId)
    .maybeSingle();

  if (error) {
    console.error(
      "[community.public-identity] reverse lookup failed",
      safeErrorDiagnostic(error),
    );
    return null;
  }

  return typeof data?.user_id === "string" ? data.user_id : null;
}
