import { CourtApiError } from "@/app/api/couple-court/_shared";
import { logAIInteraction } from "@/lib/compliance/ai-log";
import { getCourtVerdictStructuredOutputName } from "@/lib/coupleCourt/config";
import { logRecoveredCourtVerdictAudit } from "@/lib/coupleCourt/judge";
import {
  isCourtCategory,
  isCourtMode,
  isCourtTone,
  type CourtCategory,
  type CourtMode,
  type CourtTone,
} from "@/lib/coupleCourt/types";
import { getServiceClient } from "@/lib/utils/adminAuth";
import { isRecord, isUuid } from "@/utils/requestValidation";

type ServiceClient = ReturnType<typeof getServiceClient>;
type UnknownRow = Record<string, unknown>;

interface RecoveryIdentity {
  verdictId: string;
  recoveryLeaseToken: string;
  requestKey: string;
}

interface RecoveryUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheWriteInputTokens: number | null;
  cachedInputTokens: number | null;
}

interface LiveRecoveryClaim extends RecoveryIdentity {
  subjectDeleted: false;
  providerState: "result_staged" | "failed_invalid";
  userId: string | null;
  coupleId: string | null;
  preflightSafetyLevel: "normal" | "sensitive";
  model: string;
  inputHash: string;
  promptVersion: string;
  schemaVersion: string;
  mode: CourtMode;
  category: CourtCategory;
  tone: CourtTone;
  usage: RecoveryUsage;
}

interface DeletedRecoveryClaim extends RecoveryIdentity {
  subjectDeleted: true;
  model: string;
  costUsd: number | null;
  usage: RecoveryUsage;
}

type RecoveryClaim = LiveRecoveryClaim | DeletedRecoveryClaim;

export interface CourtProviderAuditRecoveryResult {
  recovered: boolean;
  providerState: LiveRecoveryClaim["providerState"] | null;
}

function firstRow(value: unknown): UnknownRow | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isRecord(candidate) ? candidate : null;
}

function nullableUuid(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isUuid(value) ? value : undefined;
}

function safeIntegerOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function safeCostOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 9_999.999999
    ? value
    : undefined;
}

function parseRecoveryUsage(value: unknown): RecoveryUsage | null {
  const usage = isRecord(value) ? value : null;
  const inputTokens = safeIntegerOrNull(usage?.input_tokens);
  const outputTokens = safeIntegerOrNull(usage?.output_tokens);
  const cachedInputTokens = safeIntegerOrNull(usage?.cached_input_tokens);
  const cacheWriteInputTokens = safeIntegerOrNull(usage?.cache_write_input_tokens);
  if (
    !usage
    || inputTokens === undefined
    || outputTokens === undefined
    || cachedInputTokens === undefined
    || cacheWriteInputTokens === undefined
    || (inputTokens === null) !== (outputTokens === null)
    || (inputTokens === null && (cachedInputTokens !== null || cacheWriteInputTokens !== null))
    || (inputTokens !== null && (
      (cachedInputTokens ?? 0) > inputTokens
      || (cacheWriteInputTokens ?? 0) > inputTokens
    ))
  ) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    cacheWriteInputTokens,
    cachedInputTokens,
  };
}

function parseRecoveryIdentity(row: UnknownRow): RecoveryIdentity | null {
  const verdictId = row.verdict_id;
  const recoveryLeaseToken = row.recovery_lease_token;
  const requestKey = row.request_key;
  if (
    !isUuid(verdictId)
    || !isUuid(recoveryLeaseToken)
    || typeof requestKey !== "string"
    || !/^[a-f0-9]{64}$/.test(requestKey)
  ) {
    return null;
  }
  return { verdictId, recoveryLeaseToken, requestKey };
}

