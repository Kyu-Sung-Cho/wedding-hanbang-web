import {
  DEFAULT_AMORA_MODEL_BY_ROLE,
  type AmoraModelRole,
} from "@/lib/ai/modelConfig";
import {
  parseAmoraConflictDetectionCheckpoint,
  type AmoraConflictDetectionCheckpoint,
} from "@/lib/ai/amoraConflictCheckClaim";
import {
  AmoraCostGuardError,
  reserveAmoraProviderCall,
  type CostGuardResult,
  type ReserveProviderCallParams,
} from "@/lib/ai/costGuard";
import {
  normalizeOpenAIProviderError,
  OpenAIProviderError,
  type OpenAIRequestStage,
  type OpenAIInputCountAttempt,
  type NormalizedOpenAIUsage,
  type OpenAIUsageStatus,
} from "@/lib/ai/openai";
import {
  calcCostUsd,
  elapsedMs,
  startLatencyClock,
} from "@/lib/compliance/ai-log";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ChatVisibility,
  PersistedAiMessage,
} from "@/lib/ai/chatMessagePersistence";
import type { SpecialistType } from "@/types/moat.types";
import { log } from "@/utils/log";
import {
  parseAmoraToolRoundCheckpoint,
  type AmoraToolRoundCheckpoint,
} from "@/lib/ai/amoraTurnJournal";

export type AmoraMainChatProviderCallPhase = "tool_round" | "final_no_tool";
export type AmoraConflictProviderCallPhase =
  | "conflict_verify"
  | "conflict_mediation";
export type AmoraProviderCallPhase =
  | AmoraMainChatProviderCallPhase
  | AmoraConflictProviderCallPhase;
export type AmoraMainChatProviderCallSource =
  | "durable"
  | "demo"
  | "release_eval";
export type AmoraProviderCallSource =
  | AmoraMainChatProviderCallSource
  | "conflict_check";

interface AmoraProviderCallLedgerBaseContext {
  userId?: string | null;
  /** Demo/eval actors use null because their synthetic UUID is not a couples FK. */
  coupleId: string | null;
  sessionId?: string | null;
  /** Stable server-issued request correlation; never conversation content. */
  requestKey: string;
  modelRole: AmoraModelRole;
  specialistType?: SpecialistType | null;
  callIndex: number;
  stageTag?: string | null;
  costGuard: Omit<
    ReserveProviderCallParams,
    "receiptId" | "claimToken" | "requestKey"
  >;
  onCostReserved?: (result: CostGuardResult) => void;
}

export interface AmoraConflictCheckpointClaimIdentity {
  coupleId: string;
  messageDigest: string;
  claimToken: string;
}

export type AmoraProviderCallLedgerContext =
  & AmoraProviderCallLedgerBaseContext
  & (
    | {
        source: AmoraMainChatProviderCallSource;
        phase: AmoraMainChatProviderCallPhase;
      }
    | {
        source: "conflict_check";
        phase: "conflict_verify";
        conflictCheckpointClaim?: AmoraConflictCheckpointClaimIdentity;
      }
    | {
        source: "conflict_check";
        phase: "conflict_mediation";
        conflictCheckpointClaim?: never;
      }
  );

export interface AmoraProviderCallLedgerResult {
  model?: string;
  usage?: NormalizedOpenAIUsage;
  usageStatus: OpenAIUsageStatus;
  requestId?: string | null;
  responseId?: string | null;
  inputCountRequestId?: string | null;
  inputCountAttempts?: OpenAIInputCountAttempt[];
  /** Persisted atomically with a successful conflict-verification receipt. */
  providerCheckpoint?: AmoraConflictDetectionCheckpoint;
}

export interface AtomicAmoraChatResponseInput {
  coupleId: string;
  userId: string;
  requestKey: string;
  visibility: ChatVisibility;
  /** Current amora_chat_request_claims.attempt_count generation fence. */
  claimAttemptCount: number;
  content: string;
  metadata: Record<string, unknown>;
  stageTag: string | null;
  specialistType: string | null;
}

