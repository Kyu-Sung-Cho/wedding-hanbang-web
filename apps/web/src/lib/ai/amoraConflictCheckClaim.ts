import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const MAX_MESSAGE_IDS = 20;
const MAX_RESULT_JSON_CHARS = 65_536;

export type AmoraConflictCheckResult = Record<string, unknown>;

export interface AmoraConflictDetectionCheckpoint {
  stage: "detection_complete";
  triggered: boolean;
  score: number;
  reason: string;
  conflictContext: string;
  llmVerified: boolean;
}

export type AmoraConflictCheckClaimResult =
  | {
      action: "acquired";
      attemptCount: number;
      claimToken: string;
      checkpoint: AmoraConflictDetectionCheckpoint | null;
      reclaimed: boolean;
    }
  | {
      action: "completed";
      attemptCount: number;
      result: AmoraConflictCheckResult;
    }
  | {
      action: "in_progress";
      attemptCount: number;
      retryAfterMs: number;
    };

export class AmoraConflictCheckClaimError extends Error {
  readonly code = "AMORA_CONFLICT_CHECK_CLAIM_FAILED";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AmoraConflictCheckClaimError";
  }
}

interface ClaimParams {
  coupleId: string;
  messageDigest: string;
  requesterUserId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asAttemptCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function assertClaimParams(params: ClaimParams): void {
  if (
    !UUID_RE.test(params.coupleId)
    || !DIGEST_RE.test(params.messageDigest)
    || !UUID_RE.test(params.requesterUserId)
  ) {
    throw new AmoraConflictCheckClaimError("Conflict-check claim input was invalid");
  }
}

function assertBoundedResult(result: unknown): asserts result is AmoraConflictCheckResult {
  if (!isRecord(result)) {
    throw new AmoraConflictCheckClaimError("Conflict-check result must be an object");
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(result);
  } catch (cause) {
    throw new AmoraConflictCheckClaimError("Conflict-check result was not serializable", {
      cause,
    });
  }
  if (!encoded || encoded.length > MAX_RESULT_JSON_CHARS) {
    throw new AmoraConflictCheckClaimError("Conflict-check result exceeded its bound");
  }
}

export function parseAmoraConflictDetectionCheckpoint(
  value: unknown,
): AmoraConflictDetectionCheckpoint | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    throw new AmoraConflictCheckClaimError("Conflict-check checkpoint was invalid");
  }
  const expectedKeys = [
    "conflictContext",
    "llmVerified",
    "reason",
    "score",
    "stage",
    "triggered",
  ];
  if (
    Object.keys(value).sort().join("\0") !== expectedKeys.join("\0")
    || value.stage !== "detection_complete"
    || typeof value.triggered !== "boolean"
    || typeof value.score !== "number"
    || !Number.isSafeInteger(value.score)
    || value.score < 0
    || value.score > 1_000
    || typeof value.reason !== "string"
    || value.reason.length < 1
    || value.reason.length > 2_000
    || typeof value.conflictContext !== "string"
    || value.conflictContext.length > 2_000
    || typeof value.llmVerified !== "boolean"
  ) {
    throw new AmoraConflictCheckClaimError("Conflict-check checkpoint was invalid");
  }
  return value as unknown as AmoraConflictDetectionCheckpoint;
}

export function createAmoraConflictMessageDigest(messageIds: readonly string[]): string {
  if (messageIds.length < 1 || messageIds.length > MAX_MESSAGE_IDS) {
    throw new AmoraConflictCheckClaimError("At least one bounded message id is required");
  }
  if (messageIds.some((id) => !UUID_RE.test(id))) {
    throw new AmoraConflictCheckClaimError("Conflict-check message id was invalid");
  }
  const sorted = [...messageIds].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new AmoraConflictCheckClaimError("Conflict-check message ids must be unique");
  }
  return createHash("sha256")
    .update(`amora-conflict-check-v1\0${JSON.stringify(sorted)}`, "utf8")
    .digest("hex");
}