function parseLiveRecoveryClaim(
  row: UnknownRow,
  identity: RecoveryIdentity,
): LiveRecoveryClaim | null {
  const providerState = row.provider_state;
  const providerErrorCode = row.provider_error_code;
  const userId = nullableUuid(row.audit_user_id);
  const coupleId = nullableUuid(row.audit_couple_id);
  const preflightSafetyLevel = row.audit_preflight_safety_level;
  const model = row.audit_model;
  const inputHash = row.input_hash;
  const promptVersion = row.prompt_version;
  const schemaVersion = row.schema_version;
  const mode = row.mode;
  const category = row.category;
  const tone = row.tone;
  const recoveryAttemptCount = row.recovery_attempt_count;
  const pendingAt = row.provider_audit_pending_at;
  const usage = parseRecoveryUsage(row.usage);

  if (
    row.claim_status !== "execute"
    || row.subject_deleted !== false
    || row.provider_audit_state !== "pending"
    || (providerState !== "result_staged" && providerState !== "failed_invalid")
    || (providerState === "result_staged" && providerErrorCode !== null)
    || (providerState === "failed_invalid" && (
      typeof providerErrorCode !== "string"
      || ![
        "safety_high_risk",
        "safety_level_changed",
        "court_archived",
        "provider_result_unstaged",
      ].includes(providerErrorCode)
    ))
    || userId === undefined
    || coupleId === undefined
    || (preflightSafetyLevel !== "normal" && preflightSafetyLevel !== "sensitive")
    || typeof model !== "string"
    || !/^[A-Za-z0-9._:/-]{1,128}$/.test(model)
    || typeof inputHash !== "string"
    || !/^[a-f0-9]{64}$/.test(inputHash)
    || typeof promptVersion !== "string"
    || !/^[A-Za-z0-9._-]{1,64}$/.test(promptVersion)
    || typeof schemaVersion !== "string"
    || !/^[A-Za-z0-9._-]{1,64}$/.test(schemaVersion)
    || !getCourtVerdictStructuredOutputName(schemaVersion)
    || !isCourtMode(mode)
    || !isCourtCategory(category)
    || !isCourtTone(tone)
    || typeof pendingAt !== "string"
    || !Number.isFinite(Date.parse(pendingAt))
    || typeof recoveryAttemptCount !== "number"
    || !Number.isSafeInteger(recoveryAttemptCount)
    || recoveryAttemptCount < 1
    || recoveryAttemptCount > 10_000
    || !usage
  ) {
    return null;
  }

  return {
    ...identity,
    subjectDeleted: false,
    providerState,
    userId,
    coupleId,
    preflightSafetyLevel,
    model,
    inputHash,
    promptVersion,
    schemaVersion,
    mode,
    category,
    tone,
    usage,
  };
}

const DELETED_CLAIM_ALLOWED_FIELDS = new Set([
  "claim_status",
  "subject_deleted",
  "verdict_id",
  "provider_audit_state",
  "provider_audit_pending_at",
  "recovery_attempt_count",
  "recovery_lease_token",
  "recovery_lease_expires_at",
  "request_key",
  "audit_model",
  "audit_cost_usd",
  "usage",
]);

function parseDeletedRecoveryClaim(
  row: UnknownRow,
  identity: RecoveryIdentity,
): DeletedRecoveryClaim | null {
  const model = row.audit_model;
  const costUsd = safeCostOrNull(row.audit_cost_usd);
  const pendingAt = row.provider_audit_pending_at;
  const recoveryAttemptCount = row.recovery_attempt_count;
  const recoveryLeaseExpiresAt = row.recovery_lease_expires_at;
  const usage = parseRecoveryUsage(row.usage);
  if (
    row.claim_status !== "execute"
    || row.subject_deleted !== true
    || row.provider_audit_state !== "pending"
    || typeof model !== "string"
    || !/^[A-Za-z0-9._:/-]{1,128}$/.test(model)
    || costUsd === undefined
    || typeof pendingAt !== "string"
    || !Number.isFinite(Date.parse(pendingAt))
    || typeof recoveryLeaseExpiresAt !== "string"
    || !Number.isFinite(Date.parse(recoveryLeaseExpiresAt))
    || typeof recoveryAttemptCount !== "number"
    || !Number.isSafeInteger(recoveryAttemptCount)
    || recoveryAttemptCount < 1
    || recoveryAttemptCount > 10_000
    || !usage
    || Object.keys(row).some((field) => !DELETED_CLAIM_ALLOWED_FIELDS.has(field))
  ) {
    return null;
  }
  return {
    ...identity,
    subjectDeleted: true,
    model,
    costUsd,
    usage,
  };
}

function parseRecoveryClaim(
  row: UnknownRow,
  identity: RecoveryIdentity,
): RecoveryClaim | null {
  if (row.subject_deleted === true) {
    return parseDeletedRecoveryClaim(row, identity);
  }
  if (row.subject_deleted === false) {
    return parseLiveRecoveryClaim(row, identity);
  }
  return null;
}

async function recordRecoveryFailure(
  service: ServiceClient,
  adminUserId: string,
  identity: RecoveryIdentity,
  errorCode: "recovery_claim_invalid" | "required_audit_write_failed" | "audit_finalize_failed",
): Promise<void> {
  try {
    const { error } = await service.rpc("record_court_provider_audit_recovery_failure", {
      p_verdict_id: identity.verdictId,
      p_admin_user_id: adminUserId,
      p_recovery_lease_token: identity.recoveryLeaseToken,
      p_error_code: errorCode,
    });
    if (error) console.error("COURT_PROVIDER_AUDIT_RECOVERY_FAILURE_RECORD_FAILED");
  } catch {
    console.error("COURT_PROVIDER_AUDIT_RECOVERY_FAILURE_RECORD_FAILED");
  }
}

