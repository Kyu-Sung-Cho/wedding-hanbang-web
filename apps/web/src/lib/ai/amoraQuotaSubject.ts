import { createHash } from "node:crypto";

import type { ChatVisibility } from "@/lib/ai/chatMessagePersistence";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUOTA_SUBJECT_NAMESPACE = "amora-quota-subject:v1";

interface AmoraQuotaSubjectInput {
  coupleId: string;
  actorUserId: string;
  visibility: ChatVisibility;
}

function uuidV5ShapeFromSha256(value: string): string {
  const bytes = createHash("sha256").update(value, "utf8").digest().subarray(0, 16);
  // Keep a standards-shaped UUID so the existing atomic cost RPC can remain
  // unchanged. This is an opaque quota subject, never an auth/user identity.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/**
 * Shared turns consume the couple's shared beta allowance. Private turns use
 * an actor-only allowance, so one partner's private Amora usage cannot change
 * the other partner's remaining count. The server has already canonicalized
 * visibility against the actor's database role before calling this helper.
 */
export function deriveAmoraQuotaSubjectId({
  coupleId,
  actorUserId,
  visibility,
}: AmoraQuotaSubjectInput): string {
  if (!UUID_PATTERN.test(coupleId) || !UUID_PATTERN.test(actorUserId)) {
    throw new Error("Amora quota subject requires a valid UUID identity");
  }
  const scope = visibility === "shared"
    ? `shared:${coupleId.toLowerCase()}`
    : `private:${actorUserId.toLowerCase()}`;
  return uuidV5ShapeFromSha256(`${QUOTA_SUBJECT_NAMESPACE}\0${scope}`);
}
