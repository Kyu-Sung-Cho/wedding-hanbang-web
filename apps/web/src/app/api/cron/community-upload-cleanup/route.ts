import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOKEN_BATCH_SIZE = 50;
const UNATTACHED_BATCH_SIZE = 25;
const TOKEN_EXPIRY_GRACE_MS = 5 * 60 * 1000;
const UNATTACHED_RETENTION_MS = 24 * 60 * 60 * 1000;
const STALE_LEASE_MS = 15 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_EXTENSION_RE = /^(jpg|png|gif|webp)$/i;
const SESSION_STATUSES = new Set(["issued", "finalizing", "completed", "rejected", "expired"]);

interface TokenCleanupCandidate {
  id: string;
  user_id: string;
  staging_path: string;
  status: string;
  expires_at: string;
}

interface UnattachedCleanupCandidate {
  id: string;
  user_id: string;
  final_bucket: "community-images";
  final_path: string;
  status: "completed" | "rejected" | "expired";
  attachment_cleanup_token: string;
}

function isExactSessionPath(path: string, uploadId: string, userId: string): boolean {
  const parts = path.split("/");
  if (parts.length !== 2
      || !UUID_RE.test(userId)
      || parts[0].toLowerCase() !== userId.toLowerCase()) return false;
  const filenameParts = parts[1].split(".");
  return filenameParts.length === 2
    && filenameParts[0].toLowerCase() === uploadId.toLowerCase()
    && IMAGE_EXTENSION_RE.test(filenameParts[1]);
}

function isTokenCandidate(value: unknown): value is TokenCleanupCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && UUID_RE.test(row.id)
    && typeof row.user_id === "string"
    && typeof row.staging_path === "string"
    && isExactSessionPath(row.staging_path, row.id, row.user_id)
    && typeof row.status === "string"
    && SESSION_STATUSES.has(row.status)
    && typeof row.expires_at === "string"
    && Number.isFinite(Date.parse(row.expires_at));
}

function isUnattachedCandidate(
  value: unknown,
  claimToken: string,
): value is UnattachedCleanupCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && UUID_RE.test(row.id)
    && typeof row.user_id === "string"
    && row.final_bucket === "community-images"
    && typeof row.final_path === "string"
    && isExactSessionPath(row.final_path, row.id, row.user_id)
    && (row.status === "completed" || row.status === "rejected" || row.status === "expired")
    && row.attachment_cleanup_token === claimToken;
}

async function confirmObjectAbsent(
  storage: { exists(path: string): Promise<{ data: boolean | null; error: unknown }> },
  path: string,
) {
  const { data, error } = await storage.exists(path);
  return !error && data === false;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const admin = createAdminClient();
    const now = Date.now();
    const tokenCutoff = new Date(now - TOKEN_EXPIRY_GRACE_MS).toISOString();
    const completedBefore = new Date(now - UNATTACHED_RETENTION_MS).toISOString();
    const staleBefore = new Date(now - STALE_LEASE_MS).toISOString();

    // Read and validate the durable token inventory before any Storage mutation.
    // Completed rows are deliberately included: a signed staging token outlives finalize.
    const { data: tokenRows, error: tokenInventoryError } = await admin
      .from("community_upload_sessions")
      .select("id,user_id,staging_path,status,expires_at")
      .is("token_cleanup_at", null)
      .lte("expires_at", tokenCutoff)
      .order("expires_at", { ascending: true })
      .limit(TOKEN_BATCH_SIZE);

    if (tokenInventoryError
        || !Array.isArray(tokenRows)
        || tokenRows.some((row) => !isTokenCandidate(row))) {
      throw new Error("durable token cleanup inventory unavailable");
    }
    const tokenCandidates = tokenRows as TokenCleanupCandidate[];

    // The DB lease makes post attachment and orphan cleanup mutually exclusive.
    const claimToken = randomUUID();
    const { data: claimedRows, error: claimError } = await admin.rpc(
      "claim_unattached_community_upload_sessions",
      {
        p_claim_token: claimToken,
        p_completed_before: completedBefore,
        p_stale_before: staleBefore,
        p_limit: UNATTACHED_BATCH_SIZE,
      },
    );
    if (claimError
        || !Array.isArray(claimedRows)
        || claimedRows.some((row) => !isUnattachedCandidate(row, claimToken))) {
      throw new Error("durable unattached upload inventory unavailable");
    }
    const unattachedCandidates = claimedRows as UnattachedCleanupCandidate[];

    let tokenCheckpointed = 0;
    const staging = admin.storage.from("community-media-staging");
    if (tokenCandidates.length > 0) {
      // A remove error is not itself decisive: an already-absent exact object is safe to checkpoint.
      await staging.remove(tokenCandidates.map((row) => row.staging_path));
      const absence = await Promise.all(tokenCandidates.map((row) =>
        confirmObjectAbsent(staging, row.staging_path)
      ));
      for (let index = 0; index < tokenCandidates.length; index += 1) {
        if (!absence[index]) continue;
        const candidate = tokenCandidates[index];
        const { data: checkpointed, error: checkpointError } = await admin.rpc(
          "checkpoint_community_upload_token_cleanup",
          {
            p_upload_id: candidate.id,
            p_staging_path: candidate.staging_path,
          },
        );
        if (!checkpointError && checkpointed === true) tokenCheckpointed += 1;
      }
    }

    let finalDeleted = 0;
    const finalStorage = admin.storage.from("community-images");
    if (unattachedCandidates.length > 0) {
      await finalStorage.remove(unattachedCandidates.map((row) => row.final_path));
      const absence = await Promise.all(unattachedCandidates.map((row) =>
        confirmObjectAbsent(finalStorage, row.final_path)
      ));
      for (let index = 0; index < unattachedCandidates.length; index += 1) {
        if (!absence[index]) continue;
        const candidate = unattachedCandidates[index];
        const { data: finalized, error: finalizeError } = await admin.rpc(
          "finalize_unattached_community_upload_cleanup",
          { p_upload_id: candidate.id, p_claim_token: claimToken },
        );
        if (!finalizeError && finalized === true) finalDeleted += 1;
      }
    }

    const tokenPendingRetry = tokenCandidates.length - tokenCheckpointed;
    const unattachedPendingRetry = unattachedCandidates.length - finalDeleted;
    const healthy = tokenPendingRetry === 0 && unattachedPendingRetry === 0;
    if (!healthy) {
      console.error("[community upload cleanup] cleanup requires retry", {
        tokenScanned: tokenCandidates.length,
        tokenPendingRetry,
        unattachedClaimed: unattachedCandidates.length,
        unattachedPendingRetry,
      });
    }

    return NextResponse.json(
      {
        ok: healthy,
        tokenCleanup: {
          scanned: tokenCandidates.length,
          checkpointed: tokenCheckpointed,
          pendingRetry: tokenPendingRetry,
        },
        unattachedCleanup: {
          claimed: unattachedCandidates.length,
          deleted: finalDeleted,
          pendingRetry: unattachedPendingRetry,
        },
      },
      {
        status: healthy ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error(
      "[community upload cleanup] durable cleanup failed",
      error instanceof Error ? error.message : "unknown",
    );
    return NextResponse.json(
      { error: "community upload cleanup failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