export interface AtomicAmoraChatResponseFinalization {
  outcome: "persisted" | "cooldown_race_lost";
  message: PersistedAiMessage | null;
}

export interface AtomicAmoraToolRoundCheckpointInput {
  coupleId: string;
  requestKey: string;
  /** Current amora_chat_request_claims.attempt_count generation fence. */
  claimAttemptCount: number;
  checkpoint: AmoraToolRoundCheckpoint;
}

export interface AmoraProviderCallLedgerOptions<
  TResult extends AmoraProviderCallLedgerResult,
> {
  /**
   * Returning a value upgrades success settlement to the atomic terminal-chat
   * RPC. Returning null keeps the ordinary provider-only receipt finalizer.
   */
  buildAtomicChatResponse: (
    result: TResult,
  ) => AtomicAmoraChatResponseInput | null;
  /**
   * Non-terminal durable chat rounds settle their paid receipt and append the
   * exact replay checkpoint in one transaction. Demo/evaluation calls omit it.
   */
  buildToolRoundCheckpoint?: (
    result: TResult,
  ) => AtomicAmoraToolRoundCheckpointInput | null;
  onAtomicChatResponseFinalized?: (
    result: AtomicAmoraChatResponseFinalization,
  ) => void;
}

const PRE_GENERATION_PROVIDER_CODES = new Set([
  "openai_not_enabled",
  "input_token_limit",
  "invalid_input_token_count",
]);
const SAFE_CORRELATION_PATTERN = /^[A-Za-z0-9_.:-]{1,240}$/;
const SENSITIVE_LOG_VALUE_PATTERN = /(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]{20,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFLICT_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const AMORA_PROVIDER_CALL_SOURCES = new Set<AmoraProviderCallSource>([
  "durable",
  "demo",
  "release_eval",
  "conflict_check",
]);
const AMORA_MAIN_CHAT_PHASES = new Set<AmoraProviderCallPhase>([
  "tool_round",
  "final_no_tool",
]);
const AMORA_CONFLICT_PHASES = new Set<AmoraProviderCallPhase>([
  "conflict_verify",
  "conflict_mediation",
]);
const FINALIZE_MAX_ATTEMPTS = 3;

interface AtomicConflictCheckpoint {
  claim: AmoraConflictCheckpointClaimIdentity;
  checkpoint: AmoraConflictDetectionCheckpoint;
}

interface ProviderReceiptFinalizeResult {
  finalized: true;
  receiptStatus: string;
  atomicChatResponse?: AtomicAmoraChatResponseFinalization;
}

function assertSafeCorrelation(name: string, value: string): void {
  if (
    !SAFE_CORRELATION_PATTERN.test(value)
    || SENSITIVE_LOG_VALUE_PATTERN.test(value)
  ) {
    throw new Error(`[ai-ledger] ${name} must be an opaque correlation token`);
  }
}

function safeMetadataToken(value: string | null | undefined): string | null {
  return value
    && SAFE_CORRELATION_PATTERN.test(value)
    && !SENSITIVE_LOG_VALUE_PATTERN.test(value)
    ? value
    : null;
}

function reportOperationalError(message: string, code: string): void {
  try {
    log.error(message, new Error(code));
  } catch {
    // Observability must never replace the provider result or its original error.
  }
}

function assertConflictCheckpointClaim(
  context: AmoraProviderCallLedgerContext,
): void {
  const claim = "conflictCheckpointClaim" in context
    ? context.conflictCheckpointClaim
    : undefined;
  if (!claim) return;
  if (
    context.source !== "conflict_check"
    || context.phase !== "conflict_verify"
    || !context.coupleId
    || claim.coupleId !== context.coupleId
    || !UUID_PATTERN.test(claim.coupleId)
    || !UUID_PATTERN.test(claim.claimToken)
    || !CONFLICT_DIGEST_PATTERN.test(claim.messageDigest)
    || context.requestKey !== `conflict:${claim.messageDigest}`
  ) {
    throw new Error("[ai-ledger] conflict checkpoint claim is invalid");
  }
}

function getAtomicConflictCheckpoint(
  context: AmoraProviderCallLedgerContext,
  result: AmoraProviderCallLedgerResult,
): AtomicConflictCheckpoint | null {
  const claim = "conflictCheckpointClaim" in context
    ? context.conflictCheckpointClaim
    : undefined;
  const checkpoint = result.providerCheckpoint;
  if (!claim && checkpoint === undefined) return null;
  if (!claim || checkpoint === undefined) {
    throw new Error("[ai-ledger] conflict checkpoint identity/result mismatch");
  }
  assertConflictCheckpointClaim(context);
  let parsed: AmoraConflictDetectionCheckpoint | null;
  try {
    parsed = parseAmoraConflictDetectionCheckpoint(checkpoint);
  } catch {
    throw new Error("[ai-ledger] conflict checkpoint shape is invalid");
  }
  if (!parsed) {
    throw new Error("[ai-ledger] conflict checkpoint is required");
  }
  return { claim, checkpoint: parsed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validateAtomicChatResponse(
  context: AmoraProviderCallLedgerContext,
  input: AtomicAmoraChatResponseInput,
): AtomicAmoraChatResponseInput {
  const isMainChat = context.source === "durable"
    && (context.phase === "tool_round" || context.phase === "final_no_tool")
    && input.requestKey === context.requestKey;
  const digest = context.source === "conflict_check"
    && context.phase === "conflict_mediation"
    && context.requestKey.startsWith("conflict:")
    ? context.requestKey.slice("conflict:".length)
    : null;
  const isConflictMediation = digest !== null
    && CONFLICT_DIGEST_PATTERN.test(digest)
    && input.requestKey === `mediation:${digest}`
    && input.visibility === "shared";
  let serializedMetadata: string;
  try {
    serializedMetadata = JSON.stringify(input.metadata);
  } catch {
    throw new Error("[ai-ledger] atomic chat metadata is invalid");
  }
  if (
    (!isMainChat && !isConflictMediation)
    || !context.coupleId
    || !context.userId
    || input.coupleId !== context.coupleId
    || input.userId !== context.userId
    || !UUID_PATTERN.test(input.coupleId)
    || !UUID_PATTERN.test(input.userId)
    || !Number.isSafeInteger(input.claimAttemptCount)
    || input.claimAttemptCount < 1
    || !["shared", "bride_private", "groom_private"].includes(input.visibility)
    || typeof input.content !== "string"
    || !input.content.trim()
    || byteLength(input.content) > 131_072
    || !isRecord(input.metadata)
    || byteLength(serializedMetadata) > 262_144
    || (input.stageTag !== null && input.stageTag.length > 100)
    || (input.specialistType !== null && input.specialistType.length > 100)
  ) {
    throw new Error("[ai-ledger] atomic chat response is invalid");
  }
  return input;
}

function validateToolRoundCheckpoint(
  context: AmoraProviderCallLedgerContext,
  input: AtomicAmoraToolRoundCheckpointInput,
): AtomicAmoraToolRoundCheckpointInput {
  const parsed = parseAmoraToolRoundCheckpoint(input.checkpoint);
  if (
    context.source !== "durable"
    || context.phase !== "tool_round"
    || !context.coupleId
    || input.coupleId !== context.coupleId
    || input.requestKey !== context.requestKey
    || !UUID_PATTERN.test(input.coupleId)
    || !Number.isSafeInteger(input.claimAttemptCount)
    || input.claimAttemptCount < 1
    || !parsed
    || parsed.callIndex !== context.callIndex
  ) {
    throw new Error("[ai-ledger] tool-round checkpoint is invalid");
  }
  return { ...input, checkpoint: parsed };
}

function parseAtomicChatFinalization(
  row: Record<string, unknown>,
): AtomicAmoraChatResponseFinalization | null {
  if (row.outcome === "cooldown_race_lost") {
    if (row.message_id !== null && row.message_id !== undefined) return null;
    return { outcome: "cooldown_race_lost", message: null };
  }
  if (
    row.outcome !== "persisted"
    || typeof row.message_id !== "string"
    || !UUID_PATTERN.test(row.message_id)
    || typeof row.message_created_at !== "string"
    || typeof row.message_content !== "string"
    || !isRecord(row.message_metadata)
    || (row.message_stage_tag !== null && typeof row.message_stage_tag !== "string")
    || (
      row.message_specialist_type !== null
      && typeof row.message_specialist_type !== "string"
    )
    || !["shared", "bride_private", "groom_private"].includes(
      String(row.message_visibility),
    )
    || typeof row.message_reused !== "boolean"
  ) return null;
  return {
    outcome: "persisted",
    message: {
      id: row.message_id,
      createdAt: row.message_created_at,
      content: row.message_content,
      metadata: row.message_metadata,
      stageTag: row.message_stage_tag as string | null,
      specialistType: row.message_specialist_type as string | null,
      visibility: row.message_visibility as ChatVisibility,
      reused: row.message_reused,
    },
  };
}

function buildMetadata(context: AmoraProviderCallLedgerContext, options: {
  providerAttempted: boolean;
  usageStatus: OpenAIUsageStatus;
  requestId?: string | null;
  responseId?: string | null;
  inputCountRequestId?: string | null;
  inputCountAttempts?: OpenAIInputCountAttempt[];
  requestStage?: OpenAIRequestStage | null;
  providerErrorCategory?: string | null;
  providerErrorCode?: string | null;
}): Record<string, unknown> {
  return {
    ai_provider: "openai",
    audit_wrapper: "runAmoraProviderCallWithLedger",
    endpoint: context.source === "conflict_check"
      ? "chat_conflict_check"
      : "chat",
    model_role: context.modelRole,
    stage_tag: safeMetadataToken(context.stageTag),
    provider_call_index: context.callIndex,
    provider_call_phase: context.phase,
    provider_attempted: options.providerAttempted,
    usage_status: options.usageStatus,
    unknown_paid_attempt:
      options.providerAttempted && options.usageStatus === "unknown",
    provider_request_id: safeMetadataToken(options.requestId),
    provider_response_id: safeMetadataToken(options.responseId),
    input_count_request_id: safeMetadataToken(options.inputCountRequestId),
    input_count_attempt_count: options.inputCountAttempts?.length ?? 0,
    input_count_attempts: (options.inputCountAttempts ?? []).map((attempt) => [
      String(attempt.attempt),
      attempt.outcome,
      attempt.category ?? "none",
      safeMetadataToken(attempt.requestId) ?? "none",
    ].join(":")),
    provider_request_stage: options.requestStage ?? null,
    provider_error_category: safeMetadataToken(options.providerErrorCategory),
    provider_error_code: safeMetadataToken(options.providerErrorCode),
    session_id: context.sessionId ?? null,
    source: context.source,
    request_key: context.requestKey,
  };
}

function latestInputCountRequestId(
  attempts: OpenAIInputCountAttempt[] | undefined,
): string | null {
  for (let index = (attempts?.length ?? 0) - 1; index >= 0; index -= 1) {
    const requestId = safeMetadataToken(attempts?.[index]?.requestId);
    if (requestId) return requestId;
  }
  return null;
}

async function prepareProviderReceipt(
  context: AmoraProviderCallLedgerContext,
  configuredModel: string,
): Promise<{
  admin: ReturnType<typeof createAdminClient>;
  receiptId: string;
  claimToken: string;
}> {
  assertSafeCorrelation("requestKey", context.requestKey);
  if (context.sessionId) assertSafeCorrelation("sessionId", context.sessionId);
  if (!AMORA_PROVIDER_CALL_SOURCES.has(context.source)) {
    throw new Error("[ai-ledger] source is invalid");
  }
  const phaseAllowed = context.source === "conflict_check"
    ? AMORA_CONFLICT_PHASES.has(context.phase)
    : AMORA_MAIN_CHAT_PHASES.has(context.phase);
  if (!phaseAllowed) {
    throw new Error("[ai-ledger] source/phase pair is invalid");
  }
  assertConflictCheckpointClaim(context);

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "prepare_amora_provider_call_receipt",
      {
        p_user_id: context.userId ?? null,
        p_log_couple_id: context.coupleId,
        p_session_id: context.sessionId ?? null,
        p_specialist_type: context.specialistType ?? null,
        p_model: configuredModel,
        p_request_key: context.requestKey,
        p_call_index: context.callIndex,
        p_call_source: context.source,
        p_call_phase: context.phase,
        p_metadata: {
          ...buildMetadata(context, {
            providerAttempted: false,
            usageStatus: "unknown",
          }),
          content_logging: "disabled",
          ledger_status: "prepared",
        },
      },
    );
    const row = Array.isArray(data) ? data[0] : data;
    if (
      error
      || !row
      || typeof row.receipt_id !== "string"
      || !UUID_PATTERN.test(row.receipt_id)
      || typeof row.claim_token !== "string"
      || !UUID_PATTERN.test(row.claim_token)
      || typeof row.receipt_status !== "string"
    ) {
      throw new Error("amora_provider_receipt_insert_failed");
    }
    if (row.claimed !== true) {
      reportOperationalError(
        "[ai-ledger] duplicate or in-flight provider receipt blocked",
        `amora_provider_receipt_${safeMetadataToken(row.receipt_status) ?? "unknown"}`,
      );
      throw new Error(`[ai-ledger] provider receipt is ${row.receipt_status}`);
    }
    return {
      admin,
      receiptId: row.receipt_id,
      claimToken: row.claim_token,
    };
  } catch {
    reportOperationalError(
      "[ai-ledger] prepared receipt unavailable; provider call blocked",
      "amora_provider_receipt_insert_failed",
    );
    throw new Error("[ai-ledger] prepared receipt unavailable");
  }
}

async function finalizeProviderReceipt(
  admin: ReturnType<typeof createAdminClient>,
  receiptId: string,
  claimToken: string,
  values: {
    providerAttempted: boolean;
    usageStatus: OpenAIUsageStatus;
    actualCostMicrousd: number | null;
    success: boolean;
    errorMessage: string | null;
    model: string;
    tokensInput: number | null;
    tokensOutput: number | null;
    latencyMs: number;
    metadata: Record<string, unknown>;
    conflictCheckpoint?: AtomicConflictCheckpoint | null;
    atomicChatResponse?: AtomicAmoraChatResponseInput | null;
    toolRoundCheckpoint?: AtomicAmoraToolRoundCheckpointInput | null;
  },
): Promise<ProviderReceiptFinalizeResult | null> {
  for (let attempt = 1; attempt <= FINALIZE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const commonParams = {
        p_provider_attempted: values.providerAttempted,
        p_usage_status: values.usageStatus,
        p_actual_cost_microusd: values.actualCostMicrousd,
        p_success: values.success,
        p_error_message: values.errorMessage,
        p_model: values.model,
        p_tokens_input: values.tokensInput,
        p_tokens_output: values.tokensOutput,
        p_latency_ms: values.latencyMs,
        p_metadata: values.metadata,
      };
      const {
        p_metadata: receiptMetadata,
        ...providerResultParams
      } = commonParams;
      const { data, error } = values.conflictCheckpoint
        ? await admin.rpc("finalize_amora_conflict_verify_receipt", {
          p_receipt_id: receiptId,
          p_receipt_claim_token: claimToken,
          p_conflict_couple_id: values.conflictCheckpoint.claim.coupleId,
          p_message_digest: values.conflictCheckpoint.claim.messageDigest,
          p_conflict_claim_token: values.conflictCheckpoint.claim.claimToken,
          p_checkpoint: values.conflictCheckpoint.checkpoint,
          ...commonParams,
        })
        : values.atomicChatResponse
          ? await admin.rpc("finalize_amora_chat_response", {
            p_receipt_id: receiptId,
            p_receipt_claim_token: claimToken,
            p_chat_couple_id: values.atomicChatResponse.coupleId,
            p_chat_user_id: values.atomicChatResponse.userId,
            p_chat_request_key: values.atomicChatResponse.requestKey,
            p_chat_visibility: values.atomicChatResponse.visibility,
            p_chat_claim_attempt_count:
              values.atomicChatResponse.claimAttemptCount,
            p_message_content: values.atomicChatResponse.content,
            p_message_metadata: values.atomicChatResponse.metadata,
            p_message_stage_tag: values.atomicChatResponse.stageTag,
            p_message_specialist_type:
              values.atomicChatResponse.specialistType,
            p_receipt_metadata: receiptMetadata,
            ...providerResultParams,
          })
          : values.toolRoundCheckpoint
            ? await admin.rpc("finalize_amora_tool_round_receipt", {
              p_receipt_id: receiptId,
              p_receipt_claim_token: claimToken,
              p_chat_couple_id: values.toolRoundCheckpoint.coupleId,
              p_chat_request_key: values.toolRoundCheckpoint.requestKey,
              p_chat_claim_attempt_count:
                values.toolRoundCheckpoint.claimAttemptCount,
              p_checkpoint: values.toolRoundCheckpoint.checkpoint,
              p_receipt_metadata: receiptMetadata,
              ...providerResultParams,
            })
            : await admin.rpc("finalize_amora_provider_call_receipt", {
          p_receipt_id: receiptId,
          p_claim_token: claimToken,
          ...commonParams,
        });
      const row = Array.isArray(data) ? data[0] : data;
      const receiptStatus = isRecord(row) && typeof row.receipt_status === "string"
        ? row.receipt_status
        : null;
      if (
        !error
        && isRecord(row)
        && row?.finalized === true
        && (
          !values.success
          || receiptStatus === "settled"
          || receiptStatus === "unknown"
        )
        && (!values.conflictCheckpoint || row.checkpointed === true)
        && (!values.toolRoundCheckpoint || row.checkpointed === true)
      ) {
        if (values.atomicChatResponse) {
          const atomicChatResponse = parseAtomicChatFinalization(row);
          if (!atomicChatResponse) continue;
          return {
            finalized: true,
            receiptStatus: receiptStatus ?? "unknown",
            atomicChatResponse,
          };
        }
        return {
          finalized: true,
          receiptStatus: receiptStatus ?? "unknown",
        };
      }
    } catch {
      // Retry the same claim-token-scoped, idempotent settlement RPC.
    }
  }
  reportOperationalError(
    "[ai-ledger] prepared receipt finalize failed after retries",
    "amora_provider_receipt_finalize_failed",
  );
  return null;
}

