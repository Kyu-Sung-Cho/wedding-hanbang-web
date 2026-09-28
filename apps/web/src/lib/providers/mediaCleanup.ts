import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "provider-portfolio";
const BATCH_SIZE = 20;
const GRACE_MS = 35 * 60 * 1000;
const mediaStateSchema = z.object({
  id: z.string().uuid(), provider_id: z.string().uuid(), storage_path: z.string(),
  status: z.literal("removed"), created_at: z.string().datetime({ offset: true }),
  cleanup_claim_token: z.string().uuid(), cleanup_claim_until: z.string().datetime({ offset: true }),
});
const claimSchema = mediaStateSchema.extend({ owner_id: z.string().uuid() });
type CleanupCandidate = z.infer<typeof claimSchema>;

function validCandidate(row: CleanupCandidate, token: string, now: number) {
  return row.cleanup_claim_token === token && Date.parse(row.cleanup_claim_until) > now
    && Date.parse(row.created_at) <= now - GRACE_MS
    && ["jpg", "png", "webp"].some((extension) =>
      row.storage_path === `${row.owner_id}/${row.provider_id}/${row.id}.${extension}`);
}

/** SDK deletion is idempotent; the durable checkpoint requires exact-object absence. */
export async function cleanupProviderMedia(admin: SupabaseClient) {
  const token = randomUUID();
  const { data, error } = await admin.rpc("provider_claim_media_cleanup", { p_claim_token: token, p_limit: BATCH_SIZE });
  const parsed = z.array(claimSchema).max(BATCH_SIZE).safeParse(data);
  if (error || !parsed.success || new Set(parsed.data.map((row) => row.id)).size !== parsed.data.length
    || parsed.data.some((row) => !validCandidate(row, token, Date.now()))) throw new Error("PROVIDER_CLEANUP_INVALID_INVENTORY");
  const candidates = parsed.data;
  if (!candidates.length) return { claimed: 0, cleaned: 0, retired: 0, pending: 0 };

  // A fresh query binds the delete to the still-removed row and unexpired lease.
  const current = await admin.from("provider_media")
    .select("id,provider_id,storage_path,status,created_at,cleanup_claim_token,cleanup_claim_until")
    .in("id", candidates.map((row) => row.id));
  const states = z.array(mediaStateSchema).safeParse(current.data);
  if (current.error || !states.success || new Set(states.data.map((row) => row.id)).size !== states.data.length) throw new Error("PROVIDER_CLEANUP_STATE_UNAVAILABLE");
  const byId = new Map(candidates.map((row) => [row.id, row]));
  if (states.data.some((row) => {
    const claimed = byId.get(row.id);
    return !claimed || row.provider_id !== claimed.provider_id || row.storage_path !== claimed.storage_path
      || Date.parse(row.created_at) !== Date.parse(claimed.created_at) || !validCandidate({ ...row, owner_id: claimed.owner_id }, token, Date.now());
  })) throw new Error("PROVIDER_CLEANUP_STATE_CHANGED");

  // Auth cascade may retire a row; its durable account-deletion manifest owns that cleanup.
  const retired = candidates.length - states.data.length;
  const storage = admin.storage.from(BUCKET);
  if (states.data.length) {
    try { await storage.remove(states.data.map((row) => row.storage_path)); } catch { /* Exact absence below decides success. */ }
  }
  const outcomes = await Promise.allSettled(states.data.map(async (row) => {
    const absence = await storage.exists(row.storage_path);
    if (absence.data !== false) return false;
    if (absence.error) {
      // Storage SDK reports HEAD 400/404 as an error alongside data:false.
      // Only a complete, exact-name search can confirm that ambiguous response.
      const missing = z.object({ __isStorageError: z.literal(true), name: z.literal("StorageApiError"), status: z.union([z.literal(400), z.literal(404)]) }).safeParse(absence.error);
      if (!missing.success) return false;
      const separator = row.storage_path.lastIndexOf("/");
      const filename = row.storage_path.slice(separator + 1);
      const listed = await storage.list(row.storage_path.slice(0, separator), { search: filename, limit: 2 });
      const files = z.array(z.object({ id: z.string().uuid(), name: z.string().min(1) })).safeParse(listed.data);
      if (listed.error || !files.success || files.data.length >= 2 || files.data.some((file) => file.name === filename || file.name.includes("/"))) return false;
    }
    const checkpoint = await admin.rpc("provider_checkpoint_media_cleanup", {
      p_media_id: row.id, p_claim_token: token, p_storage_path: row.storage_path,
    });
    return !checkpoint.error && checkpoint.data === true;
  }));
  const cleaned = outcomes.filter((result) => result.status === "fulfilled" && result.value).length;
  return { claimed: candidates.length, cleaned, retired, pending: states.data.length - cleaned };
}
