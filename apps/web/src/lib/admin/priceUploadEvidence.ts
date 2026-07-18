import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

const DISCLOSURE_RAW_BUCKET = "disclosure-raw";
const MAX_ADMIN_JSON_BYTES = 2 * 1024 * 1024;

export type AdminJsonEvidence = {
  bytes: number;
  objectKey: string;
  sha256: string;
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createAdminJsonEvidence(rawJson: string): AdminJsonEvidence {
  const bytes = new TextEncoder().encode(rawJson);
  const digest = sha256(bytes);
  return {
    bytes: bytes.byteLength,
    objectKey: `${digest}.json`,
    sha256: digest,
  };
}

/**
 * Preserves the exact administrator-uploaded JSON bytes as immutable private
 * evidence before any staging row can reference them. A failed create is
 * accepted only when the already-present content-addressed object is byte-for-
 * byte identical, which makes retries safe without permitting overwrite.
 */
export async function persistAdminJsonEvidence(
  client: SupabaseClient,
  rawJson: string,
): Promise<AdminJsonEvidence> {
  const bytes = new TextEncoder().encode(rawJson);
  const evidence = createAdminJsonEvidence(rawJson);
  const bucket = client.storage.from(DISCLOSURE_RAW_BUCKET);
  const uploaded = await bucket.upload(evidence.objectKey, bytes, {
    contentType: "application/json",
    upsert: false,
  });
  if (!uploaded.error) return evidence;

  const existing = await bucket.download(evidence.objectKey);
  if (existing.error || !existing.data) {
    throw new Error("PRICE_UPLOAD_EVIDENCE_STORE_FAILED");
  }
  const existingBytes = new Uint8Array(await existing.data.arrayBuffer());
  if (
    existingBytes.byteLength !== evidence.bytes
    || sha256(existingBytes) !== evidence.sha256
  ) {
    throw new Error("PRICE_UPLOAD_EVIDENCE_INTEGRITY_FAILED");
  }
  return evidence;
}

export async function verifyAdminJsonEvidence(
  client: SupabaseClient,
  objectKeys: readonly string[],
): Promise<boolean> {
  const jsonKeys = objectKeys.filter((key) => key.endsWith(".json"));
  if (jsonKeys.length === 0) return true;
  const bucket = client.storage.from(DISCLOSURE_RAW_BUCKET);
  for (const key of jsonKeys) {
    if (!/^[0-9a-f]{64}\.json$/u.test(key)) return false;
    const downloaded = await bucket.download(key);
    if (downloaded.error || !downloaded.data || downloaded.data.size > MAX_ADMIN_JSON_BYTES) {
      return false;
    }
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    if (
      bytes.byteLength > MAX_ADMIN_JSON_BYTES
      || sha256(bytes) !== key.slice(0, 64)
    ) {
      return false;
    }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      JSON.parse(text);
    } catch {
      return false;
    }
  }
  return true;
}