function toActualCostMicrousd(costUsd: number | null): number | null {
  if (costUsd === null || !Number.isFinite(costUsd) || costUsd < 0) return null;
  const microusd = Math.ceil(costUsd * 1_000_000);
  return Number.isSafeInteger(microusd) ? microusd : null;
}

function wasGenerationAttempted(normalized: OpenAIProviderError): boolean {
  if (normalized.requestStage === "input_count") return false;
  if (normalized.category === "auth_config") return false;
  return !PRE_GENERATION_PROVIDER_CODES.has(normalized.providerCode ?? "");
}

/**
 * Runs exactly one billable Amora generation boundary behind a durable
 * pre-attempt receipt. The callback's first gate marks the exact paid-provider
 * boundary. Its optional second gate reserves the same receipt before a local
 * side effect without claiming that generation was attempted. Both gates share
 * one idempotent reservation. The database admits only one receipt for
 * `(request_key, call_index, phase)` and atomically settles its maximum
 * reservation to known actual usage.
 */
export async function runAmoraProviderCallWithLedger<
  TResult extends AmoraProviderCallLedgerResult,
>(
  context: AmoraProviderCallLedgerContext,
  call: (
    beforeGeneration: () => Promise<void>,
    reserveBeforeSideEffect: () => Promise<void>,
  ) => Promise<TResult>,
  options?: AmoraProviderCallLedgerOptions<TResult>,
): Promise<TResult> {
  if (!Number.isSafeInteger(context.callIndex) || context.callIndex < 1) {
    throw new Error("[ai-ledger] callIndex must be a positive integer");
  }
  const startedAt = startLatencyClock();
  const configuredModel = DEFAULT_AMORA_MODEL_BY_ROLE[context.modelRole];
  const { admin, receiptId, claimToken } = await prepareProviderReceipt(
    context,
    configuredModel,
  );
  let providerBoundaryReached = false;
  let reservationPromise: Promise<void> | null = null;
  const reserveReceipt = async (): Promise<void> => {
    reservationPromise ??= (async () => {
      const reservation = await reserveAmoraProviderCall(admin, {
        ...context.costGuard,
        receiptId,
        claimToken,
        requestKey: context.requestKey,
      });
      if (!reservation.allowed) throw new AmoraCostGuardError(reservation);
      context.onCostReserved?.(reservation);
    })();
    await reservationPromise;
  };
  const reserveBeforeGeneration = async (): Promise<void> => {
    await reserveReceipt();
    providerBoundaryReached = true;
  };

  let result: TResult;
  try {
    result = await call(reserveBeforeGeneration, reserveReceipt);
    if (!providerBoundaryReached) {
      reportOperationalError(
        "[ai-ledger] provider callback skipped the paid-call gate",
        "amora_provider_generation_gate_skipped",
      );
      throw new Error("[ai-ledger] provider callback skipped the paid-call gate");
    }
  } catch (error) {
    const normalized = normalizeOpenAIProviderError(error, {
      model: configuredModel,
    });
    const providerAttempted = providerBoundaryReached
      && wasGenerationAttempted(normalized);
    const usageStatus: OpenAIUsageStatus = normalized.usage
      ? "complete"
      : providerAttempted
        ? normalized.usageStatus
        : "complete";
    const model = safeMetadataToken(normalized.model) ?? configuredModel;
    const costUsd = calcCostUsd(
      model,
      normalized.usage?.input_tokens,
      normalized.usage?.output_tokens,
      normalized.usage?.cache_write_input_tokens,
      normalized.usage?.cache_read_input_tokens,
    );
    await finalizeProviderReceipt(admin, receiptId, claimToken, {
      providerAttempted,
      usageStatus,
      actualCostMicrousd: providerAttempted
        ? toActualCostMicrousd(costUsd)
        : null,
      latencyMs: elapsedMs(startedAt),
      success: false,
      errorMessage: error instanceof AmoraCostGuardError
        ? "pre_generation_gate_failed"
        : `openai_${normalized.category}`,
      model,
      tokensInput: normalized.usage?.input_tokens ?? null,
      tokensOutput: normalized.usage?.output_tokens ?? null,
      metadata: {
        ...buildMetadata(context, {
          providerAttempted,
          usageStatus,
          requestId:
            normalized.requestStage === "input_count"
              ? null
              : normalized.requestId,
          responseId: normalized.responseId,
          inputCountRequestId:
            normalized.requestStage === "input_count"
              ? normalized.requestId
              : latestInputCountRequestId(normalized.inputCountAttempts),
          inputCountAttempts: normalized.inputCountAttempts,
          requestStage: normalized.requestStage ?? null,
          providerErrorCategory: normalized.category,
          providerErrorCode: normalized.providerCode,
        }),
        content_logging: "disabled",
        ledger_status: "finalized",
        cache_creation_input_tokens:
          normalized.usage?.cache_write_input_tokens ?? null,
        cache_read_input_tokens:
          normalized.usage?.cache_read_input_tokens ?? null,
      },
    });
    throw error;
  }

  const usageStatus: OpenAIUsageStatus = result.usage ? "complete" : result.usageStatus;
  const conflictCheckpoint = getAtomicConflictCheckpoint(context, result);
  const model = safeMetadataToken(result.model) ?? configuredModel;
  const costUsd = calcCostUsd(
    model,
    result.usage?.input_tokens,
    result.usage?.output_tokens,
    result.usage?.cache_write_input_tokens,
    result.usage?.cache_read_input_tokens,
  );
  let atomicChatResponse: AtomicAmoraChatResponseInput | null = null;
  let toolRoundCheckpoint: AtomicAmoraToolRoundCheckpointInput | null = null;
  if (options) {
    atomicChatResponse = options.buildAtomicChatResponse(result);
    if (atomicChatResponse) {
      atomicChatResponse = validateAtomicChatResponse(context, atomicChatResponse);
    }
    toolRoundCheckpoint = options.buildToolRoundCheckpoint?.(result) ?? null;
    if (toolRoundCheckpoint) {
      if (atomicChatResponse) {
        throw new Error("[ai-ledger] terminal response cannot be a tool checkpoint");
      }
      toolRoundCheckpoint = validateToolRoundCheckpoint(context, toolRoundCheckpoint);
    }
  }
  const finalized = await finalizeProviderReceipt(admin, receiptId, claimToken, {
    providerAttempted: true,
    usageStatus,
    actualCostMicrousd: toActualCostMicrousd(costUsd),
    latencyMs: elapsedMs(startedAt),
    success: true,
    errorMessage: null,
    model,
    tokensInput: result.usage?.input_tokens ?? null,
    tokensOutput: result.usage?.output_tokens ?? null,
    metadata: {
      ...buildMetadata(context, {
        providerAttempted: true,
        usageStatus,
        requestId: result.requestId,
        responseId: result.responseId,
        inputCountRequestId: result.inputCountRequestId,
        inputCountAttempts: result.inputCountAttempts,
        requestStage: "generation",
      }),
      content_logging: "disabled",
      ledger_status: "finalized",
      cache_creation_input_tokens:
        result.usage?.cache_write_input_tokens ?? null,
      cache_read_input_tokens:
        result.usage?.cache_read_input_tokens ?? null,
    },
    conflictCheckpoint,
    atomicChatResponse,
    toolRoundCheckpoint,
  });
  if (!finalized) {
    if (conflictCheckpoint) {
      throw new Error("[ai-ledger] conflict receipt checkpoint was not confirmed");
    }
    if (atomicChatResponse) {
      throw new Error("[ai-ledger] terminal chat response was not committed");
    }
    if (toolRoundCheckpoint) {
      throw new Error("[ai-ledger] tool-round checkpoint was not committed");
    }
    // Tool calls must never escape the ledger while their paid-generation
    // receipt is still reserved. Otherwise a mutating tool could commit and
    // the same request would be permanently blocked from safe completion.
    throw new Error("[ai-ledger] provider receipt settlement was not confirmed");
  }
  if (atomicChatResponse) {
    if (!finalized.atomicChatResponse) {
      throw new Error("[ai-ledger] terminal chat response was not committed");
    }
    options?.onAtomicChatResponseFinalized?.(finalized.atomicChatResponse);
  }
  return result;
}
