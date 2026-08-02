import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommunityMimeType } from "./uploadPolicy";
import { isCommunityActorWriteDenied } from "./actorWriteGate";

export type CommunityUploadStatus =
  | "issued"
  | "finalizing"
  | "completed"
  | "rejected"
  | "expired";

export interface CommunityUploadSession {
  id: string;
  user_id: string;
  staging_path: string;
  final_bucket: "community-images" | "community-videos";
  final_path: string;
  declared_mime_type: CommunityMimeType;
  declared_size: number;
  status: CommunityUploadStatus;
  claim_token: string | null;
  finalize_started_at: string | null;
  expires_at: string;
  actual_size: number | null;
  actual_mime_type: CommunityMimeType | null;
  content_sha256: string | null;
  sanitized_at: string | null;
  completed_at: string | null;
  attached_at: string | null;
  token_cleanup_at: string | null;
}

function isSession(value: unknown): value is CommunityUploadSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.user_id === "string"
    && typeof row.staging_path === "string"
    && (row.final_bucket === "community-images" || row.final_bucket === "community-videos")
    && typeof row.final_path === "string"
    && typeof row.declared_mime_type === "string"
    && typeof row.declared_size === "number"
    && typeof row.status === "string"
    && typeof row.expires_at === "string";
}

export async function claimCommunityUploadSession(
  admin: SupabaseClient,
  uploadId: string,
  userId: string,
  claimToken: string,
): Promise<CommunityUploadSession | null> {
  const staleBefore = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data, error } = await admin.rpc("claim_community_upload_session", {
    p_upload_id: uploadId,
    p_user_id: userId,
    p_claim_token: claimToken,
    p_stale_before: staleBefore,
  });
  if (error) {
    if (isCommunityActorWriteDenied(error)) throw error;
    throw new Error("community upload session claim failed");
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row === undefined || row === null) return null;
  if (!isSession(row)) throw new Error("community upload session claim malformed");
  return row;
}

export async function markCommunityUploadCompleted(
  admin: SupabaseClient,
  session: CommunityUploadSession,
  actualSize: number,
  actualMimeType: CommunityMimeType,
  contentSha256: string,
): Promise<boolean> {
  if (!session.claim_token || !/^[0-9a-f]{64}$/.test(contentSha256)) return false;
  const { data, error } = await admin.rpc(
    "community_complete_upload_session_for_actor",
    {
      p_actor_id: session.user_id,
      p_upload_id: session.id,
      p_claim_token: session.claim_token,
      p_actual_size: actualSize,
      p_actual_mime_type: actualMimeType,
      p_content_sha256: contentSha256,
    },
  );
  if (error && isCommunityActorWriteDenied(error)) throw error;
  return !error && data === true;
}

export async function rejectCommunityUploadSession(
  admin: SupabaseClient,
  session: CommunityUploadSession,
  code: string,
  stagingDeleted: boolean,
): Promise<boolean> {
  if (!session.claim_token || !/^[a-z0-9_]{1,64}$/.test(code)) return false;
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("community_upload_sessions")
    .update({
      status: "rejected",
      rejection_code: code,
      rejected_at: now,
      claim_token: null,
      updated_at: now,
      staging_deleted_at: stagingDeleted ? now : null,
    })
    .eq("id", session.id)
    .eq("user_id", session.user_id)
    .eq("status", "finalizing")
    .eq("claim_token", session.claim_token)
    .select("id")
    .maybeSingle();
  return !error && Boolean(data);
}

export async function expireIssuedCommunityUploadSession(
  admin: SupabaseClient,
  session: CommunityUploadSession,
  stagingDeleted: boolean,
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("community_upload_sessions")
    .update({
      status: "expired",
      rejection_code: "expired_before_finalize",
      rejected_at: now,
      updated_at: now,
      staging_deleted_at: stagingDeleted ? now : null,
    })
    .eq("id", session.id)
    .eq("user_id", session.user_id)
    .eq("status", "issued")
    .is("claim_token", null)
    .select("id")
    .maybeSingle();
  return !error && Boolean(data);
}