/**
 * Recovers one paid-call audit from the safe database envelope. The browser
 * chooses no case and receives no request key, user/couple identity, metadata,
 * input hash, provider usage, or staged verdict payload.
 */
export async function recoverOneCourtProviderAudit(
  adminUserId: string,
): Promise<CourtProviderAuditRecoveryResult> {
  if (!isUuid(adminUserId)) {
    throw new CourtApiError(401, "ADMIN_AUTH_REQUIRED", "관리자 인증이 필요합니다.");
  }

  const service = getServiceClient();
  let claimData: unknown;
  let claimError: unknown;
  try {
    const result = await service.rpc("claim_court_provider_audit_recovery", {
      p_admin_user_id: adminUserId,
      p_lease_seconds: 120,
    });
    claimData = result.data;
    claimError = result.error;
  } catch {
    claimError = true;
  }
  if (claimError) {
    throw new CourtApiError(
      503,
      "PROVIDER_AUDIT_RECOVERY_UNAVAILABLE",
      "감사 기록 복구 대기열을 잠시 사용할 수 없습니다.",
    );
  }

  const row = firstRow(claimData);
  if (row?.claim_status === "empty") {
    return { recovered: false, providerState: null };
  }
  if (!row || row.claim_status !== "execute") {
    throw new CourtApiError(
      503,
      "PROVIDER_AUDIT_RECOVERY_CONTRACT_INVALID",
      "감사 기록 복구 상태를 안전하게 확인하지 못했습니다.",
    );
  }

  const identity = parseRecoveryIdentity(row);
  if (!identity) {
    throw new CourtApiError(
      503,
      "PROVIDER_AUDIT_RECOVERY_CONTRACT_INVALID",
      "감사 기록 복구 상태를 안전하게 확인하지 못했습니다.",
    );
  }

  const claim = parseRecoveryClaim(row, identity);
  if (!claim) {
    await recordRecoveryFailure(service, adminUserId, identity, "recovery_claim_invalid");
    throw new CourtApiError(
      503,
      "PROVIDER_AUDIT_RECOVERY_CONTRACT_INVALID",
      "감사 기록 복구 상태를 안전하게 확인하지 못했습니다.",
    );
  }

  try {
    if (claim.subjectDeleted) {
      await logAIInteraction({
        userId: null,
        coupleId: null,
        sessionId: null,
        messageId: null,
        interactionType: "couple_court_verdict",
        specialistType: null,
        userInput: null,
        aiOutput: null,
        toolName: null,
        toolInput: null,
        toolOutput: null,
        latencyMs: 0,
        success: true,
        errorMessage: null,
        model: claim.model,
        tokensInput: claim.usage.inputTokens,
        tokensOutput: claim.usage.outputTokens,
        cacheReadTokens: claim.usage.cachedInputTokens,
        cacheWriteTokens: claim.usage.cacheWriteInputTokens,
        ...(claim.costUsd === null ? {} : { costUsd: claim.costUsd }),
        metadata: null,
        idempotencyKey: claim.requestKey,
        required: true,
        expectedSubjectDeleted: true,
      });
    } else {
      await logRecoveredCourtVerdictAudit({
        userId: claim.userId,
        coupleId: claim.coupleId,
        mode: claim.mode,
        category: claim.category,
        tone: claim.tone,
        preflightSafetyLevel: claim.preflightSafetyLevel,
        inputHash: claim.inputHash,
        promptVersion: claim.promptVersion,
        schemaVersion: claim.schemaVersion,
        model: claim.model,
        providerRequestKey: claim.requestKey,
        usage: claim.usage,
      });
    }
  } catch {
    await recordRecoveryFailure(service, adminUserId, identity, "required_audit_write_failed");
    throw new CourtApiError(
      503,
      "PROVIDER_AUDIT_RECOVERY_FAILED",
      "감사 기록을 아직 복구하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }

  let finalizedData: unknown;
  let finalizedError: unknown;
  try {
    const result = await service.rpc("finalize_court_provider_audit", {
      p_verdict_id: claim.verdictId,
      p_request_key: claim.requestKey,
    });
    finalizedData = result.data;
    finalizedError = result.error;
  } catch {
    finalizedError = true;
  }
  const finalizedRow = firstRow(finalizedData);
  if (
    finalizedError
    || finalizedRow?.verdict_id !== claim.verdictId
    || finalizedRow.provider_audit_state !== "audited"
    || (claim.subjectDeleted && finalizedRow.subject_deleted !== true)
  ) {
    await recordRecoveryFailure(service, adminUserId, identity, "audit_finalize_failed");
    throw new CourtApiError(
      503,
      "PROVIDER_AUDIT_RECOVERY_FAILED",
      "감사 기록을 확인했지만 마무리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }

  return {
    recovered: true,
    providerState: claim.subjectDeleted ? null : claim.providerState,
  };
}