export async function claimAmoraConflictCheck(
  params: ClaimParams,
  admin: AdminClient = createAdminClient(),
): Promise<AmoraConflictCheckClaimResult> {
  assertClaimParams(params);
  const { data, error } = await admin.rpc("claim_amora_conflict_check", {
    p_couple_id: params.coupleId,
    p_message_digest: params.messageDigest,
    p_requester_user_id: params.requesterUserId,
  });
  if (error || !isRecord(data)) {
    throw new AmoraConflictCheckClaimError("Could not claim conflict check", {
      cause: error,
    });
  }

  const attemptCount = asAttemptCount(data.attempt_count);
  if (!attemptCount) {
    throw new AmoraConflictCheckClaimError("Conflict-check claim response was invalid");
  }
  if (data.action === "acquired" && typeof data.claim_token === "string") {
    if (!UUID_RE.test(data.claim_token)) {
      throw new AmoraConflictCheckClaimError("Conflict-check lease token was invalid");
    }
    return {
      action: "acquired",
      attemptCount,
      claimToken: data.claim_token,
      checkpoint: parseAmoraConflictDetectionCheckpoint(data.checkpoint),
      reclaimed: data.reclaimed === true,
    };
  }
  if (data.action === "completed") {
    assertBoundedResult(data.result);
    return { action: "completed", attemptCount, result: data.result };
  }
  if (data.action === "in_progress") {
    return { action: "in_progress", attemptCount, retryAfterMs: 2_000 };
  }
  throw new AmoraConflictCheckClaimError("Conflict-check claim response was invalid");
}

export async function checkpointAmoraConflictCheck(
  params: {
    coupleId: string;
    messageDigest: string;
    claimToken: string;
    checkpoint: AmoraConflictDetectionCheckpoint;
  },
  admin: AdminClient = createAdminClient(),
): Promise<void> {
  assertClaimParams({
    coupleId: params.coupleId,
    messageDigest: params.messageDigest,
    requesterUserId: params.claimToken,
  });
  const checkpoint = parseAmoraConflictDetectionCheckpoint(params.checkpoint);
  if (!checkpoint) {
    throw new AmoraConflictCheckClaimError("Conflict-check checkpoint was required");
  }
  const { data, error } = await admin.rpc("checkpoint_amora_conflict_check", {
    p_couple_id: params.coupleId,
    p_message_digest: params.messageDigest,
    p_claim_token: params.claimToken,
    p_checkpoint: checkpoint,
  });
  if (error || data !== true) {
    throw new AmoraConflictCheckClaimError("Could not checkpoint conflict check", {
      cause: error,
    });
  }
}

export async function completeAmoraConflictCheck(
  params: {
    coupleId: string;
    messageDigest: string;
    claimToken: string;
    result: AmoraConflictCheckResult;
  },
  admin: AdminClient = createAdminClient(),
): Promise<void> {
  assertClaimParams({
    coupleId: params.coupleId,
    messageDigest: params.messageDigest,
    requesterUserId: params.claimToken,
  });
  assertBoundedResult(params.result);
  const { data, error } = await admin.rpc("complete_amora_conflict_check", {
    p_couple_id: params.coupleId,
    p_message_digest: params.messageDigest,
    p_claim_token: params.claimToken,
    p_result: params.result,
  });
  if (error || data !== true) {
    throw new AmoraConflictCheckClaimError("Could not complete conflict check", {
      cause: error,
    });
  }
}

export async function failAmoraConflictCheck(
  params: {
    coupleId: string;
    messageDigest: string;
    claimToken: string;
    failureCode: string;
  },
  admin: AdminClient = createAdminClient(),
): Promise<void> {
  assertClaimParams({
    coupleId: params.coupleId,
    messageDigest: params.messageDigest,
    requesterUserId: params.claimToken,
  });
  const failureCode = params.failureCode.trim();
  if (!failureCode || failureCode.length > 120) {
    throw new AmoraConflictCheckClaimError("Conflict-check failure code was invalid");
  }
  const { data, error } = await admin.rpc("fail_amora_conflict_check", {
    p_couple_id: params.coupleId,
    p_message_digest: params.messageDigest,
    p_claim_token: params.claimToken,
    p_failure_code: failureCode,
  });
  if (error || data !== true) {
    throw new AmoraConflictCheckClaimError("Could not fail conflict check", {
      cause: error,
    });
  }
}
