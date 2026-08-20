import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePreparationStatus } from "@hanbang/shared";
import { buildAmoraFirstUseGrounding } from "@hanbang/shared/amora-first-use-grounding";
import {
  AMORA_SCHEDULE_CARE_ACTION_DRAFT_METADATA_KEY,
  AMORA_SCHEDULE_CARE_FOLLOW_UP_METADATA_KEY,
  buildAmoraScheduleCareFollowUpPrivateMetadata,
  parseAmoraScheduleCareFollowUpPrivateMetadata,
  splitAmoraScheduleCareFollowUpAnswer,
  type AmoraScheduleCareFollowUpBinding,
} from "@hanbang/shared/amora-schedule-care-follow-up";
import {
  isAmoraFirstUseSharedDraftText,
  matchesAmoraFirstUsePendingAction,
  parseAmoraFirstUsePromotionValidation,
  type AmoraFirstUsePromotionValidation,
} from "@/lib/ai/amoraFirstUsePromotionBinding";
import { buildAmoraFirstUsePromotionSourceSeal } from "@/lib/ai/amoraFirstUsePromotion";
import { parseAmoraFirstUseDeterministicProposal } from "@/lib/ai/amoraFirstUseDeterministicProposal";
import {
  AMORA_FIRST_USE_ACTION_APPLICATION_CONFIRMATION,
  parseAmoraFirstUseActionApplicationSource,
  parseAmoraFirstUseDeterministicApplication,
  parsePersistedAmoraFirstUseDeterministicApplication,
  requiresStrictAmoraFirstUseApplicationReplay,
} from "@/lib/ai/amoraFirstUseDeterministicApplication";
import {
  AMORA_ADD_ACTION_PROPOSAL_ORIGIN,
  AMORA_ADD_ACTION_PROPOSAL_ORIGIN_METADATA_KEY,
  parseAmoraProviderBackedAddActionApplication,
  parseAmoraProviderBackedAddActionApplicationSource,
  parsePersistedAmoraProviderBackedAddActionApplication,
  requiresStrictAmoraProviderBackedAddActionApplicationReplay,
  shouldSealAmoraOrdinaryProviderAddActionProposal,
} from "@/lib/ai/amoraProviderBackedAddActionApplication";
import {
  buildAmoraScheduleCareDAfterContext,
  extractAmoraScheduleCareActionDraft,
  parseAmoraScheduleCareSharedActionDraft,
  selectAmoraScheduleCareSharedActionProposalTools,
} from "@/lib/ai/amoraScheduleCareFollowUp";
import {
  resolveAmoraScheduleCareFollowUp,
  type AmoraScheduleCareFollowUpResolutionFailure,
  type ResolvedAmoraScheduleCareFollowUp,
} from "@/lib/care/scheduleCareFollowUp";
import {
  buildMultimodalContent,
  buildToolResultInput,
  chatWithToolsStream,
} from "@/lib/ai/openai";
import type { ChatInputItem, ImageAttachment } from "@/lib/ai/openai";
import type { ChatWithToolsResult } from "@/lib/ai/openai";
import { chooseAmoraChatModelRole } from "@/lib/ai/modelConfig";
import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
  type AmoraActionContract,
} from "@/lib/ai/amoraPromptComposer";
import { AMORA_EVAL_HEADER, verifyAmoraEvalToken } from "@/lib/ai/amoraEvalAuth";
import { saveAutomaticDissatisfaction } from "@/lib/ai/automaticFeedback";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import {
  getAvailableChatTools,
  getPlaceSearchToolChoice,
} from "@/lib/ai/placeSearchRouting";
import {
  getClientSafeToolInput,
  getClientSafeToolResult,
  getModelSafeToolOutput,
  getPersistableToolResults,
  hasEphemeralPlaceSearchResult,
} from "@/lib/ai/placeSearchResultPolicy";
import { executeTool } from "@/lib/ai/toolExecutor";
import {
  bindCanonicalQuoteAnalysisInput,
  parseCanonicalQuoteAnalysisSelection,
} from "@/lib/ai/quoteAnalysisSelection";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import { extractSuggestions } from "@/lib/ai/chatSuggestions";
import { detectDissatisfaction } from "@/lib/ai/dissatisfaction";
import { composeAmoraPersistenceTerminal } from "@/lib/ai/amoraPersistenceClaims";
import { createAmoraProviderPreviewGate } from "@/lib/ai/amoraProviderPreviewGate";
import { determineStage, routeSpecialist } from "@/lib/ai/stage-router";
import { logAIInteraction, startLatencyClock, elapsedMs } from "@/lib/compliance/ai-log";
import {
  AMORA_MEDIATION_OUTPUT_GUARD_FALLBACK,
  extractMediation,
  mediationBlockToOrdinaryText,
  toUserRequestedMediationV2,
} from "@/lib/ai/mediation";
import { findMediationNeutralityViolations } from "@/lib/ai/mediationNeutrality";
import { buildMediationFollowUpSafetyMarker } from "@/lib/care/mediationFollowUpSafety";
import { sealMediationPrivateSafetyHold } from "@/lib/care/mediationPrivateSafetyHold";
import {
  AMORA_PROFILE_PROJECTION_QUERY_LIMIT,
  normalizeAmoraProfileProjectionRows,
  projectAmoraProfiles,
  toPromptAmoraProfiles,
} from "@/lib/ai/amoraProfileProjection";
import {
  AmoraPrivacyContextError,
  assertAmoraPrivacyContextSnapshotCurrent,
  getAmoraPrivacyContextSnapshot,
  getAmoraPrivacyEpoch,
  isAuxiliaryMemoryRuntimeEnabled,
  type AmoraPrivacyContextErrorCode,
  type AmoraPrivacyContextSnapshot,
} from "@/lib/ai/amoraMemoryQueue";
import { reconcilePersistedAmoraMemoryEnqueue } from "@/lib/ai/amoraMemoryReplay";
import { parseAmoraPersonalizationRow } from "@/lib/amora/personalization";
import { isFactualAmoraMemorySummary } from "@/lib/ai/amoraMemoryCompiler";
import {
  selectCurrentAmoraCoupleCriterionSnapshot,
  selectCurrentAmoraCoreCriterion,
  withoutAmoraCoreCriterionReceipts,
} from "@/lib/ai/amoraCoreCriterion";
import { isAmoraConversationSegmentReadEnabled } from "@/lib/ai/amoraConversationSegmentRead";
import { resolveAmoraWeddingContext } from "@/lib/ai/amoraWeddingContext";
import {
  AMORA_ATTACHMENT_MEDIA_TYPES,
  AMORA_MAX_ATTACHMENT_BYTES,
  AMORA_MAX_ATTACHMENTS,
  AMORA_MAX_TOTAL_ATTACHMENT_BYTES,
  AmoraAttachmentValidationError,
  AmoraDocxArchiveValidationError,
  assertSafeDocxArchive,
  validateAmoraAttachments,
  type AmoraAttachmentMediaType,
  type ValidatedAmoraAttachment,
} from "@/lib/ai/amoraAttachments";
import {
  createChatImageObjectPathV2,
  verifyChatImageObjectBindings,
} from "@/lib/chat/attachmentStorage";
import {
  runAmoraProviderCallWithLedger,
  type AtomicAmoraChatResponseFinalization,
} from "@/lib/ai/amoraProviderCallLedger";
import {
  buildAmoraToolRoundCheckpoint,
  loadAmoraToolRoundJournal,
  type AmoraToolRoundCheckpoint,
} from "@/lib/ai/amoraTurnJournal";
import {
  selectAmoraPendingProposalTools,
  selectAmoraTools,
} from "@/lib/ai/amoraToolPolicy";
import {
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
} from "@/lib/ai/amoraQuestionScope";
import {
  buildAmoraBoundedContinuity,
  canAttemptAmoraBoundedContinuity,
} from "@/lib/ai/amoraBoundedContinuity";
import { selectAmoraTrustedHistoryRows } from "@/lib/ai/amoraTrustedHistory";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { getAmoraActionApprovalPolicy } from "@/lib/ai/amoraActionApprovalPolicy";
import {
  buildAmoraApprovedActionPrompt,
  buildAmoraPendingActionPrompt,
  extractAmoraPendingAction,
  resolveAmoraPendingAction,
} from "@/lib/ai/amoraPendingAction";
import { buildAmoraBudgetImpactPreview } from "@/lib/ai/amoraBudgetImpactPreview";
import {
  AMORA_MAX_TOOL_ROUNDS,
  AMORA_MAX_TOOL_CALLS_PER_TURN,
  AMORA_MAX_TOOL_FEEDBACK_CHARS_PER_TURN,
  AMORA_MAX_TOOL_RESULT_CHARS,
  AMORA_TOTAL_REQUEST_DEADLINE_MS,
  boundAmoraToolResultJson,
  boundAmoraTextAttachments,
  getAmoraProviderCallCostReservationMicrousd,
  getAmoraProviderRequestPolicy,
  takeRecentAmoraConversation,
} from "@/lib/ai/amoraRequestPolicy";
import { AmoraCostGuardError } from "@/lib/ai/costGuard";
import { deriveAmoraQuotaSubjectId } from "@/lib/ai/amoraQuotaSubject";
import {
  AMORA_CRISIS_CONTACT_POLICY_VERSION,
  buildAmoraCrisisResponse,
  classifyAmoraCrisis,
  type AmoraCrisisKind,
} from "@/lib/ai/amoraCrisisSafety";
import { assessAmoraSafetyText } from "@/lib/ai/amoraCrisisClassifier";
import {
  AiMessagePersistenceError,
  findPersistedAiMessage,
  persistAiMessage,
  type PersistedAiMessage,
} from "@/lib/ai/chatMessagePersistence";
import {
  ChatRequestClaimError,
  claimChatRequest,
  failChatRequest,
  reconcileChatRequest,
} from "@/lib/ai/chatRequestClaim";
import { NextResponse } from "next/server";
import type { ToolExecutionResult } from "@/types/database.types";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import {
  getCookieValue,
  hasSignedDemoSessionFromCookieHeader,
} from "@/lib/demoSession";
import {
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";
import { createHash, randomUUID } from "node:crypto";
import { isSupersededDecision } from "@/lib/ai/supersededDecisions";
import { inspectScheduleEvents } from "@/utils/scheduleEvents";
import { ymdInKst } from "@/lib/utils/kstDate";
// mammoth는 필요할 때만 동적 import (Vercel 호환성)

// Vercel Pro: 최대 300초 (5분)
export const maxDuration = 300;

const MAX_EXTRACTED_TEXT_CHARS = 80_000;
const MAX_DOCX_EXTRACTED_TEXT_CHARS = 200_000;
const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;
const MAX_CONTEXT_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 20_000;
const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));
const MAX_TOTAL_MESSAGE_CHARS = 200_000;
const CLIENT_REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-store",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};
const DEMO_COUPLE_ID = "demo-couple";
const DEMO_ACTOR_ID = "amora-signed-demo";
const DEMO_COST_GUARD_COUPLE_ID = "00000000-0000-4000-8000-000000000000";
const EVAL_ACTOR_ID = "amora-release-eval";
const EVAL_COST_LEDGER_COUPLE_ID = "00000000-0000-4000-8000-000000000001";
const CANONICAL_ATTACHMENT_MANIFEST_KEYS = new Set([
  "media_type",
  "byte_length",
  "sha256",
]);
const CANONICAL_ATTACHMENT_MEDIA_TYPES = new Set<string>(
  AMORA_ATTACHMENT_MEDIA_TYPES,
);

type CanonicalProviderAttachmentManifestEntry = {
  mediaType: AmoraAttachmentMediaType;
  byteLength: number;
  sha256: string;
};

type CanonicalProviderAttachmentContract = {
  version: 1 | 2;
  state: "none" | "present" | "discarded_by_safety_policy";
  count: number;
  manifest: CanonicalProviderAttachmentManifestEntry[] | null;
  imagePaths: string[];
};

function parseCanonicalProviderAttachmentManifest(
  value: unknown,
  expectedCount: number,
): CanonicalProviderAttachmentManifestEntry[] | null {
  if (
    !Array.isArray(value)
    || value.length !== expectedCount
    || value.length < 1
    || value.length > AMORA_MAX_ATTACHMENTS
  ) {
    return null;
  }

  const manifest: CanonicalProviderAttachmentManifestEntry[] = [];
  let totalBytes = 0;
  for (const entry of value) {
    if (
      !isRecord(entry)
      || Object.keys(entry).length !== CANONICAL_ATTACHMENT_MANIFEST_KEYS.size
      || Object.keys(entry).some((key) => !CANONICAL_ATTACHMENT_MANIFEST_KEYS.has(key))
      || typeof entry.media_type !== "string"
      || !CANONICAL_ATTACHMENT_MEDIA_TYPES.has(entry.media_type)
      || !Number.isSafeInteger(entry.byte_length)
      || (entry.byte_length as number) < 1
      || (entry.byte_length as number) > AMORA_MAX_ATTACHMENT_BYTES
      || typeof entry.sha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(entry.sha256)
    ) {
      return null;
    }
    totalBytes += entry.byte_length as number;
    if (totalBytes > AMORA_MAX_TOTAL_ATTACHMENT_BYTES) return null;
    manifest.push({
      mediaType: entry.media_type as AmoraAttachmentMediaType,
      byteLength: entry.byte_length as number,
      sha256: entry.sha256,
    });
  }
  return manifest;
}

function matchesCanonicalProviderAttachmentManifest(
  attachments: readonly ValidatedAmoraAttachment[],
  manifest: readonly CanonicalProviderAttachmentManifestEntry[],
): boolean {
  if (attachments.length !== manifest.length) return false;
  return attachments.every((attachment, index) => {
    const expected = manifest[index];
    if (!expected || attachment.mediaType !== expected.mediaType) return false;
    const bytes = Buffer.from(attachment.base64, "base64");
    return bytes.byteLength === expected.byteLength
      && createHash("sha256").update(bytes).digest("hex") === expected.sha256;
  });
}

function isMissingChatImageObjectError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const status = String(error.statusCode ?? error.status ?? "");
  const detail = `${String(error.error ?? "")} ${String(error.message ?? "")}`
    .toLowerCase();
  return status === "404" || detail.includes("not found");
}

function getAmoraInputStreamError(error: unknown): {
  code:
    | "AMORA_INPUT_TOO_LARGE"
    | "AMORA_INPUT_COUNT_UNAVAILABLE"
    | "AMORA_PROVIDER_UNAVAILABLE";
  message: string;
} | null {
  if (!isRecord(error)) return null;
  if (error.providerCode === "input_token_limit") {
    return {
      code: "AMORA_INPUT_TOO_LARGE",
      message: "대화나 첨부파일 내용이 너무 길어요. 첨부파일을 줄이거나 새 대화에서 다시 시도해주세요.",
    };
  }
  // 외부 호출 게이트는 거부된 단계를 그대로 실어 보낸다. 토큰을 세는 중에
  // 거부되면 requestStage가 "input_count"로 도착하지만, 이것은 입력 길이가
  // 아니라 권한·설정 상태이고 같은 요청을 다시 보낸다고 풀리지 않는다.
  // 입력 분량 문제로 표시하면 사용자가 자기 글을 줄여 가며 무한히 재시도한다.
  if (error.providerCode === "AMORA_PROVIDER_EGRESS_DENIED") {
    return {
      code: "AMORA_PROVIDER_UNAVAILABLE",
      message: "아모라가 지금 답할 수 없어요. 입력하신 내용 때문이 아니니 이 대화는 그대로 두고 잠시 뒤에 다시 열어 주세요.",
    };
  }
  if (error.requestStage === "input_count") {
    return {
      code: "AMORA_INPUT_COUNT_UNAVAILABLE",
      message: "입력 분량을 확인하는 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.",
    };
  }
  return null;
}

function getAmoraPrivacyContextErrorCode(
  error: unknown,
): AmoraPrivacyContextErrorCode | null {
  if (!isRecord(error)) return null;
  return error.code === "AMORA_PRIVACY_CONTEXT_UNAVAILABLE"
    || error.code === "AMORA_PRIVACY_CONTEXT_CHANGED"
    ? error.code
    : null;
}

class AmoraMemoryEnqueueRetryError extends Error {
  readonly code = "AMORA_MEMORY_ENQUEUE_RETRY_REQUIRED";

  constructor() {
    super("AMORA_MEMORY_ENQUEUE_RETRY_REQUIRED");
    this.name = "AmoraMemoryEnqueueRetryError";
  }
}

function getEvalRequestLimit(request: Request): { key: string; maxRequests: number } {
  const hostname = new URL(request.url).hostname.toLowerCase().replace(/\.+$/, "");
  const isProduction =
    process.env.VERCEL_ENV === "production" ||
    hostname === "hanbang.ai" ||
    hostname.endsWith(".hanbang.ai");
  return {
    // All aliases for the same production deployment share one bucket. This
    // prevents the immutable *.vercel.app URL from creating a second allowance.
    key: isProduction ? "chat-eval:production" : `chat-eval:${hostname || "unknown"}`,
    // The production CLI makes exactly six provider requests per run and never
    // retries. One extra run is allowed for a failed release/rollback check.
    maxRequests: isProduction ? 12 : 36,
  };
}

function getStoredSuggestions(message: PersistedAiMessage): string[] {
  const value = message.metadata?.suggestions;
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.length <= 160)
    .slice(0, 4);
}

function deriveBoundRequestId(clientRequestId: string, userMessageId: string): string {
  const digest = createHash("sha256")
    .update(`amora-chat-request\0${clientRequestId}\0${userMessageId}`, "utf8")
    .digest("hex")
    .slice(0, 32)
    .split("");
  // Keep the durable key compatible with the UUID-shaped database contract.
  digest[12] = "5";
  digest[16] = "8";
  const value = digest.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function deriveConfirmedActionRequestId(
  userMessageId: string,
  confirmedActionId: string,
): string {
  const digest = createHash("sha256")
    .update(
      `amora-confirmed-action-request\0${userMessageId}\0${confirmedActionId}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "5";
  digest[16] = "8";
  const value = digest.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

interface ChatActorProfile {
  couple_id: string | null;
  role: string | null;
  is_admin: boolean | null;
  name: string | null;
  preparation_status: string | null;
}

/**
 * 채팅 요청을 보낸 사람의 프로필.
 *
 * `preparation_status`는 있으면 쓰고 없으면 없는 대로 둔다. 이 컬럼을 select에 그냥
 * 넣었더니, 마이그레이션이 아직 적용되지 않은 환경에서 PostgREST가
 * `column profiles.preparation_status does not exist`로 400을 돌려주고 **채팅 전체가
 * 죽었다.** 로컬에서 기존 DB에 붙여 개발하던 흐름이 그날로 막혔다.
 *
 * 마이그레이션 파일을 쓰는 것과 그 마이그레이션이 적용된 것은 다르다. 새 코드는 옛
 * 스키마에서도 돌아야 하고, 그래야 마이그레이션과 배포의 순서에 여유가 생긴다.
 * 컬럼이 생기면 아무것도 안 해도 값이 실려 온다.
 */
async function readChatActorProfile(actorId: string): Promise<ChatActorProfile | null> {
  const client = getServiceClient();
  const withStatus = await client
    .from("profiles")
    .select("couple_id, role, is_admin, name, preparation_status")
    .eq("id", actorId)
    .single();
  if (!withStatus.error) return withStatus.data as unknown as ChatActorProfile;

  // 42703 = undefined_column. 그 외의 오류는 진짜 실패이므로 삼키지 않는다.
  if (withStatus.error.code !== "42703") return null;

  const legacy = await client
    .from("profiles")
    .select("couple_id, role, is_admin, name")
    .eq("id", actorId)
    .single();
  if (legacy.error || !legacy.data) return null;
  return {
    ...(legacy.data as unknown as Omit<ChatActorProfile, "preparation_status">),
    preparation_status: null,
  };
}

function getDoneMetadata(
  message: PersistedAiMessage,
  stripSuggestions = false,
): Record<string, unknown> {
  const metadata = { ...(message.metadata ?? {}) };
  delete metadata.client_request_id;
  if (stripSuggestions) delete metadata.suggestions;
  if (Array.isArray(metadata.toolResults)) {
    const persistableResults = getPersistableToolResults(
      metadata.toolResults as ToolExecutionResult[]
    );
    if (persistableResults.length > 0) metadata.toolResults = persistableResults;
    else delete metadata.toolResults;
  }
  return {
    ...metadata,
    stageTag: message.stageTag,
    specialistType: message.specialistType,
    serverMessageId: message.id,
    serverCreatedAt: message.createdAt,
    replayed: message.reused,
  };
}

function replayPersistedMessage(
  message: PersistedAiMessage,
  stripSuggestions = false,
): Response {
  const events: Array<Record<string, unknown>> = [];
  const suggestions = stripSuggestions ? [] : getStoredSuggestions(message);
  if (suggestions.length > 0) events.push({ type: "suggestions", suggestions });
  events.push({
    type: "done",
    fullContent: message.content ?? "",
    metadata: getDoneMetadata(message, stripSuggestions),
  });
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(payload, { headers: SSE_HEADERS });
}

function replayEphemeralCrisisMessage(
  content: string,
  kind: AmoraCrisisKind,
  durableSafetyFenceConfirmed = true,
): Response {
  const payload = `data: ${JSON.stringify({
    type: "done",
    fullContent: content,
    metadata: {
      response_origin: "deterministic_crisis_safety",
      safety_classification: kind,
      safety_contact_policy: AMORA_CRISIS_CONTACT_POLICY_VERSION,
      question_scope: "W5_safety_override",
      memory_eligible: false,
      persistence_status: "unconfirmed_ephemeral_fallback",
      durable_safety_fence_confirmed: durableSafetyFenceConfirmed,
      stageTag: null,
      specialistType: null,
      replayed: false,
    },
  })}\n\n`;
  return new Response(payload, {
    headers: SSE_HEADERS,
    // The deterministic safety guidance is a successful, complete SSE reply.
    // Durable hold persistence is reported independently in metadata so every
    // supported client can render the guidance even when that write is down.
    status: 200,
  });
}

function isValidChatMessages(value: unknown): value is Array<{
  role: "user" | "assistant";
  content: string;
  id?: string;
}> {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CONTEXT_MESSAGES) {
    return false;
  }
  let totalChars = 0;
  let hasUserMessage = false;
  for (const message of value) {
    if (!isRecord(message)) return false;
    if (message.role !== "user" && message.role !== "assistant") return false;
    if (typeof message.content !== "string") return false;
    const length = message.content.length;
    if (length < 1 || length > MAX_MESSAGE_CHARS || !message.content.trim()) return false;
    if (message.id !== undefined &&
        (typeof message.id !== "string" || message.id.length < 1 || message.id.length > 128)) {
      return false;
    }
    totalChars += length;
    if (totalChars > MAX_TOTAL_MESSAGE_CHARS) return false;
    if (message.role === "user") hasUserMessage = true;
  }
  return hasUserMessage;
}

// Service role 클라이언트 (RLS 우회 — 자동 피드백 저장용)
function getServiceClient() {
  return createAdminClient();
}

function scheduleCareFollowUpFailureResponse(
  reason: AmoraScheduleCareFollowUpResolutionFailure,
): NextResponse {
  if (reason === "scope_changed") {
    return NextResponse.json(
      {
        error:
          "이 비공개 안부 카드의 현재 사용자 또는 커플 연결이 달라졌어요. 새 카드에서 다시 시작해주세요.",
        code: "AMORA_SCHEDULE_CARE_FOLLOW_UP_SCOPE_CHANGED",
        retryable: false,
        retryPolicy: "new_message",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (reason === "privacy_unavailable" || reason === "source_unavailable") {
    return NextResponse.json(
      {
        error:
          "상견례 안부 카드의 현재 상태를 안전하게 확인하지 못했어요. 잠시 후 같은 요청으로 다시 시도해주세요.",
        code: "AMORA_SCHEDULE_CARE_FOLLOW_UP_UNAVAILABLE",
        retryable: true,
        retryPolicy: "same_request",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (reason === "invalid_binding") {
    return NextResponse.json(
      {
        error:
          "상견례 안부 카드의 연결 정보가 올바르지 않아요. 새 메시지에서 다시 시작해주세요.",
        code: "AMORA_SCHEDULE_CARE_FOLLOW_UP_INVALID",
        retryable: false,
        retryPolicy: "new_message",
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    {
      error:
        "상견례 안부 카드가 최신 준비 상태와 달라졌어요. 홈에서 새 카드를 열어 다시 정리해주세요.",
      code: "AMORA_SCHEDULE_CARE_FOLLOW_UP_STALE",
      retryable: false,
      retryPolicy: "regenerate_schedule_care_follow_up",
    },
    { status: 409, headers: { "Cache-Control": "no-store" } },
  );
}

// 자동 피드백 저장 (비동기, 에러 무시 — 채팅 흐름 방해 금지)
async function autoSaveDissatisfaction(params: {
  userId: string;
  coupleId: string;
  signal: "correction" | "retry" | "frustration" | "negative" | "confusion" | "disengagement";
  visibility: "shared" | "bride_private" | "groom_private";
}) {
  try {
    await saveAutomaticDissatisfaction(params, async (record) => {
      const admin = getServiceClient();
      const { error } = await admin.from("chat_feedback").insert(record);
      if (error) throw error;
    });
  } catch (err) {
    console.error("자동 불만족 피드백 저장 실패 (무시됨):", err);
  }
}

// DOCX에서 텍스트 추출 (동적 import)
async function extractDocxText(base64: string): Promise<string> {
  const buffer = Buffer.from(base64, "base64");
  assertSafeDocxArchive(buffer);
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  if (
    typeof result.value !== "string"
    || result.value.length > MAX_DOCX_EXTRACTED_TEXT_CHARS
  ) {
    throw new AmoraAttachmentProcessingError(
      "DOCX extracted text exceeded the safe output limit",
      "DOCX_TEXT_TOO_LARGE",
    );
  }
  return result.value.trim();
}

// 첨부파일 처리: OpenAI Responses API에 보낼 형태로 변환
interface ProcessedAttachment {
  visionAttachments: ImageAttachment[]; // 이미지/PDF → OpenAI image/file input
  textAttachments: string[]; // DOCX → 추출된 텍스트
}

const VISION_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
]);
const DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

class AmoraAttachmentProcessingError extends Error {
  constructor(
    message: string,
    readonly code:
      | "ATTACHMENT_PROCESSING_FAILED"
      | "UNSAFE_DOCX_ARCHIVE"
      | "DOCX_TEXT_TOO_LARGE" =
      "ATTACHMENT_PROCESSING_FAILED",
  ) {
    super(message);
    this.name = "AmoraAttachmentProcessingError";
  }
}

function limitExtractedText(text: string): string {
  return text.length > MAX_EXTRACTED_TEXT_CHARS
    ? `${text.slice(0, MAX_EXTRACTED_TEXT_CHARS)}\n\n[첨부문서가 길어 일부만 분석합니다.]`
    : text;
}

async function processAttachments(
  attachments: ValidatedAmoraAttachment[],
): Promise<ProcessedAttachment> {
  const visionAttachments: ImageAttachment[] = [];
  const textAttachments: string[] = [];

  for (const [index, item] of attachments.entries()) {
    if (VISION_TYPES.has(item.mediaType)) {
      visionAttachments.push({
        base64: item.base64,
        mediaType: item.mediaType as ImageAttachment["mediaType"],
        fileName:
          item.mediaType === "application/pdf"
            ? `attachment-${index + 1}.pdf`
            : undefined,
      });
    } else if (item.mediaType === DOCX_MEDIA_TYPE) {
      try {
        const text = await extractDocxText(item.base64);
        if (!text) throw new Error("empty document");
        textAttachments.push(
          `[첨부문서: attachment-${index + 1}.docx]\n${limitExtractedText(text)}`,
        );
      } catch (error) {
        if (error instanceof AmoraAttachmentProcessingError) throw error;
        if (error instanceof AmoraDocxArchiveValidationError) {
          throw new AmoraAttachmentProcessingError(
            "DOCX archive failed safety inspection",
            "UNSAFE_DOCX_ARCHIVE",
          );
        }
        throw new AmoraAttachmentProcessingError(
          "DOCX attachment could not be parsed",
        );
      }
    }
  }

  return { visionAttachments, textAttachments };
}

export async function POST(request: Request) {
  const requestDeadlineAt = Date.now() + AMORA_TOTAL_REQUEST_DEADLINE_MS;
  const rawBody = await readBoundedUtf8Text(request, MAX_REQUEST_BODY_BYTES);
  if (!rawBody.ok) {
    return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
  }
  // 인증 체크 (웹: 쿠키, 앱: Bearer 토큰)
  let body: Record<string, unknown>;
  try {
    const rawBodyText = rawBody.text;
    if (Buffer.byteLength(rawBodyText, "utf8") > MAX_REQUEST_BODY_BYTES) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }
    const parsed = JSON.parse(rawBodyText) as unknown;
    if (!isRecord(parsed)) throw new Error("invalid body");
    body = parsed;
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const {
    messages,
    coupleId,
    senderName,
    weddingContext,
    attachments,
    conflictContext,
    isDemo: bodyIsDemo,
    clientRequestId: bodyClientRequestId,
    userMessageId: bodyUserMessageId,
    confirmedActionId: bodyConfirmedActionId,
    requestKind: bodyRequestKind,
    conversationMode: bodyConversationMode,
    visibility: bodyVisibility,
  } = body;
  const isDemo =
    bodyIsDemo === true &&
    hasSignedDemoSessionFromCookieHeader(request.headers.get("cookie"));
  const evalToken = request.headers.get(AMORA_EVAL_HEADER);
  const isEvaluation =
    isDemo &&
    typeof bodyClientRequestId === "string" &&
    CLIENT_REQUEST_ID_RE.test(bodyClientRequestId) &&
    verifyAmoraEvalToken(evalToken, bodyClientRequestId);
  if (evalToken && !isEvaluation) {
    return NextResponse.json(
      { error: "운영 평가 인증을 확인하지 못했습니다." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!isDemo && !isTrustedMutationRequest(request)) {
    return NextResponse.json(
      { error: "요청 출처를 확인할 수 없습니다.", code: "UNTRUSTED_MUTATION_REQUEST" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Real users authenticate with Supabase. The public demo is authorized by a
  // separate signed, HttpOnly session cookie and never receives database write access.
  const supabase = await createClientFromRequest(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isDemo) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  if (!isDemo) {
    const mutationActorFence = verifyMutationActorFence(request.headers, user!.id);
    if (!mutationActorFence.ok) {
      return NextResponse.json(
        {
          error: mutationActorFence.message,
          code: mutationActorFence.code,
        },
        {
          status: mutationActorFence.status,
          headers: { "Cache-Control": "private, no-store, max-age=0" },
        },
      );
    }
  }

  const actorId = user?.id ?? (isEvaluation ? EVAL_ACTOR_ID : DEMO_ACTOR_ID);
  const evalLimit = isEvaluation ? getEvalRequestLimit(request) : null;

  if (
    !isValidChatMessages(messages) ||
    typeof coupleId !== "string" ||
    (isDemo ? coupleId !== DEMO_COUPLE_ID : !isUuid(coupleId))
  ) {
    return NextResponse.json(
      { error: "메시지 또는 커플 ID 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  if (senderName !== undefined &&
      (typeof senderName !== "string" || senderName.length > 100)) {
    return NextResponse.json({ error: "이름 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (weddingContext !== undefined && !isRecord(weddingContext)) {
    return NextResponse.json({ error: "웨딩 정보 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (bodyVisibility !== undefined &&
      !["shared", "bride_private", "groom_private"].includes(String(bodyVisibility))) {
    return NextResponse.json({ error: "채팅 공개 범위가 올바르지 않습니다." }, { status: 400 });
  }
  if (
    bodyRequestKind !== undefined &&
    bodyRequestKind !== "chat" &&
    bodyRequestKind !== "initial_greeting" &&
    bodyRequestKind !== "mediation"
  ) {
    return NextResponse.json({ error: "요청 종류가 올바르지 않습니다." }, { status: 400 });
  }
  if (
    bodyConversationMode !== undefined
    && bodyConversationMode !== "listen_only"
  ) {
    return NextResponse.json(
      { error: "대화 모드가 올바르지 않습니다.", code: "INVALID_CONVERSATION_MODE" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (
    bodyRequestKind === "mediation" &&
    (typeof conflictContext !== "string" ||
      conflictContext.trim().length < 4 ||
      conflictContext.length > 600)
  ) {
    return NextResponse.json({ error: "중재 맥락 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const attachmentInput = attachments ?? body.images ?? [];
  if (bodyClientRequestId !== undefined &&
      (typeof bodyClientRequestId !== "string" || !CLIENT_REQUEST_ID_RE.test(bodyClientRequestId))) {
    return NextResponse.json(
      { error: "요청 식별자 형식이 올바르지 않습니다.", code: "INVALID_CLIENT_REQUEST_ID" },
      { status: 400 },
    );
  }
  if (bodyUserMessageId !== undefined &&
      (typeof bodyUserMessageId !== "string" || !isUuid(bodyUserMessageId))) {
    return NextResponse.json(
      { error: "저장 메시지 식별자 형식이 올바르지 않습니다.", code: "INVALID_USER_MESSAGE_ID" },
      { status: 400 },
    );
  }
  if (bodyConfirmedActionId !== undefined &&
      (typeof bodyConfirmedActionId !== "string" || !isUuid(bodyConfirmedActionId))) {
    return NextResponse.json(
      {
        error: "확인할 변경 식별자가 올바르지 않습니다.",
        code: "INVALID_CONFIRMED_ACTION_ID",
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  const rawClientRequestId = bodyClientRequestId ?? randomUUID();
  const requestKind =
    bodyRequestKind === "initial_greeting"
      ? "initial_greeting"
      : bodyRequestKind === "mediation"
        ? "mediation"
        : "chat";
  const interactionMode = bodyConversationMode === "listen_only"
    ? "listen_only" as const
    : "planning" as const;
  const isListenOnly = interactionMode === "listen_only";
  const requestedVisibility: "shared" | "bride_private" | "groom_private" =
    bodyVisibility === "bride_private" || bodyVisibility === "groom_private" ? bodyVisibility : "shared";
  let visibility: "shared" | "bride_private" | "groom_private" = requestedVisibility;

  if (
    isListenOnly
    && (
      isDemo
      || requestKind !== "chat"
      || typeof bodyUserMessageId !== "string"
      || bodyConfirmedActionId !== undefined
      || !Array.isArray(attachmentInput)
      || attachmentInput.length > 0
      || conflictContext !== undefined
    )
  ) {
    return NextResponse.json(
      {
        error: "그냥 들어줘 모드는 저장된 아모라 대화 한 턴에서만 사용할 수 있어요.",
        code: "LISTEN_ONLY_REQUEST_INVALID",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // coupleId 소유 검증: 해당 커플에 속하는 사용자인지 확인
  const userProfile = isDemo
    ? {
        couple_id: DEMO_COUPLE_ID,
        role: "bride" as const,
        is_admin: false,
        name: "체험 사용자",
        preparation_status: "preparing" as const,
      }
    : await readChatActorProfile(actorId);

  if (userProfile?.couple_id !== coupleId) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }
  const dataCoupleId = isEvaluation
    ? EVAL_COST_LEDGER_COUPLE_ID
    : isDemo
      ? DEMO_COST_GUARD_COUPLE_ID
      : coupleId;
  const safeSenderName =
    typeof userProfile.name === "string" && userProfile.name.trim()
      ? userProfile.name.trim().slice(0, 100)
      : "고객";

  if (isDemo && requestedVisibility !== "shared") {
    return NextResponse.json({ error: "체험 상담은 공유 모드만 사용할 수 있습니다." }, { status: 400 });
  }

  if (!isDemo && requestKind === "mediation") {
    const role = userProfile?.role;
    if (role !== "bride" && role !== "groom") {
      return NextResponse.json({ error: "역할이 설정되지 않았습니다." }, { status: 400 });
    }
    const actorPrivateVisibility = role === "groom"
      ? "groom_private" as const
      : "bride_private" as const;
    if (
      requestedVisibility !== "shared"
      && requestedVisibility !== actorPrivateVisibility
    ) {
      return NextResponse.json({ error: "비공개 채팅 권한이 없습니다." }, { status: 403 });
    }
    // A mediation request is only a private review draft at this boundary.
    // Sharing is a separate authenticated mutation after the requester sees
    // the exact draft. Old clients may still send `shared`; never trust that
    // field to disclose the assistant response.
    visibility = actorPrivateVisibility;
  } else if (requestedVisibility !== "shared") {
    const role = userProfile?.role;
    if (role !== "bride" && role !== "groom") {
      return NextResponse.json({ error: "역할이 설정되지 않았습니다." }, { status: 400 });
    }

    const allowedPrivateVisibility = role === "groom" ? "groom_private" : "bride_private";
    if (requestedVisibility !== allowedPrivateVisibility) {
      return NextResponse.json({ error: "비공개 채팅 권한이 없습니다." }, { status: 403 });
    }
    visibility = allowedPrivateVisibility;
  }

  // A partner may see the shared allowance because every shared turn is
  // visible to both people. Private usage must never change that number, so a
  // durable private lane receives an actor-only opaque quota subject. Demo and
  // signed evaluation keep their isolated synthetic ledger subjects.
  const quotaSubjectId = !isDemo && !isEvaluation
    ? deriveAmoraQuotaSubjectId({
        coupleId,
        actorUserId: actorId,
        visibility,
      })
    : dataCoupleId;

  const visibleClientRequestKey = `chat:${actorId}:${rawClientRequestId}`;
  const durableClientRequestUuid =
    requestKind === "chat"
      && typeof bodyUserMessageId === "string"
      && typeof bodyConfirmedActionId === "string"
      ? deriveConfirmedActionRequestId(
          bodyUserMessageId,
          bodyConfirmedActionId,
        )
      : requestKind === "chat" && typeof bodyUserMessageId === "string"
        ? deriveBoundRequestId(rawClientRequestId, bodyUserMessageId)
      : rawClientRequestId;
  const clientRequestId = requestKind === "initial_greeting"
    ? `greeting:${actorId}`
    : `chat:${actorId}:${durableClientRequestUuid}`;
  const requestCorrelationId = createHash("sha256")
    .update(clientRequestId)
    .digest("hex");
  const replayPersistedWithMemoryReconciliation = async (
    message: PersistedAiMessage,
    expectedReplayPrivacyEpoch: number,
  ): Promise<Response> => {
    const persistedMetadata = isRecord(message.metadata) ? message.metadata : null;
    const persistedInteractionMode = persistedMetadata?.interaction_mode;
    if (
      isListenOnly
        ? persistedInteractionMode !== "listen_only"
        : persistedInteractionMode !== undefined
    ) {
      return NextResponse.json(
        {
          error: "저장된 답변의 대화 모드를 안전하게 확인하지 못했어요.",
          code: "CHAT_REPLAY_INTERACTION_MODE_MISMATCH",
          retryable: false,
          retryPolicy: "new_message",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const memoryReconciliation = isListenOnly
      ? { status: "not_eligible" as const }
      : await reconcilePersistedAmoraMemoryEnqueue({
          coupleId,
          userId: actorId,
          expectedVisibility: visibility,
          message,
        });
    if (memoryReconciliation.status === "retry_required") {
      console.error("[chat] persisted memory enqueue retry required", {
        requestCorrelationId,
        messageId: message.id,
        visibility,
      });
      return NextResponse.json(
        {
          error:
            "답변은 저장됐지만 장기 기억 반영을 확인하지 못했어요. 같은 요청으로 다시 시도해주세요.",
          code: "AMORA_MEMORY_ENQUEUE_RETRY_REQUIRED",
          retryable: true,
          retryPolicy: "same_request",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (memoryReconciliation.status === "invalid_message_scope") {
      console.error("[chat] persisted memory message scope mismatch", {
        requestCorrelationId,
        messageId: message.id,
        visibility,
      });
      return NextResponse.json(
        {
          error: "저장된 답변의 공개 범위를 안전하게 확인하지 못했어요.",
          code: "CHAT_REPLAY_INCONSISTENT",
          retryable: false,
          retryPolicy: "new_message",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    // The persisted row is read with the service client, so its final release
    // must be bound back to the request actor. Re-reading the authenticated
    // scalar epoch here validates the current couple roster/private scope and
    // detects revocation between replay preflight and response construction.
    const currentReplayPrivacyEpoch = await getAmoraPrivacyEpoch(
      dataCoupleId,
      visibility,
      supabase,
    );
    if (currentReplayPrivacyEpoch !== expectedReplayPrivacyEpoch) {
      throw new AmoraPrivacyContextError("AMORA_PRIVACY_CONTEXT_CHANGED");
    }
    return replayPersistedMessage(
      message,
      requestKind === "mediation" || isListenOnly,
    );
  };
  const demoSessionToken = isDemo
    ? getCookieValue(request.headers.get("cookie"), "demo_session")
    : null;
  const safetyIdentifierScope = isDemo
    ? `demo:${createHash("sha256")
        .update(demoSessionToken ?? rawClientRequestId)
        .digest("hex")}`
    : actorId;

  // This deterministic boundary intentionally runs before the ordinary chat
  // limiter, attachment parsing, durable claim, auxiliary context reads, and
  // every provider call. An infrastructure or malformed-attachment failure
  // must never hide time-critical contact guidance.
  let earlyCrisisUserText: string | null = null;
  let trustedCanonicalScopeUserRow: Record<string, unknown> | null = null;
  let canonicalProviderAttachmentContract: CanonicalProviderAttachmentContract | null = null;
  let scheduleCareFollowUpBinding: AmoraScheduleCareFollowUpBinding | null = null;
  let resolvedScheduleCareFollowUp: ResolvedAmoraScheduleCareFollowUp | null = null;
  let scheduleCareFollowUpAnswer: string | null = null;
  if (requestKind === "mediation") {
    earlyCrisisUserText = String(conflictContext).trim();
  } else if (requestKind === "chat") {
    const latestClientUserText = [
      ...(messages as Array<{ role: "user" | "assistant"; content: string }>),
    ].reverse().find((message) => message.role === "user")?.content ?? null;

    if (isDemo) {
      earlyCrisisUserText = latestClientUserText;
    } else {
      try {
        let query = supabase
          .from("chat_messages")
          .select("id, content, sender_id, sender_type, role, metadata, visibility, segment_id, created_at")
          .eq("couple_id", coupleId)
          .eq("sender_id", actorId)
          .eq("role", "user")
          .eq("visibility", visibility)
          .or("metadata->>target.is.null,metadata->>target.neq.partner");
        query = typeof bodyUserMessageId === "string"
          ? query.eq("id", bodyUserMessageId)
          : query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
        const canonicalCrisisRow = await query.maybeSingle();
        if (
          canonicalCrisisRow.data
          && (
            typeof bodyUserMessageId !== "string"
            || canonicalCrisisRow.data.id === bodyUserMessageId
          )
          && canonicalCrisisRow.data.sender_type !== "ai"
          && canonicalCrisisRow.data.sender_id === actorId
          && canonicalCrisisRow.data.role === "user"
          && typeof canonicalCrisisRow.data.content === "string"
        ) {
          earlyCrisisUserText = canonicalCrisisRow.data.content;
          trustedCanonicalScopeUserRow = canonicalCrisisRow.data;
        } else {
          // Returning fixed emergency guidance is safe even if the focused
          // canonical read is unavailable; never send this fallback to a model
          // and never persist it as a durable reply.
          earlyCrisisUserText = latestClientUserText;
        }
      } catch {
        earlyCrisisUserText = latestClientUserText;
      }
    }
  }

  // A schedule-care row carries a server-issued private capability. Validate
  // its durable envelope before replay, but defer the live source resolution
  // until after exact-completion recovery. A retry of an already committed
  // response must remain recoverable even if the source card later expires.
  if (
    !isDemo
    && requestKind === "chat"
    && trustedCanonicalScopeUserRow !== null
  ) {
    const canonicalMetadata = isRecord(trustedCanonicalScopeUserRow.metadata)
      ? trustedCanonicalScopeUserRow.metadata
      : null;
    const canonicalInteractionMode = canonicalMetadata?.interaction_mode;
    if (
      isListenOnly
        ? canonicalInteractionMode !== "listen_only"
        : canonicalInteractionMode !== undefined
    ) {
      return NextResponse.json(
        {
          error: "저장된 메시지의 대화 모드가 현재 요청과 일치하지 않습니다.",
          code: "USER_MESSAGE_INTERACTION_MODE_MISMATCH",
          retryable: false,
          retryPolicy: "new_message",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const rawScheduleCareFollowUp =
      canonicalMetadata?.[AMORA_SCHEDULE_CARE_FOLLOW_UP_METADATA_KEY];
    if (rawScheduleCareFollowUp !== undefined) {
      const expectedMetadataKeys = [
        "client_request_id",
        "amora_ingest_contract_version",
        "ai_response_requested",
        "provider_attachment_state",
        "provider_attachment_count",
        AMORA_SCHEDULE_CARE_FOLLOW_UP_METADATA_KEY,
      ].sort();
      const actualMetadataKeys = canonicalMetadata
        ? Object.keys(canonicalMetadata).sort()
        : [];
      const parsedMetadata = parseAmoraScheduleCareFollowUpPrivateMetadata(
        rawScheduleCareFollowUp,
      );
      if (
        typeof bodyUserMessageId !== "string"
        || visibility === "shared"
        || !canonicalMetadata
        || actualMetadataKeys.length !== expectedMetadataKeys.length
        || actualMetadataKeys.some(
          (key, index) => key !== expectedMetadataKeys[index],
        )
        || canonicalMetadata.amora_ingest_contract_version !== 1
        || canonicalMetadata.ai_response_requested !== true
        || canonicalMetadata.provider_attachment_state !== "none"
        || canonicalMetadata.provider_attachment_count !== 0
        || parsedMetadata === null
      ) {
        return scheduleCareFollowUpFailureResponse("invalid_binding");
      }
      scheduleCareFollowUpBinding = {
        cardId: parsedMetadata.card_id,
        cardRevision: parsedMetadata.card_revision,
        sourceRevision: parsedMetadata.source_revision,
      };
      // The canonical prompt is server-authored data, not a user disclosure.
      // Suppress the ordinary early classifier until replay misses and the
      // resolver can authenticate the exact prompt and isolate its suffix.
      earlyCrisisUserText = null;
    }
  }

  const earlySafetyAssessment = earlyCrisisUserText === null
    ? null
    : assessAmoraSafetyText(earlyCrisisUserText);
  const earlyCrisisClassification = earlyCrisisUserText === null
    ? null
    : classifyAmoraCrisis(earlyCrisisUserText);
  // A mediation response is released on the shared lane. Even deterministic
  // crisis guidance would reveal to the partner that the requester disclosed
  // danger. The client can now open a private safety flow from this 422 without
  // putting any content or safety metadata into shared chat.
  if (earlyCrisisClassification && requestKind === "mediation") {
    const durableSafetyFenceConfirmed = isDemo
      ? true
      : await sealMediationPrivateSafetyHold({
        client: getServiceClient(),
        coupleId,
        recipientUserId: actorId,
      });
    return NextResponse.json(
      {
        error:
          "이 내용은 커플 중재로 공유하기 전에 안전 확인과 비공개 지원이 먼저 필요해요.",
        code: durableSafetyFenceConfirmed
          ? "MEDIATION_SAFETY_PREFLIGHT_REQUIRED"
          : "MEDIATION_PRIVATE_SAFETY_HOLD_SEAL_UNAVAILABLE",
        durableSafetyFenceConfirmed,
      },
      {
        status: durableSafetyFenceConfirmed ? 422 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  if (earlyCrisisClassification) {
    const durableSafetyFenceConfirmed = isDemo
      ? true
      : await sealMediationPrivateSafetyHold({
        client: getServiceClient(),
        coupleId,
        recipientUserId: actorId,
      });
    return replayEphemeralCrisisMessage(
      buildAmoraCrisisResponse(earlyCrisisClassification.kind),
      earlyCrisisClassification.kind,
      durableSafetyFenceConfirmed,
    );
  }
  // 중재 요청의 답은 `visibility: "shared"`로 저장된다. 그러니 안전 신호가 있는
  // 중재는 모델에 닿기 전에 여기서 끝나야 한다 — 답의 문구를 안전하게 바꾸는 것만으로는
  // 부족하다. 저장 위치가 그대로면 "파트너가 아모라에게 안전 관련해서 뭔가 물었다"가
  // 통제하는 쪽 화면에 도착하고, 그건 되돌릴 수 없다.
  //
  // 판정이 두 갈래라서 이 문이 거의 비어 있었다. 아래 `earlySafetyAssessment`만 보던
  // 시절, 범위 분류가 안전으로 판정한 문장 12개 중 11개가 이 문을 통과했다.
  // 두 갈래를 여기서 합친다.
  const earlyMediationScope =
    requestKind === "mediation" && earlyCrisisUserText !== null
      ? classifyAmoraQuestionScope({
          userText: earlyCrisisUserText,
          requestKind: "mediation",
        })
      : null;
  if (
    requestKind === "mediation"
    && (
      earlySafetyAssessment?.resolution === "non_immediate_safety"
      || earlySafetyAssessment?.resolution === "immediate_crisis"
      || earlyMediationScope?.scope === "W5_safety_override"
      || (earlyMediationScope?.scope === "W2_high_risk_adjacent"
        && earlyMediationScope.highRiskReason === "safety")
    )
  ) {
    const durableSafetyFenceConfirmed = isDemo
      ? true
      : await sealMediationPrivateSafetyHold({
        client: getServiceClient(),
        coupleId,
        recipientUserId: actorId,
      });
    return NextResponse.json(
      {
        error:
          "이 내용은 커플 중재로 공유하기 전에 안전 확인과 비공개 지원이 먼저 필요해요.",
        code: durableSafetyFenceConfirmed
          ? "MEDIATION_SAFETY_PREFLIGHT_REQUIRED"
          : "MEDIATION_PRIVATE_SAFETY_HOLD_SEAL_UNAVAILABLE",
        durableSafetyFenceConfirmed,
      },
      {
        status: durableSafetyFenceConfirmed ? 422 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  if (!isDemo && requestKind === "chat" && typeof bodyUserMessageId === "string") {
    if (!trustedCanonicalScopeUserRow) {
      return NextResponse.json(
        {
          error: "보낸 메시지와 요청의 연결을 확인하지 못했습니다. 다시 전송해주세요.",
          code: "USER_MESSAGE_SCOPE_MISMATCH",
          retryable: false,
          retryPolicy: "new_message",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const canonicalMetadata = isRecord(trustedCanonicalScopeUserRow.metadata)
      ? trustedCanonicalScopeUserRow.metadata
      : null;
    const canonicalRawRequestId = typeof canonicalMetadata?.client_request_id === "string"
      && CLIENT_REQUEST_ID_RE.test(canonicalMetadata.client_request_id)
      ? canonicalMetadata.client_request_id.toLowerCase()
      : null;
    if (
      canonicalRawRequestId === null
      || canonicalRawRequestId !== rawClientRequestId.toLowerCase()
    ) {
      return NextResponse.json(
        {
          error: "저장된 메시지의 원래 요청 식별자와 일치하지 않습니다. 최신 대화에서 다시 시도해주세요.",
          code: "USER_MESSAGE_REQUEST_BINDING_MISMATCH",
          retryable: false,
          retryPolicy: "new_message",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const hasAnyProviderAttachmentContractField =
      canonicalMetadata?.amora_ingest_contract_version !== undefined
      || canonicalMetadata?.ai_response_requested !== undefined
      || canonicalMetadata?.provider_attachment_state !== undefined
      || canonicalMetadata?.provider_attachment_count !== undefined
      || canonicalMetadata?.provider_attachment_manifest !== undefined;
    if (hasAnyProviderAttachmentContractField) {
      const attachmentVersion = canonicalMetadata?.amora_ingest_contract_version;
      const attachmentState = canonicalMetadata?.provider_attachment_state;
      const attachmentCount = canonicalMetadata?.provider_attachment_count;
      const stateIsValid = attachmentState === "none"
        || attachmentState === "present"
        || attachmentState === "discarded_by_safety_policy";
      const countIsValid = Number.isSafeInteger(attachmentCount)
        && (attachmentCount as number) >= 0
        && (attachmentCount as number) <= AMORA_MAX_ATTACHMENTS;
      const stateMatchesCount = stateIsValid
        && countIsValid
        && (attachmentState === "present"
          ? (attachmentCount as number) > 0
          : attachmentCount === 0);
      const manifest = attachmentVersion === 2 && countIsValid
        ? parseCanonicalProviderAttachmentManifest(
            canonicalMetadata?.provider_attachment_manifest,
            attachmentCount as number,
          )
        : null;
      const versionContractIsValid = attachmentVersion === 1
        ? canonicalMetadata?.provider_attachment_manifest === undefined
        : attachmentVersion === 2
          && attachmentState === "present"
          && manifest !== null;
      let imagePathContractIsValid = true;
      let canonicalImagePaths: string[] = [];
      if (attachmentVersion === 2 && manifest !== null) {
        try {
          const expectedImagePaths = (
            await Promise.all(manifest.map((entry, attachmentIndex) => (
              createChatImageObjectPathV2({
                coupleId,
                senderId: actorId,
                clientRequestId: rawClientRequestId.toLowerCase(),
                attachmentIndex,
                mediaType: entry.mediaType,
                sha256: entry.sha256,
              })
            )))
          ).filter((path): path is string => path !== null);
          const storedImagePaths = canonicalMetadata?.imagePaths === undefined
            ? []
            : canonicalMetadata.imagePaths;
          imagePathContractIsValid = Array.isArray(storedImagePaths)
            && storedImagePaths.length === expectedImagePaths.length
            && storedImagePaths.every((path, index) => path === expectedImagePaths[index]);
          if (imagePathContractIsValid) {
            canonicalImagePaths = [...(storedImagePaths as string[])];
          }
        } catch {
          imagePathContractIsValid = false;
        }
      }
      if (
        !versionContractIsValid
        || canonicalMetadata?.ai_response_requested !== true
        || !stateMatchesCount
        || !imagePathContractIsValid
      ) {
        return NextResponse.json(
          {
            error: "저장된 질문의 첨부 계약을 안전하게 확인하지 못했습니다. 새 메시지로 다시 보내주세요.",
            code: "USER_MESSAGE_ATTACHMENT_CONTRACT_INVALID",
            retryable: false,
            retryPolicy: "new_message",
          },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
      canonicalProviderAttachmentContract = {
        version: attachmentVersion as 1 | 2,
        state: attachmentState as CanonicalProviderAttachmentContract["state"],
        count: attachmentCount as number,
        manifest,
        imagePaths: canonicalImagePaths,
      };
    }

  }

  const replayPersistedWithApplicationValidation = async (
    message: PersistedAiMessage,
    expectedReplayPrivacyEpoch: number,
  ): Promise<Response> => {
    const receiptRequiresStrictFirstUse =
      requiresStrictAmoraFirstUseApplicationReplay(message.metadata);
    const receiptRequiresStrictProviderBacked =
      requiresStrictAmoraProviderBackedAddActionApplicationReplay(
        message.metadata,
      );
    const confirmationMetadata = isRecord(trustedCanonicalScopeUserRow?.metadata)
      ? trustedCanonicalScopeUserRow.metadata
      : null;
    const canonicalApplicationRequest =
      requestKind === "chat"
      && visibility === "shared"
      && typeof bodyUserMessageId === "string"
      && typeof bodyConfirmedActionId === "string"
      && trustedCanonicalScopeUserRow
      && trustedCanonicalScopeUserRow.id === bodyUserMessageId
      && trustedCanonicalScopeUserRow.content
        === AMORA_FIRST_USE_ACTION_APPLICATION_CONFIRMATION
      && confirmationMetadata?.confirmed_amora_action_id
        === bodyConfirmedActionId
      && (canonicalProviderAttachmentContract?.count ?? 0) === 0
        ? {
            confirmationRow: trustedCanonicalScopeUserRow,
            confirmationMessageId: bodyUserMessageId,
            confirmedActionId: bodyConfirmedActionId,
          }
        : null;
    if (
      !receiptRequiresStrictFirstUse
      && !receiptRequiresStrictProviderBacked
      && !canonicalApplicationRequest
    ) {
      return replayPersistedWithMemoryReconciliation(
        message,
        expectedReplayPrivacyEpoch,
      );
    }
    if (!canonicalApplicationRequest) {
      const replayCode = receiptRequiresStrictProviderBacked
        && !receiptRequiresStrictFirstUse
          ? "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_REPLAY_INVALID"
          : "AMORA_FIRST_USE_ACTION_APPLICATION_REPLAY_INVALID";
      return NextResponse.json(
        {
          error: "저장된 행동 카드 결과의 요청 연결을 안전하게 확인하지 못했어요.",
          code: replayCode,
          retryable: false,
          retryPolicy: "new_message",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    const sourceLookup = await supabase
      .from("chat_messages")
      .select("id, content, sender_id, sender_type, role, metadata, visibility, created_at")
      .eq("couple_id", coupleId)
      .eq("visibility", "shared")
      .eq("sender_type", "ai")
      .eq("role", "assistant")
      .is("sender_id", null)
      .eq(
        "metadata->pending_amora_action->>actionId",
        canonicalApplicationRequest.confirmedActionId,
      )
      .or("metadata->>target.is.null,metadata->>target.neq.partner")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(2);
    if (sourceLookup.error || !Array.isArray(sourceLookup.data)) {
      const replayCode = receiptRequiresStrictProviderBacked
        && !receiptRequiresStrictFirstUse
          ? "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_REPLAY_UNAVAILABLE"
          : "AMORA_FIRST_USE_ACTION_APPLICATION_REPLAY_UNAVAILABLE";
      return NextResponse.json(
        {
          error: "저장된 행동 카드의 원래 제안을 확인하지 못했어요.",
          code: replayCode,
          retryable: true,
          retryPolicy: "same_request",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const currentCreatedAt =
      typeof canonicalApplicationRequest.confirmationRow.created_at === "string"
      ? canonicalApplicationRequest.confirmationRow.created_at
      : null;
    const sourceCandidates = (sourceLookup.data as Array<Record<string, unknown>>)
      .filter((row) => {
        const rowMetadata = isRecord(row.metadata) ? row.metadata : null;
        const storedPendingAction = isRecord(rowMetadata?.pending_amora_action)
          ? rowMetadata.pending_amora_action
          : null;
        return row.visibility === "shared"
          && row.role === "assistant"
          && row.sender_type === "ai"
          && row.sender_id === null
          && rowMetadata?.target !== "partner"
          && storedPendingAction?.actionId
            === canonicalApplicationRequest.confirmedActionId
          && typeof row.created_at === "string"
          && (
            currentCreatedAt === null
            || row.created_at < currentCreatedAt
            || (
              row.created_at === currentCreatedAt
              && typeof row.id === "string"
              && row.id < canonicalApplicationRequest.confirmationMessageId
            )
          );
      });
    const sourceRow = sourceCandidates.length === 1
      ? sourceCandidates[0]
      : null;
    const sourceMetadata = sourceRow && isRecord(sourceRow.metadata)
      ? sourceRow.metadata
      : null;
    const sourceRevision = sourceMetadata?.amora_wedding_context_revision;
    const sourceRequiresStrictFirstUse = sourceCandidates.some((row) => {
      const rowMetadata = isRecord(row.metadata) ? row.metadata : null;
      return rowMetadata?.response_origin
          === "server_authoritative_first_use_promotion"
        || typeof rowMetadata?.amora_first_use_promotion_id === "string";
    });
    const sourceRequiresStrictProviderBacked = sourceCandidates.some((row) => {
      const rowMetadata = isRecord(row.metadata) ? row.metadata : null;
      return rowMetadata?.[AMORA_ADD_ACTION_PROPOSAL_ORIGIN_METADATA_KEY]
        === AMORA_ADD_ACTION_PROPOSAL_ORIGIN;
    });
    const firstUseApplicationSource = sourceRow
      && sourceRow.role === "assistant"
      && sourceRow.sender_type === "ai"
      && sourceRow.sender_id === null
      && typeof sourceRow.id === "string"
      && typeof sourceRow.content === "string"
      && typeof sourceRow.created_at === "string"
      && typeof sourceRevision === "number"
      && Number.isSafeInteger(sourceRevision)
      && sourceRevision >= 0
        ? parseAmoraFirstUseActionApplicationSource({
            sourceMessage: {
              id: sourceRow.id,
              content: sourceRow.content,
              metadata: sourceRow.metadata,
              createdAt: sourceRow.created_at,
            },
            confirmedActionId: canonicalApplicationRequest.confirmedActionId,
            availableTools: PENDING_ACTION_TOOLS,
            expectedJourneyRevision: sourceRevision,
            expectedCriterionDecisionId: undefined,
            now: Date.now(),
            allowExpired: true,
          })
        : null;
    const providerBackedApplicationSource = sourceRow
      && sourceRow.role === "assistant"
      && sourceRow.sender_type === "ai"
      && sourceRow.sender_id === null
      && typeof sourceRow.id === "string"
      && typeof sourceRow.content === "string"
      && typeof sourceRow.created_at === "string"
      && typeof sourceRevision === "number"
      && Number.isSafeInteger(sourceRevision)
      && sourceRevision >= 0
        ? parseAmoraProviderBackedAddActionApplicationSource({
            sourceMessage: {
              id: sourceRow.id,
              content: sourceRow.content,
              metadata: sourceRow.metadata,
              createdAt: sourceRow.created_at,
            },
            confirmedActionId: canonicalApplicationRequest.confirmedActionId,
            availableTools: PENDING_ACTION_TOOLS,
            expectedJourneyRevision: sourceRevision,
            now: Date.now(),
            allowExpired: true,
          })
        : null;
    if (
      !firstUseApplicationSource
      && !providerBackedApplicationSource
      && !receiptRequiresStrictFirstUse
      && !receiptRequiresStrictProviderBacked
      && !sourceRequiresStrictFirstUse
      && !sourceRequiresStrictProviderBacked
    ) {
      return replayPersistedWithMemoryReconciliation(
        message,
        expectedReplayPrivacyEpoch,
      );
    }
    const parsedMessage = firstUseApplicationSource
      ? parsePersistedAmoraFirstUseDeterministicApplication({
          message,
          expectedChatRequestKey: clientRequestId,
          expectedVisibleRequestKey: visibleClientRequestKey,
          expectedConfirmationMessageId:
            canonicalApplicationRequest.confirmationMessageId,
          expectedPendingAction: firstUseApplicationSource.pendingAction,
          expectedJourneyRevision: firstUseApplicationSource.journeyRevision,
          expectedPromotionId: firstUseApplicationSource.promotionId,
        })
      : providerBackedApplicationSource
        ? parsePersistedAmoraProviderBackedAddActionApplication({
            message,
            expectedChatRequestKey: clientRequestId,
            expectedVisibleRequestKey: visibleClientRequestKey,
            expectedConfirmationMessageId:
              canonicalApplicationRequest.confirmationMessageId,
            expectedSourceMessageId:
              providerBackedApplicationSource.sourceProposalMessageId,
            expectedPendingAction:
              providerBackedApplicationSource.pendingAction,
            expectedJourneyRevision:
              providerBackedApplicationSource.journeyRevision,
            expectedCoupleId: coupleId,
          })
        : null;
    if (!parsedMessage) {
      const providerBackedStrictFailure =
        receiptRequiresStrictProviderBacked
        || sourceRequiresStrictProviderBacked;
      return NextResponse.json(
        {
          error: "저장된 행동 카드 결과를 안전하게 확인하지 못했어요.",
          code: providerBackedStrictFailure
            ? "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_REPLAY_INVALID"
            : "AMORA_FIRST_USE_ACTION_APPLICATION_REPLAY_INVALID",
          retryable: false,
          retryPolicy: "new_message",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return replayPersistedWithMemoryReconciliation(
      parsedMessage,
      expectedReplayPrivacyEpoch,
    );
  };

  // Exact durable retries are recovery reads, not new turns. Once identity,
  // couple ownership, visibility, request/user binding, and the early crisis
  // override are established, recover the committed answer before ordinary
  // rate limiting or parsing a resent attachment. A retry must not be blocked
  // by a later 429 or by a damaged duplicate of an attachment that was already
  // handled by the original request.
  const hasTrustedReplayBinding =
    requestKind !== "chat"
    || typeof bodyUserMessageId !== "string"
    || trustedCanonicalScopeUserRow !== null;
  if (!isDemo && hasTrustedReplayBinding) {
    try {
      // Validate the authenticated actor's current roster/private scope before
      // the admin-backed persisted-message lookup. The same epoch is checked
      // again immediately before any persisted payload is returned.
      const replayPrivacyEpoch = await getAmoraPrivacyEpoch(
        dataCoupleId,
        visibility,
        supabase,
      );
      const existing = await findPersistedAiMessage({
        coupleId,
        clientRequestId,
        visibility,
      });
      if (existing?.id) {
        if (scheduleCareFollowUpBinding) {
          const persistedMetadata = isRecord(existing.metadata)
            ? existing.metadata
            : null;
          const persistedBinding = parseAmoraScheduleCareFollowUpPrivateMetadata(
            persistedMetadata?.[AMORA_SCHEDULE_CARE_FOLLOW_UP_METADATA_KEY],
          );
          if (
            persistedBinding === null
            || persistedBinding.card_id !== scheduleCareFollowUpBinding.cardId
            || persistedBinding.card_revision
              !== scheduleCareFollowUpBinding.cardRevision
            || persistedBinding.source_revision
              !== scheduleCareFollowUpBinding.sourceRevision
          ) {
            return NextResponse.json(
              {
                error: "저장된 상견례 답변의 연결 정보를 안전하게 확인하지 못했어요.",
                code: "CHAT_REPLAY_INCONSISTENT",
                retryable: false,
                retryPolicy: "new_message",
              },
              { status: 503, headers: { "Cache-Control": "no-store" } },
            );
          }
        }
        const reconciled = await reconcileChatRequest({
          coupleId,
          requestKey: clientRequestId,
          userId: actorId,
          visibility,
          messageId: existing.id,
        });
        if (!reconciled) {
          throw new ChatRequestClaimError(
            "Persisted response has no durable claim to reconcile",
          );
        }
        return await replayPersistedWithApplicationValidation(
          existing,
          replayPrivacyEpoch,
        );
      }
    } catch (error) {
      console.error("[chat] completed-request reconciliation failed", error);
      const privacyCode = getAmoraPrivacyContextErrorCode(error);
      return NextResponse.json(
        {
          error: "저장된 답변을 안전하게 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
          code: privacyCode ?? "CHAT_REPLAY_RECONCILIATION_FAILED",
          retryable: false,
          retryPolicy: "new_message",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  if (canonicalProviderAttachmentContract) {
    if (
      canonicalProviderAttachmentContract.version === 1
      && canonicalProviderAttachmentContract.state === "present"
    ) {
      return NextResponse.json(
        {
          error: "이 질문은 첨부파일의 정확한 바이트 결합 전에 저장됐습니다. 파일을 다시 첨부해 새 메시지로 보내주세요.",
          code: "USER_MESSAGE_ATTACHMENT_BINDING_MISMATCH",
          retryable: false,
          retryPolicy: "new_message",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const suppliedAttachmentCount = Array.isArray(attachmentInput)
      ? attachmentInput.length
      : -1;
    if (suppliedAttachmentCount !== canonicalProviderAttachmentContract.count) {
      return NextResponse.json(
        {
          error: canonicalProviderAttachmentContract.state === "present"
            ? "이 질문에는 원래 첨부한 파일이 필요합니다. 파일을 다시 첨부해 새 메시지로 보내주세요."
            : "저장된 질문과 현재 첨부 상태가 일치하지 않습니다. 새 메시지로 다시 보내주세요.",
          code: "USER_MESSAGE_ATTACHMENT_BINDING_MISMATCH",
          retryable: false,
          retryPolicy: "new_message",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  // No exact completion exists, so the private capability must still resolve
  // against the current roster/privacy/journey/card/signal/candidate state
  // before the ordinary limiter, claim, provider cost, tools, or persistence.
  if (
    scheduleCareFollowUpBinding !== null
    && trustedCanonicalScopeUserRow !== null
  ) {
    const resolution = await resolveAmoraScheduleCareFollowUp({
      client: supabase,
      recipientUserId: actorId,
      coupleId,
      binding: scheduleCareFollowUpBinding,
    });
    if (!resolution.ok) {
      return scheduleCareFollowUpFailureResponse(resolution.reason);
    }
    const resolved = resolution.value;
    const actorRole = userProfile.role;
    if (
      resolved.recipientUserId !== actorId
      || resolved.coupleId !== coupleId
      || (actorRole !== "bride" && actorRole !== "groom")
      || resolved.actorRole !== actorRole
      || resolved.momentType !== "sanggyeonrye"
      || resolved.attentionWindow !== "dAfter"
      || resolved.binding.cardId !== scheduleCareFollowUpBinding.cardId
      || resolved.binding.cardRevision
        !== scheduleCareFollowUpBinding.cardRevision
      || resolved.binding.sourceRevision
        !== scheduleCareFollowUpBinding.sourceRevision
      || !Number.isSafeInteger(resolved.privacyEpoch)
      || resolved.privacyEpoch < 1
    ) {
      return scheduleCareFollowUpFailureResponse("scope_changed");
    }
    const canonicalContent = trustedCanonicalScopeUserRow.content;
    const answer = typeof canonicalContent === "string"
      ? splitAmoraScheduleCareFollowUpAnswer(
          canonicalContent,
          resolved.prompt,
        )
      : null;
    if (answer === null) {
      return scheduleCareFollowUpFailureResponse("moment_stale");
    }
    resolvedScheduleCareFollowUp = resolved;
    scheduleCareFollowUpAnswer = answer;
    earlyCrisisUserText = answer;

    // The general early classifier intentionally skipped the canonical prompt.
    // Re-run the same fixed crisis boundary now on the authenticated suffix.
    const scheduleCareCrisis = classifyAmoraCrisis(answer);
    if (scheduleCareCrisis) {
      const durableSafetyFenceConfirmed = await sealMediationPrivateSafetyHold({
        client: getServiceClient(),
        coupleId,
        recipientUserId: actorId,
      });
      return replayEphemeralCrisisMessage(
        buildAmoraCrisisResponse(scheduleCareCrisis.kind),
        scheduleCareCrisis.kind,
        durableSafetyFenceConfirmed,
      );
    }
  }

  const preliminaryQuestionScope = requestKind === "initial_greeting"
    ? classifyAmoraQuestionScope({
        userText: "[INITIAL_GREETING]",
        requestKind,
      })
    : requestKind === "mediation"
      ? classifyAmoraQuestionScope({
          userText: String(conflictContext).trim(),
          requestKind,
        })
      : trustedCanonicalScopeUserRow && earlyCrisisUserText !== null
        ? classifyAmoraQuestionScope({ userText: earlyCrisisUserText })
        : null;
  const shouldAttemptBoundedContinuity =
    !isDemo
    && requestKind === "chat"
    && !isListenOnly
    && resolvedScheduleCareFollowUp === null
    && bodyConfirmedActionId === undefined
    && typeof bodyUserMessageId === "string"
    && trustedCanonicalScopeUserRow !== null
    && earlyCrisisUserText !== null
    && canAttemptAmoraBoundedContinuity(earlyCrisisUserText)
    && isUuid(trustedCanonicalScopeUserRow.segment_id);
  const boundedCanonicalSegmentId = shouldAttemptBoundedContinuity
    ? trustedCanonicalScopeUserRow?.segment_id as string
    : null;
  let shouldLoadBoundedContinuity = false;
  let boundedContinuitySegmentId: string | null = null;
  const skipsIrrelevantProviderContextReads =
    bodyConfirmedActionId === undefined
    && (
      isListenOnly
      || resolvedScheduleCareFollowUp !== null
      || requestKind === "initial_greeting"
      || requestKind === "mediation"
      || shouldAttemptBoundedContinuity
      || (
        requestKind === "chat"
        && trustedCanonicalScopeUserRow !== null
        && preliminaryQuestionScope !== null
        && (
          preliminaryQuestionScope.scope === "W2_high_risk_adjacent"
          || preliminaryQuestionScope.scope === "W3_social_care"
          || preliminaryQuestionScope.scope === "W4_out_of_scope"
        )
      )
    );

  const limited = await checkRateLimitPersistent(
    evalLimit
      ? evalLimit.key
      : isDemo
      ? rateLimitKey("chat-demo", request)
      : rateLimitKey("chat", request, actorId),
    {
      maxRequests: evalLimit?.maxRequests ?? 60,
      windowMs: evalLimit ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000,
    },
    { failClosed: true },
  );
  if (limited) return limited;

  let validatedAttachments: ValidatedAmoraAttachment[];
  try {
    validatedAttachments = validateAmoraAttachments(attachmentInput);
  } catch (error) {
    if (error instanceof AmoraAttachmentValidationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }

  if (
    !isDemo
    && validatedAttachments.length > 0
    && (
      canonicalProviderAttachmentContract?.version !== 2
      || canonicalProviderAttachmentContract.manifest === null
      || !matchesCanonicalProviderAttachmentManifest(
          validatedAttachments,
          canonicalProviderAttachmentContract.manifest,
        )
    )
  ) {
    return NextResponse.json(
      {
        error: "저장된 질문과 현재 첨부파일의 정확한 내용이 일치하지 않습니다. 파일을 다시 첨부해 새 메시지로 보내주세요.",
        code: "USER_MESSAGE_ATTACHMENT_BINDING_MISMATCH",
        retryable: false,
        retryPolicy: "new_message",
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (
    !isDemo
    && canonicalProviderAttachmentContract?.version === 2
    && canonicalProviderAttachmentContract.manifest !== null
  ) {
    const imageStorage = getServiceClient().storage.from("chat-image");
    const storageBinding = await verifyChatImageObjectBindings({
      coupleId,
      senderId: actorId,
      clientRequestId: rawClientRequestId.toLowerCase(),
      manifest: canonicalProviderAttachmentContract.manifest,
      imagePaths: canonicalProviderAttachmentContract.imagePaths,
      readObject: async (path, expected) => {
        try {
          const { data: info, error: infoError } = await imageStorage.info(path);
          if (infoError || !info) {
            return {
              ok: false,
              reason: isMissingChatImageObjectError(infoError)
                ? "missing"
                : "unavailable",
            } as const;
          }
          if (
            info.size !== expected.byteLength
            || info.contentType !== expected.mediaType
          ) {
            return { ok: false, reason: "mismatch" } as const;
          }
          const { data: stream, error: downloadError } = await imageStorage
            .download(path)
            .asStream();
          if (downloadError || !stream) {
            return {
              ok: false,
              reason: isMissingChatImageObjectError(downloadError)
                ? "missing"
                : "unavailable",
            } as const;
          }
          return {
            ok: true,
            stream,
            byteLength: info.size,
            mediaType: info.contentType,
          } as const;
        } catch {
          return { ok: false, reason: "unavailable" } as const;
        }
      },
    });
    if (!storageBinding.ok && storageBinding.reason === "object_unavailable") {
      return NextResponse.json(
        {
          error: "첨부 이미지를 안전하게 다시 확인하지 못했습니다. 잠시 후 같은 요청으로 다시 시도해 주세요.",
          code: "USER_MESSAGE_ATTACHMENT_STORAGE_UNAVAILABLE",
          retryable: true,
          retryPolicy: "same_request",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!storageBinding.ok) {
      return NextResponse.json(
        {
          error: "저장된 첨부 이미지가 분석할 파일과 일치하지 않습니다. 새 메시지로 다시 첨부해 주세요.",
          code: "USER_MESSAGE_ATTACHMENT_STORAGE_BINDING_MISMATCH",
          retryable: false,
          retryPolicy: "new_message",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  let processedAttachments: ProcessedAttachment;
  try {
    processedAttachments = await processAttachments(validatedAttachments);
  } catch (error) {
    if (error instanceof AmoraAttachmentProcessingError) {
      const unsafeArchive = error.code === "UNSAFE_DOCX_ARCHIVE";
      const textTooLarge = error.code === "DOCX_TEXT_TOO_LARGE";
      return NextResponse.json(
        {
          error: textTooLarge
            ? "첨부한 Word 문서의 텍스트가 너무 길어 안전하게 읽지 못했어요. 필요한 부분만 남기거나 PDF로 나눠서 첨부해주세요."
            : unsafeArchive
              ? "첨부한 Word 파일의 내부 구조가 너무 크거나 안전하지 않아 열지 않았어요. Word에서 새 DOCX로 다시 저장하거나 PDF로 첨부해주세요."
              : "첨부한 Word 파일을 읽지 못했어요. DOCX 파일을 다시 저장한 뒤 첨부해주세요.",
          code: error.code,
        },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }

  const claimParams = {
    coupleId,
    requestKey: clientRequestId,
    userId: actorId,
    visibility,
    ...(requestKind === "chat" && typeof bodyUserMessageId === "string"
      ? { userMessageId: bodyUserMessageId }
      : {}),
  } as const;
  let requestClaimAcquired = false;
  let requestClaimAttemptCount: number | null = null;
  let durableToolRoundJournal: AmoraToolRoundCheckpoint[] = [];

  if (!isDemo) {
    try {
      const claim = await claimChatRequest(claimParams);
      if (claim.action === "completed") {
        const replayPrivacyEpoch = await getAmoraPrivacyEpoch(
          dataCoupleId,
          visibility,
          supabase,
        );
        const completed = await findPersistedAiMessage({
          coupleId,
          clientRequestId,
          visibility,
        });
        if (completed?.id === claim.messageId) {
          return await replayPersistedWithApplicationValidation(
            completed,
            replayPrivacyEpoch,
          );
        }
        return NextResponse.json(
          {
            error: "저장된 답변을 확인하지 못했습니다.",
            code: "CHAT_REPLAY_INCONSISTENT",
            retryable: false,
            retryPolicy: "new_message",
          },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
      if (claim.action === "in_progress") {
        return NextResponse.json(
          {
            error: "같은 답변을 아직 만들고 있어요. 잠시 후 다시 확인해주세요.",
            code: "CHAT_REQUEST_IN_PROGRESS",
            retryAfterMs: claim.retryAfterMs,
            retryable: true,
            retryPolicy: "same_request",
          },
          {
            status: 409,
            headers: {
              "Cache-Control": "no-store",
              "Retry-After": String(Math.max(1, Math.ceil(claim.retryAfterMs / 1000))),
            },
          },
        );
      }
      if (claim.action === "conflict") {
        return NextResponse.json(
          {
            error: "요청 식별자가 다른 대화와 충돌했습니다.",
            code: "CHAT_REQUEST_CONFLICT",
            retryable: false,
            retryPolicy: "new_message",
          },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
      requestClaimAcquired = true;
      requestClaimAttemptCount = claim.attemptCount;
      durableToolRoundJournal = await loadAmoraToolRoundJournal({
        coupleId,
        requestKey: clientRequestId,
        attemptCount: claim.attemptCount,
      });
    } catch (error) {
      console.error("[chat] durable request claim failed", error);
      if (requestClaimAcquired) {
        await failChatRequest({
          ...claimParams,
          failureCode: "CHAT_TURN_JOURNAL_UNAVAILABLE",
        }).catch((claimError) => {
          console.error("[chat] journal failure marker failed", claimError);
        });
        requestClaimAcquired = false;
        requestClaimAttemptCount = null;
      }
      const privacyCode = getAmoraPrivacyContextErrorCode(error);
      return NextResponse.json(
        {
          error: "대화를 안전하게 시작하지 못했습니다. 잠시 후 다시 시도해주세요.",
          code: privacyCode ?? "CHAT_REQUEST_CLAIM_FAILED",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const releaseClaimBeforeStream = async (failureCode: string) => {
    if (!requestClaimAcquired) return;
    await failChatRequest({ ...claimParams, failureCode }).catch((error) => {
      console.error("[chat] pre-stream claim release failed", error);
    });
    requestClaimAcquired = false;
    requestClaimAttemptCount = null;
  };

  let memberModelVersion: 1 | 2 = 1;
  if (
    !isDemo
    && process.env.AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED === "true"
  ) {
    try {
      const memberModelResult = await supabase
        .from("couples")
        .select("member_model_version")
        .eq("id", dataCoupleId)
        .maybeSingle();
      const rawMemberModelVersion = isRecord(memberModelResult.data)
        ? memberModelResult.data.member_model_version
        : null;
      if (
        memberModelResult.error
        || (rawMemberModelVersion !== 1 && rawMemberModelVersion !== 2)
      ) {
        throw new Error("invalid member model result");
      }
      memberModelVersion = rawMemberModelVersion;
    } catch (error) {
      console.error("[chat] member model lookup failed", error);
      await releaseClaimBeforeStream("AMORA_MEMBER_MODEL_UNAVAILABLE");
      return NextResponse.json(
        {
          error: "현재 준비 공간의 구성 방식을 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
          code: "AMORA_MEMBER_MODEL_UNAVAILABLE",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  const usesNeutralMemberPresentation = memberModelVersion === 2;

  const { visionAttachments, textAttachments } = processedAttachments;

  // Consent must be resolved before any auxiliary-memory read. Disabled
  // scopes do not query factual summaries or profile source nodes at all.
  const requestedMemoryVisibilities = visibility === "shared"
    ? ["shared"] as const
    : ["shared", visibility] as const;
  let initialPrivacyContextSnapshot: AmoraPrivacyContextSnapshot | null = null;
  let mediationDraftPrivacyContextSnapshot: AmoraPrivacyContextSnapshot | null = null;
  let initialPrivacyEpoch: number | null = null;
  if (!isDemo) {
    try {
      if (!skipsIrrelevantProviderContextReads) {
        initialPrivacyContextSnapshot = await getAmoraPrivacyContextSnapshot(
          dataCoupleId,
          requestedMemoryVisibilities,
          supabase,
        );
        initialPrivacyEpoch = initialPrivacyContextSnapshot.privacyEpoch;
      } else if (requestKind === "mediation") {
        // Mediation still skips memories, summaries, and personalization
        // inputs. It only needs the authenticated actor/roster snapshot that
        // seals the private draft against a later membership change.
        mediationDraftPrivacyContextSnapshot = await getAmoraPrivacyContextSnapshot(
          dataCoupleId,
          [visibility],
          supabase,
        );
        initialPrivacyEpoch = mediationDraftPrivacyContextSnapshot.privacyEpoch;
      } else {
        // Current-input-only scopes deliberately skip all auxiliary context,
        // but their durable response still needs an actor/roster epoch fence.
        initialPrivacyEpoch = await getAmoraPrivacyEpoch(
          dataCoupleId,
          visibility,
          supabase,
        );
      }
    } catch (error) {
      const code =
        getAmoraPrivacyContextErrorCode(error)
        ?? "AMORA_PRIVACY_CONTEXT_UNAVAILABLE";
      console.error("[chat] privacy context snapshot unavailable", code);
      await releaseClaimBeforeStream(code);
      return NextResponse.json(
        {
          error:
            "개인정보 설정을 안전하게 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
          code,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  if (
    resolvedScheduleCareFollowUp !== null
    && initialPrivacyEpoch !== resolvedScheduleCareFollowUp.privacyEpoch
  ) {
    await releaseClaimBeforeStream("AMORA_SCHEDULE_CARE_FOLLOW_UP_SCOPE_CHANGED");
    return scheduleCareFollowUpFailureResponse("scope_changed");
  }
  const memoryEnablement = initialPrivacyContextSnapshot?.memory ?? {
    shared: { enabled: false, resetAt: null },
    bride_private: { enabled: false, resetAt: null },
    groom_private: { enabled: false, resetAt: null },
  };
  const enabledMemoryVisibilities = requestedMemoryVisibilities.filter(
    (candidate) => memoryEnablement[candidate].enabled,
  );
  const memoryEnabledForTurn = memoryEnablement[visibility].enabled;
  const sharedMemoryEnabledForTurn = memoryEnablement.shared.enabled;
  const assertPrivacyContextStillCurrent = async () => {
    if (isDemo) return;
    if (initialPrivacyEpoch === null) {
      throw new AmoraPrivacyContextError("AMORA_PRIVACY_CONTEXT_UNAVAILABLE");
    }
    if (initialPrivacyContextSnapshot) {
      const currentSnapshot = await getAmoraPrivacyContextSnapshot(
        dataCoupleId,
        requestedMemoryVisibilities,
        supabase,
      );
      assertAmoraPrivacyContextSnapshotCurrent(
        initialPrivacyContextSnapshot,
        currentSnapshot,
        requestedMemoryVisibilities,
      );
      return;
    }
    if (mediationDraftPrivacyContextSnapshot) {
      const currentSnapshot = await getAmoraPrivacyContextSnapshot(
        dataCoupleId,
        [visibility],
        supabase,
      );
      assertAmoraPrivacyContextSnapshotCurrent(
        mediationDraftPrivacyContextSnapshot,
        currentSnapshot,
        [visibility],
      );
      return;
    }
    const currentEpoch = await getAmoraPrivacyEpoch(
      dataCoupleId,
      visibility,
      supabase,
    );
    if (currentEpoch !== initialPrivacyEpoch) {
      throw new AmoraPrivacyContextError("AMORA_PRIVACY_CONTEXT_CHANGED");
    }
  };

  // 병렬로 커플 관련 데이터 전체 조회
  const conversationSegmentReadEnabled =
    !isDemo
    && !skipsIrrelevantProviderContextReads
    && isAmoraConversationSegmentReadEnabled(
      process.env.AMORA_CONVERSATION_SEGMENT_READ_ENABLED,
    );
  let activeConversationSegmentId: string | null = null;
  if (conversationSegmentReadEnabled) {
    try {
      const activeSegmentResult = await supabase
        .from("conversation_segments")
        .select("id")
        .eq("couple_id", dataCoupleId)
        .eq("visibility", visibility)
        .eq("status", "active")
        .maybeSingle();
      const candidateId = isRecord(activeSegmentResult.data)
        ? activeSegmentResult.data.id
        : null;
      if (activeSegmentResult.error || !isUuid(candidateId)) {
        console.error("[chat] active conversation segment unavailable", {
          providerCode: activeSegmentResult.error?.code ?? null,
          visibility,
        });
        await releaseClaimBeforeStream("CONVERSATION_SEGMENT_UNAVAILABLE");
        return NextResponse.json(
          {
            error: "현재 대화 구간을 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
            code: "CONVERSATION_SEGMENT_UNAVAILABLE",
          },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
      activeConversationSegmentId = candidateId;
    } catch (error) {
      console.error("[chat] active conversation segment lookup failed", error);
      await releaseClaimBeforeStream("CONVERSATION_SEGMENT_UNAVAILABLE");
      return NextResponse.json(
        {
          error: "현재 대화 구간을 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
          code: "CONVERSATION_SEGMENT_UNAVAILABLE",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  // Current-input-only scopes normally skip all broad stored context, including
  // the feature-flagged segment read above. A narrow continuity request is the
  // sole exception:
  // prove that its canonical current row belongs to the server's active
  // segment before reading the exact three-row exchange. Missing, closed, or
  // mismatched proof safely degrades to the current message only.
  if (shouldAttemptBoundedContinuity) {
    try {
      const activeBoundedSegmentResult = await supabase
        .from("conversation_segments")
        .select("id, status")
        .eq("couple_id", dataCoupleId)
        .eq("visibility", visibility)
        .eq("status", "active")
        .maybeSingle();
      const activeBoundedSegmentId = isRecord(activeBoundedSegmentResult.data)
        ? activeBoundedSegmentResult.data.id
        : null;
      const activeBoundedSegmentStatus = isRecord(activeBoundedSegmentResult.data)
        ? activeBoundedSegmentResult.data.status
        : null;
      if (
        !activeBoundedSegmentResult.error
        && isUuid(activeBoundedSegmentId)
        && activeBoundedSegmentStatus === "active"
        && activeBoundedSegmentId === boundedCanonicalSegmentId
      ) {
        boundedContinuitySegmentId = activeBoundedSegmentId;
        shouldLoadBoundedContinuity = true;
      } else {
        console.warn("[chat] bounded continuity active segment proof unavailable", {
          reason: activeBoundedSegmentResult.error
            ? "lookup_error"
            : activeBoundedSegmentStatus !== "active"
              ? "not_active"
              : activeBoundedSegmentId !== boundedCanonicalSegmentId
                ? "segment_mismatch"
                : "invalid_result",
          visibility,
        });
      }
    } catch {
      console.warn("[chat] bounded continuity active segment lookup failed", {
        visibility,
      });
    }
  }

  const [
    journeyResult,
    profilesResult,
    summariesResult,
    decisionsResult,
    messagesResult,
    profileNodesResult,
    personalizationResult,
  ] = await Promise.all([
    // 1. 웨딩 저니
    skipsIrrelevantProviderContextReads
      ? Promise.resolve({ data: null, error: null })
      : supabase.from("wedding_journeys").select("*").eq("couple_id", dataCoupleId).single(),
    // 2. 커플 프로필 (신부/신랑 이름, 역할)
    skipsIrrelevantProviderContextReads
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("couple_profile_directory")
          .select("id, name, role")
          .eq("couple_id", dataCoupleId),
    // 3. 대화 요약 (최근 3개) — visibility 격리 (2026-05-04)
    //    shared turn → shared summary만 / private turn → shared + 본인 visibility
    enabledMemoryVisibilities.length === 0
      ? Promise.resolve({ data: [], error: null })
      : (() => {
      const summaryContextColumns: string = conversationSegmentReadEnabled
        ? "summary, summary_type, visibility, segment_id, created_at, message_count, to_message_id"
        : "summary, summary_type, visibility, created_at, message_count, to_message_id";
      let q = supabase.from("chat_summaries")
        .select(summaryContextColumns)
        .eq("couple_id", dataCoupleId)
        // Keep legacy rows whose summary_type is NULL while excluding the
        // non-factual rows written only to advance the durable-memory cursor.
        .or("summary_type.is.null,summary_type.neq.cursor")
        .order("created_at", { ascending: false })
        .limit(6);
      if (conversationSegmentReadEnabled) {
        q = q.eq("segment_id", activeConversationSegmentId);
      }
      return enabledMemoryVisibilities.length === 1
        ? q.eq("visibility", enabledMemoryVisibilities[0])
        : q.in("visibility", enabledMemoryVisibilities);
    })(),
    // 4. Memory Step C: 의사결정 히스토리 (최근 50개, 사용자가 확인한 결정 포함)
    //    사용자가 동의한 범위의 활성 기억과 명시적 제품 결정만 사용한다.
    //    RLS가 visibility 자동 필터: 본인 private + shared만 SELECT 됨. 파트너 private은 안 옴.
    skipsIrrelevantProviderContextReads
      ? Promise.resolve({ data: [], error: null })
      : supabase.from("decision_nodes")
          .select("id, couple_id, category, decision_type, title, chosen_value, reasoning, confidence, stage_tag, source, visibility, source_actor_role, created_at, memory_key, superseded_at, metadata")
          .eq("couple_id", dataCoupleId)
          .order("created_at", { ascending: false })
          .limit(50),
    // 5. canonical 대화 컨텍스트. 클라이언트가 보낸 assistant/history는
    // prompt source로 신뢰하지 않으며 사용자 RLS를 한 번 더 적용한다.
    skipsIrrelevantProviderContextReads && !shouldLoadBoundedContinuity
      ? Promise.resolve({
          data:
            requestKind === "chat" && trustedCanonicalScopeUserRow
              ? [trustedCanonicalScopeUserRow]
              : [],
          error: null,
        })
      : (() => {
      const messageContextColumns: string =
        conversationSegmentReadEnabled || shouldLoadBoundedContinuity
        ? "id, sender_id, sender_type, role, content, metadata, visibility, segment_id, created_at"
        : "id, sender_id, sender_type, role, content, metadata, visibility, created_at";
      if (shouldLoadBoundedContinuity) {
        // Read exactly the current row and its two direct predecessors. Do not
        // hide partner-target rows here: their presence must break continuity,
        // never make non-adjacent messages look adjacent after filtering.
        return supabase
          .from("chat_messages")
          .select(messageContextColumns)
          .eq("couple_id", dataCoupleId)
          .eq("visibility", visibility)
          .eq("segment_id", boundedContinuitySegmentId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(3);
      }
      let q = supabase
        .from("chat_messages")
        .select(messageContextColumns)
        .eq("couple_id", dataCoupleId)
        // 상대에게 직접 보낸 메시지는 커플이 공유해서 보는 데이터여도
        // Amora/OpenAI 입력은 아니다. DB에서 먼저 제외하고 아래에서 한 번 더
        // 걸러 PostgREST 필터 회귀가 생겨도 provider 경계를 넘지 않게 한다.
        .or("metadata->>target.is.null,metadata->>target.neq.partner")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(MAX_CONTEXT_MESSAGES);
      if (conversationSegmentReadEnabled) {
        q = q.eq("segment_id", activeConversationSegmentId);
      }
      return visibility === "shared"
        ? q.eq("visibility", "shared")
        : q.in("visibility", ["shared", visibility]);
        })(),
    // 6. 검증된 V2 기억 노드에서 요청별 맞춤 정보를 결정론적으로 투영한다.
    // 최근 결정 50개와 분리해 오래된 active 근거도 누락하지 않는다.
    enabledMemoryVisibilities.length === 0
      ? Promise.resolve({ data: [], error: null })
      : (() => {
          const query = supabase
            .from("decision_nodes")
            .select(
              "id, couple_id, visibility, memory_key, title, chosen_value, reasoning, confidence, source_message_id, source_actor_role, superseded_at, metadata, created_at, updated_at, source_message:chat_messages!decision_nodes_source_message_id_fkey(id, couple_id, visibility, sender_id, sender_type, role, metadata)"
            )
            .eq("couple_id", dataCoupleId)
            .not("memory_key", "is", null)
            .is("superseded_at", null)
            .order("updated_at", { ascending: false })
            .limit(AMORA_PROFILE_PROJECTION_QUERY_LIMIT);
          return enabledMemoryVisibilities.length === 1
            ? query.eq("visibility", enabledMemoryVisibilities[0])
            : query.in("visibility", enabledMemoryVisibilities);
        })(),
    // 7. 현재 인증 사용자가 직접 확인한 개인 답변 방식.
    // 커플 공용 데이터가 아니므로 actor id로 다시 고정하고, malformed/error는
    // 중립 동작으로 닫는다. 체험에서는 읽거나 저장하지 않는다.
    isDemo || skipsIrrelevantProviderContextReads
      ? Promise.resolve({ data: null, error: null })
      : supabase
          .from("amora_personalization_preferences")
          .select(
            "decision_start, answer_detail, support_order, work_mode, family_order, tone_style, revision, confirmed_at, updated_at",
          )
          .eq("owner_user_id", actorId)
          .maybeSingle(),
  ]);

  const journey = journeyResult.data;
  if (!isDemo && journeyResult.error) {
    console.error("Journey 조회 에러:", journeyResult.error.message);
    await releaseClaimBeforeStream("WEDDING_CONTEXT_UNAVAILABLE");
    return NextResponse.json(
      {
        error: "저장된 웨딩 정보를 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
        code: "WEDDING_CONTEXT_UNAVAILABLE",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  let canonicalJourneyStateRevision =
    isDemo
      ? 0
      : isRecord(journey)
        && typeof journey.state_revision === "number"
        && Number.isSafeInteger(journey.state_revision)
        && journey.state_revision >= 0
        ? journey.state_revision
        : null;
  const criticalContextFailure = !isDemo
    ? [
        {
          error: profilesResult.error,
          code: "COUPLE_DIRECTORY_UNAVAILABLE",
          message: "커플 정보를 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
        },
        {
          error: summariesResult.error,
          code: "MEMORY_CONTEXT_UNAVAILABLE",
          message: "이전 상담 맥락을 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
        },
        {
          error: decisionsResult.error,
          code: "DECISIONS_CONTEXT_UNAVAILABLE",
          message: "저장된 결정 정보를 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
        },
      ].find((candidate) => candidate.error)
    : null;
  if (criticalContextFailure) {
    console.error("[chat] canonical context lookup failed", {
      code: criticalContextFailure.code,
      providerCode: criticalContextFailure.error?.code ?? null,
    });
    await releaseClaimBeforeStream(criticalContextFailure.code);
    return NextResponse.json(
      {
        error: criticalContextFailure.message,
        code: criticalContextFailure.code,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const resolvedWeddingContext = resolveAmoraWeddingContext({
    canonicalJourney: journey,
    clientContext: weddingContext,
    // 실제 사용자는 서버에서 읽은 canonical journey만 신뢰한다.
    // 서명된 체험 세션은 DB가 없으므로 제한적으로 정규화한 client context를 쓴다.
    allowClientContext: isDemo,
  });
  const firstUseGrounding = canonicalJourneyStateRevision === null
    ? null
    : buildAmoraFirstUseGrounding({
        sourceRevision: canonicalJourneyStateRevision,
        todayYmd: ymdInKst(new Date()),
        weddingDate: resolvedWeddingContext.weddingDate,
        budget: resolvedWeddingContext.budget,
        venue: resolvedWeddingContext.venue,
        progress: resolvedWeddingContext.progress,
        scheduleEvents: resolvedWeddingContext.scheduleEvents,
      });

  // v1 공간만 호환 역할 라벨을 provider context에 사용한다. v2 공간의
  // bride/groom 값은 저장 경계를 위한 내부 슬롯일 뿐 사용자 정체성이 아니다.
  const profiles = profilesResult.data ?? [];
  const brideName = usesNeutralMemberPresentation
    ? null
    : profiles.find((p) => p.role === "bride")?.name ?? null;
  const groomName = usesNeutralMemberPresentation
    ? null
    : profiles.find((p) => p.role === "groom")?.name ?? null;
  const memberIds = {
    bride: profiles.find((profile) => profile.role === "bride")?.id ?? null,
    groom: profiles.find((profile) => profile.role === "groom")?.id ?? null,
  };
  const projection = profileNodesResult.error
    ? { profiles: [], rejectedReason: null }
    : projectAmoraProfiles(
        normalizeAmoraProfileProjectionRows(profileNodesResult.data ?? []),
        {
          coupleId: dataCoupleId,
          memberIds,
          allowedVisibilities: enabledMemoryVisibilities,
        },
      );
  if (profileNodesResult.error) {
    console.warn("[chat] profile projection source query failed", profileNodesResult.error.code);
  } else if (projection.rejectedReason) {
    console.warn("[chat] profile projection failed closed", projection.rejectedReason);
  }
  const personalizationProfile = personalizationResult.error
    ? null
    : parseAmoraPersonalizationRow(personalizationResult.data);
  if (personalizationResult.error) {
    console.warn("[chat] personalization lookup failed", {
      code: personalizationResult.error.code,
    });
  } else if (personalizationResult.data && !personalizationProfile) {
    console.warn("[chat] personalization row failed closed");
  }
  if (
    !isDemo
    && initialPrivacyContextSnapshot
    && !personalizationResult.error
  ) {
    const personalizationExists = personalizationResult.data != null;
    const personalizationChanged =
      personalizationExists
        !== initialPrivacyContextSnapshot.personalization.exists
      || (
        personalizationProfile !== null
        && personalizationProfile.revision
          !== initialPrivacyContextSnapshot.personalization.revision
      );
    if (personalizationChanged) {
      await releaseClaimBeforeStream("AMORA_PRIVACY_CONTEXT_CHANGED");
      return NextResponse.json(
        {
          error:
            "개인정보 설정이 대화 준비 중 변경됐어요. 최신 설정으로 다시 시도해주세요.",
          code: "AMORA_PRIVACY_CONTEXT_CHANGED",
          retryable: false,
          retryPolicy: "new_message",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  const projectedAmoraProfiles = toPromptAmoraProfiles(projection.profiles, visibility);
  const consentedAmoraProfiles = {
    shared: sharedMemoryEnabledForTurn ? projectedAmoraProfiles.shared : null,
    private: visibility !== "shared" && memoryEnabledForTurn
      ? projectedAmoraProfiles.private
      : null,
  };

  const {
    progress,
    scheduleEvents,
    preferences,
  } = resolvedWeddingContext;

  // 대화 요약은 visibility별 RLS 정책을 통해 shared/bride/groom 범위가 분리된다.
  const summariesData = (summariesResult.data ?? []) as unknown as Array<{
    summary: string;
    summary_type: string | null;
    visibility: "shared" | "bride_private" | "groom_private";
    segment_id?: string | null;
    created_at: string;
    message_count: number | null;
    to_message_id: string | null;
  }>;
  if (
    conversationSegmentReadEnabled
    && summariesData.some((summary) =>
      summary.segment_id !== activeConversationSegmentId
      || summary.visibility !== visibility)
  ) {
    console.error("[chat] memory summary escaped active conversation segment", {
      visibility,
    });
    await releaseClaimBeforeStream("CONVERSATION_SEGMENT_CONTEXT_UNAVAILABLE");
    return NextResponse.json(
      {
        error: "현재 대화 구간의 기억을 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        code: "CONVERSATION_SEGMENT_CONTEXT_UNAVAILABLE",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const chatSummaries = summariesData
    // Defense in depth: PostgREST filtering is not the provider trust boundary.
    // Reject the marker itself too, including legacy/misclassified rows.
    .filter(isFactualAmoraMemorySummary)
    .filter((summary) => summary.visibility === "shared"
      ? sharedMemoryEnabledForTurn
      : summary.visibility === visibility && memoryEnabledForTurn)
    .slice(0, 3)
    .map((summary) => summary.summary);

  // Memory Step C: 의사결정 히스토리 정리 — 프라이버시 가드
  // RLS는 partner private을 막지만 본인 private은 응답에 포함됨.
  // shared 응답엔 shared decision만, private 응답엔 shared + 같은 visibility만.
  const rawDecisions = (decisionsResult.data ?? []) as Array<{
    id: string;
    couple_id: string;
    category: string;
    decision_type: string;
    title: string;
    chosen_value: Record<string, unknown> | null;
    reasoning: string | null;
    confidence: number | null;
    stage_tag: string | null;
    source: string;
    visibility: "shared" | "bride_private" | "groom_private";
    source_actor_role: "bride" | "groom" | null;
    created_at: string;
    memory_key: string | null;
    superseded_at: string | null;
    metadata: Record<string, unknown> | null;
  }>;
  const isAutomaticMemory = (decision: typeof rawDecisions[number]) =>
    decision.memory_key !== null || typeof decision.metadata?.extracted_by === "string";
  const decisionsWithoutCoreCriterion = withoutAmoraCoreCriterionReceipts(rawDecisions);
  const decisionsData =
    visibility === "shared"
      ? decisionsWithoutCoreCriterion.filter((d) =>
          d.visibility === "shared"
          && d.superseded_at === null
          && (sharedMemoryEnabledForTurn || !isAutomaticMemory(d)))
      : decisionsWithoutCoreCriterion.filter((d) =>
          (d.visibility === "shared" || d.visibility === visibility)
          && d.superseded_at === null
          && (
            !isAutomaticMemory(d)
            || (d.visibility === "shared" ? sharedMemoryEnabledForTurn : memoryEnabledForTurn)
          ));
  // 결정 영수증에는 `superseded_at`을 세우는 코드가 없다. 그래서 예식장을 A홀에서
  // B홀로 바꿔도 A홀 영수증이 살아 있고, 일정을 옮겨도 두 판본이 다 남는다. 프롬프트는
  // 2주 지난 결정을 "혹시 아직도..." 톤으로 회상하라고 지시하므로, 그대로 두면 아모라가
  // 사용자가 이미 갈아치운 값을 아직 유효한 것처럼 되묻는다.
  //
  // DB 플래그가 아니라 지금 읽은 여정 값과 대조한다 — 트리거가 제때 돌았는지에 기대지
  // 않는다. 기록 자체는 지우지 않는다. 아모라에게 현재처럼 보여주지 않을 뿐이다.
  const currentJourneyFacts = {
    venue: isRecord(journey) && typeof journey.venue === "string" ? journey.venue : null,
    events: isRecord(journey) && isRecord(journey.progress)
      ? inspectScheduleEvents(journey.progress).events
        .filter((event) => event.status !== "cancelled")
        .map((event) => ({ id: event.id, date: event.date, title: event.title }))
      : [],
  };
  const liveDecisions = decisionsData.filter((d) => !isSupersededDecision(
    { category: d.category, title: d.title, chosenValue: d.chosen_value },
    currentJourneyFacts,
  ));
  const coreCriterion = visibility === "shared"
    ? null
    : selectCurrentAmoraCoreCriterion({
        expectedOwnerUserId: actorId,
        expectedVisibility: visibility,
        newestFirstRows: rawDecisions,
      });
  const coupleCriterionSnapshot = memberIds.bride && memberIds.groom
    ? selectCurrentAmoraCoupleCriterionSnapshot({
        expectedCoupleId: dataCoupleId,
        expectedBrideUserId: memberIds.bride,
        expectedGroomUserId: memberIds.groom,
        newestFirstRows: rawDecisions,
      })
    : null;
  const coupleCriterion = coupleCriterionSnapshot?.value ?? null;

  const pastDecisions = liveDecisions.map((d) => ({
    category: d.category,
    decisionType: d.decision_type,
    title: d.title,
    value: typeof d.chosen_value?.value === "string" ? d.chosen_value.value : null,
    reasoning: d.reasoning,
    confidence: d.confidence ?? 0.5,
    source: d.source,
    createdAt: d.created_at,
    vendorDeliveryStatus: typeof d.chosen_value?.vendor_delivery_status === "string"
      ? d.chosen_value.vendor_delivery_status
      : typeof d.metadata?.vendor_delivery_status === "string"
        ? d.metadata.vendor_delivery_status
        : null,
    vendorConfirmationStatus: typeof d.chosen_value?.vendor_confirmation_status === "string"
      ? d.chosen_value.vendor_confirmation_status
      : typeof d.metadata?.vendor_confirmation_status === "string"
        ? d.metadata.vendor_confirmation_status
        : null,
    internalRequestStatus: typeof d.chosen_value?.internal_request_status === "string"
      ? d.chosen_value.internal_request_status
      : null,
    vendorCancellationStatus: typeof d.chosen_value?.vendor_cancellation_status === "string"
      ? d.chosen_value.vendor_cancellation_status
      : typeof d.metadata?.vendor_cancellation_status === "string"
        ? d.metadata.vendor_cancellation_status
        : null,
    refundStatus: typeof d.chosen_value?.refund_status === "string"
      ? d.chosen_value.refund_status
      : typeof d.metadata?.refund_status === "string"
        ? d.metadata.refund_status
        : null,
    completionEvidence: typeof d.chosen_value?.completion_evidence === "string"
      ? d.chosen_value.completion_evidence
      : typeof d.metadata?.completion_evidence === "string"
        ? d.metadata.completion_evidence
        : null,
  }));

  // 갈등 합의도 위에서 같은 동의·visibility 필터를 통과한 결정만 사용한다.
  // 따라서 과거 자동 추출 데이터가 기억 동의 없이 별도 경로로 새지 않는다.
  const pastConflicts = decisionsData
    .filter((decision) => decision.category === "conflict_resolution")
    .slice(0, 5)
    .map((c) => ({
    title: c.title,
    resolution: typeof c.chosen_value?.value === "string" ? c.chosen_value.value : null,
    reasoning: c.reasoning,
    stageTag: c.stage_tag,
    createdAt: c.created_at,
    }));

  type CanonicalChatRow = {
    id: string;
    sender_id: string | null;
    sender_type: "bride" | "groom" | "ai";
    role: "user" | "assistant";
    content: string;
    metadata: {
      target?: string;
      pending_amora_action?: unknown;
      in_reply_to_user_message_id?: unknown;
      amora_first_use_promotion_id?: unknown;
      confirmed_amora_action_id?: unknown;
    } | null;
    visibility: "shared" | "bride_private" | "groom_private";
    segment_id?: string | null;
    created_at: string;
  };

  if (!isDemo && messagesResult.error) {
    console.error("Canonical chat history lookup failed:", messagesResult.error.message);
    await releaseClaimBeforeStream("CHAT_HISTORY_UNAVAILABLE");
    return NextResponse.json(
      { error: "저장된 대화를 확인하지 못했습니다.", code: "CHAT_HISTORY_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const canonicalContextRows = (messagesResult.data ?? []) as unknown as CanonicalChatRow[];
  if (
    conversationSegmentReadEnabled
    && canonicalContextRows.some((row) =>
      row.segment_id !== activeConversationSegmentId
      || row.visibility !== visibility)
  ) {
    console.error("[chat] canonical history escaped active conversation segment", {
      visibility,
    });
    await releaseClaimBeforeStream("CONVERSATION_SEGMENT_CONTEXT_UNAVAILABLE");
    return NextResponse.json(
      {
        error: "현재 대화 구간을 안전하게 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
        code: "CONVERSATION_SEGMENT_CONTEXT_UNAVAILABLE",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let canonicalRows = canonicalContextRows
    .filter((row) => row.metadata?.target !== "partner")
    .reverse();
  let isDurableUserMessageBound = false;
  if (!isDemo && requestKind === "chat" && typeof bodyUserMessageId === "string") {
    const requestedIndex = canonicalRows.findIndex((row) => row.id === bodyUserMessageId);
    const requestedRow = requestedIndex >= 0 ? canonicalRows[requestedIndex] : null;
    if (
      !requestedRow ||
      requestedRow.sender_id !== actorId ||
      requestedRow.sender_type === "ai" ||
      requestedRow.role !== "user" ||
      requestedRow.visibility !== visibility
    ) {
      await releaseClaimBeforeStream("USER_MESSAGE_SCOPE_MISMATCH");
      return NextResponse.json(
        {
          error: "보낸 메시지와 요청의 연결을 확인하지 못했습니다. 다시 전송해주세요.",
          code: "USER_MESSAGE_SCOPE_MISMATCH",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    // Private turns intentionally read shared context as well as their own
    // lane. A newer row from another visibility must not make an interrupted
    // request unrecoverable, while a newer row in the same lane must still
    // fence off stale replay. Direct partner messages have already been
    // excluded on both the PostgREST and in-process boundaries.
    const latestLaneRow = [...canonicalRows]
      .reverse()
      .find((row) => row.visibility === visibility);
    if (latestLaneRow?.id !== requestedRow.id) {
      await releaseClaimBeforeStream("USER_MESSAGE_NOT_LATEST");
      return NextResponse.json(
        {
          error: "새 대화가 이어져 이전 요청을 처리하지 않았습니다. 최신 대화에서 다시 시도해주세요.",
          code: "USER_MESSAGE_NOT_LATEST",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    canonicalRows = canonicalRows.slice(0, requestedIndex + 1);
    isDurableUserMessageBound = true;
  }

  const toCanonicalMessage = (row: CanonicalChatRow) => {
    if (row.sender_type === "ai" || row.role === "assistant") {
      return { role: "assistant" as const, content: row.content, id: row.id };
    }
    const roleLabel = usesNeutralMemberPresentation
      ? row.sender_id === actorId ? "사용자" : "파트너"
      : row.sender_type === "bride" ? "신부" : "신랑";
    const targetLabel = row.metadata?.target === "partner" ? "→상대방" : "";
    return {
      role: "user" as const,
      content: `[${roleLabel}${targetLabel}] ${row.content}`,
      id: row.id,
    };
  };
  const canonicalMessages = canonicalRows.map(toCanonicalMessage);

  // Signed demo만 DB가 없으므로 client history를 사용한다. 실제 사용자 턴은
  // canonical DB history만 prompt source로 허용한다.
  let typedMessages: Array<{ role: "user" | "assistant"; content: string; id?: string }> =
    isDemo
      ? (messages as Array<{ role: "user" | "assistant"; content: string; id?: string }>)
      : canonicalMessages;
  let lastUserText: string;

  if (requestKind === "initial_greeting") {
    const roleLabel = usesNeutralMemberPresentation
      ? "사용자"
      : userProfile.role === "groom"
        ? "신랑"
        : userProfile.role === "bride"
          ? "신부"
          : "사용자";
    lastUserText = "[INITIAL_GREETING]";
    typedMessages = [
      ...typedMessages,
      { role: "user", content: `[${roleLabel}] ${lastUserText}` },
    ];
  } else if (requestKind === "mediation") {
    const roleLabel = usesNeutralMemberPresentation
      ? "사용자"
      : userProfile.role === "groom"
        ? "신랑"
        : userProfile.role === "bride"
          ? "신부"
          : "사용자";
    lastUserText = `[MEDIATION_REQUEST] ${String(conflictContext).trim()}`;
    // The consent dialog promises requester_summary_only. Do not carry raw
    // canonical chat into this provider turn and then overstate its evidence
    // scope in the persisted proposal provenance.
    typedMessages = [
      {
        role: "user",
        content: `[${roleLabel}] [MEDIATION_REQUEST] 커플 대화의 의견 차이를 중립적으로 중재해주세요. 요청자가 직접 작성한 요약: ${String(conflictContext).trim()}`,
      },
    ];
  } else if (isDemo) {
    lastUserText =
      [...typedMessages].reverse().find((message) => message.role === "user")?.content ?? "";
  } else {
    const latestUserRow = [...canonicalRows]
      .reverse()
      .find((row) => row.role === "user" && row.sender_type !== "ai");
    if (!latestUserRow || latestUserRow.sender_id !== actorId) {
      await releaseClaimBeforeStream("USER_MESSAGE_NOT_PERSISTED");
      return NextResponse.json(
        {
          error: "보낸 메시지 저장을 아직 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
          code: "USER_MESSAGE_NOT_PERSISTED",
        },
        { status: 409, headers: { "Cache-Control": "no-store", "Retry-After": "1" } },
      );
    }
    const latestClientUserText = [...(messages as Array<{ role: "user" | "assistant"; content: string }>)]
      .reverse()
      .find((message) => message.role === "user")?.content;
    if (!isDurableUserMessageBound && latestClientUserText !== latestUserRow.content) {
      await releaseClaimBeforeStream("LEGACY_USER_MESSAGE_MISMATCH");
      return NextResponse.json(
        {
          error: "저장된 최신 메시지와 요청 내용이 달라 다시 전송이 필요합니다.",
          code: "LEGACY_USER_MESSAGE_MISMATCH",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    lastUserText = latestUserRow.content;
  }

  // The durable row keeps the complete short composer prompt for audit and
  // replay binding. From this point onward only the suffix attested by the
  // user is eligible for classification, routing, or provider input.
  if (
    resolvedScheduleCareFollowUp !== null
    && scheduleCareFollowUpAnswer !== null
  ) {
    lastUserText = scheduleCareFollowUpAnswer;
  }

  const currentCanonicalUserRow = !isDemo && requestKind === "chat"
    ? [...canonicalRows].reverse().find((row) =>
        row.role === "user"
        && row.sender_type !== "ai"
        && row.sender_id === actorId
      ) ?? null
    : null;
  const scheduleCareSharedActionDraft = visibility === "shared"
    ? parseAmoraScheduleCareSharedActionDraft(lastUserText)
    : { status: "absent" as const };
  const isFirstUseSharedDraft = !isDemo
    && requestKind === "chat"
    && visibility === "shared"
    && isAmoraFirstUseSharedDraftText(lastUserText);
  const storedFirstUsePromotionId =
    currentCanonicalUserRow?.metadata?.amora_first_use_promotion_id;
  let firstUsePromotionBinding: AmoraFirstUsePromotionValidation | null = null;
  if (isFirstUseSharedDraft) {
    if (
      !isDurableUserMessageBound
      || typeof storedFirstUsePromotionId !== "string"
      || !isUuid(storedFirstUsePromotionId)
    ) {
      await releaseClaimBeforeStream("AMORA_FIRST_USE_PROMOTION_REQUIRED");
      return NextResponse.json(
        {
          error: "이 실행 카드의 안전한 연결 정보가 없거나 만료됐어요. 개인 상담에서 한 가지 제안을 다시 만들어 공유해주세요.",
          code: "AMORA_FIRST_USE_PROMOTION_REQUIRED",
          retryable: false,
          retryPolicy: "regenerate_first_use_action",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (initialPrivacyEpoch === null || !currentCanonicalUserRow) {
      await releaseClaimBeforeStream("AMORA_FIRST_USE_PROMOTION_UNAVAILABLE");
      return NextResponse.json(
        {
          error: "실행 카드의 현재 상태를 안전하게 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
          code: "AMORA_FIRST_USE_PROMOTION_UNAVAILABLE",
          retryable: true,
          retryPolicy: "same_request",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    try {
      const { data, error } = await getServiceClient().rpc(
        "validate_amora_first_use_action_promotion_v1",
        {
          p_couple_id: dataCoupleId,
          p_owner_user_id: actorId,
          p_shared_user_message_id: currentCanonicalUserRow.id,
          p_expected_privacy_epoch: initialPrivacyEpoch,
        },
      );
      if (error) {
        const failure = `${error.code ?? ""} ${error.message ?? ""}`;
        const knownConflict =
          !failure.includes("AMORA_FIRST_USE_PROMOTION_SERVICE_ROLE_REQUIRED")
          && (
            error.code === "22023"
            || error.code === "23505"
            || error.code === "40001"
            || error.code === "42501"
          );
        await releaseClaimBeforeStream(
          knownConflict
            ? "AMORA_FIRST_USE_PROMOTION_STALE"
            : "AMORA_FIRST_USE_PROMOTION_UNAVAILABLE",
        );
        return NextResponse.json(
          {
            error: knownConflict
              ? "이 실행 카드는 현재 준비 상태와 달라졌어요. 개인 상담에서 다시 정리해 공유해주세요."
              : "실행 카드의 현재 상태를 안전하게 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
            code: knownConflict
              ? "AMORA_FIRST_USE_PROMOTION_STALE"
              : "AMORA_FIRST_USE_PROMOTION_UNAVAILABLE",
            retryable: !knownConflict,
            retryPolicy: knownConflict
              ? "regenerate_first_use_action"
              : "same_request",
          },
          {
            status: knownConflict ? 409 : 503,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }
      firstUsePromotionBinding = parseAmoraFirstUsePromotionValidation({
        value: data,
        expectedPromotionId: storedFirstUsePromotionId,
        expectedSharedText: lastUserText,
      });
      if (!firstUsePromotionBinding) {
        await releaseClaimBeforeStream("AMORA_FIRST_USE_PROMOTION_MISMATCH");
        return NextResponse.json(
          {
            error: "이 실행 카드의 내용과 안전한 연결 정보가 일치하지 않아요. 개인 상담에서 다시 정리해 공유해주세요.",
            code: "AMORA_FIRST_USE_PROMOTION_MISMATCH",
            retryable: false,
            retryPolicy: "regenerate_first_use_action",
          },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
      if (canonicalJourneyStateRevision === null) {
        const journeyRevisionResult = await supabase
          .from("wedding_journeys")
          .select("state_revision")
          .eq("couple_id", dataCoupleId)
          .single();
        const currentRevision = isRecord(journeyRevisionResult.data)
          ? journeyRevisionResult.data.state_revision
          : null;
        if (
          journeyRevisionResult.error
          || typeof currentRevision !== "number"
          || !Number.isSafeInteger(currentRevision)
          || currentRevision < 0
        ) {
          await releaseClaimBeforeStream(
            "AMORA_FIRST_USE_PROMOTION_UNAVAILABLE",
          );
          return NextResponse.json(
            {
              error: "실행 카드의 현재 준비 상태를 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
              code: "AMORA_FIRST_USE_PROMOTION_UNAVAILABLE",
              retryable: true,
              retryPolicy: "same_request",
            },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
        canonicalJourneyStateRevision = currentRevision;
      }
    } catch (error) {
      console.error("[chat] first-use promotion validation failed", error);
      await releaseClaimBeforeStream("AMORA_FIRST_USE_PROMOTION_UNAVAILABLE");
      return NextResponse.json(
        {
          error: "실행 카드의 현재 상태를 안전하게 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
          code: "AMORA_FIRST_USE_PROMOTION_UNAVAILABLE",
          retryable: true,
          retryPolicy: "same_request",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const previousCanonicalRow = canonicalRows.length >= 2
    ? canonicalRows[canonicalRows.length - 2]
    : null;
  const firstUseApplicationSource =
    !isDemo
    && requestKind === "chat"
    && isDurableUserMessageBound
    && visibility === "shared"
    && previousCanonicalRow?.role === "assistant"
    && previousCanonicalRow.sender_type === "ai"
    && previousCanonicalRow.visibility === visibility
      ? parseAmoraFirstUseActionApplicationSource({
          sourceMessage: {
            id: previousCanonicalRow.id,
            content: previousCanonicalRow.content,
            metadata: previousCanonicalRow.metadata,
            createdAt: previousCanonicalRow.created_at,
          },
          confirmedActionId: bodyConfirmedActionId,
          availableTools: PENDING_ACTION_TOOLS,
          expectedJourneyRevision: canonicalJourneyStateRevision,
          expectedCriterionDecisionId:
            coupleCriterionSnapshot?.decisionId ?? null,
          now: Date.now(),
        })
      : null;
  const providerBackedAddActionApplicationSource =
    !isDemo
    && requestKind === "chat"
    && isDurableUserMessageBound
    && visibility === "shared"
    && previousCanonicalRow?.role === "assistant"
    && previousCanonicalRow.sender_type === "ai"
    && previousCanonicalRow.visibility === visibility
      ? parseAmoraProviderBackedAddActionApplicationSource({
          sourceMessage: {
            id: previousCanonicalRow.id,
            content: previousCanonicalRow.content,
            metadata: previousCanonicalRow.metadata,
            createdAt: previousCanonicalRow.created_at,
          },
          confirmedActionId: bodyConfirmedActionId,
          availableTools: PENDING_ACTION_TOOLS,
          expectedJourneyRevision: canonicalJourneyStateRevision,
          now: Date.now(),
        })
      : null;
  const approvedPendingAction =
    !isDemo
    && requestKind === "chat"
    && isDurableUserMessageBound
    && visibility === "shared"
    && previousCanonicalRow?.role === "assistant"
    && previousCanonicalRow.sender_type === "ai"
    && previousCanonicalRow.visibility === visibility
      ? firstUseApplicationSource?.pendingAction
        ?? providerBackedAddActionApplicationSource?.pendingAction
        ?? resolveAmoraPendingAction({
            value: previousCanonicalRow.metadata?.pending_amora_action,
            confirmedActionId: bodyConfirmedActionId,
            allowedTools: PENDING_ACTION_TOOLS,
            now: Date.now(),
          })
      : null;
  if (bodyConfirmedActionId !== undefined && !approvedPendingAction) {
    await releaseClaimBeforeStream("AMORA_PENDING_ACTION_CONFIRMATION_REJECTED");
    return NextResponse.json(
      {
        error: "확인할 변경이 만료되었거나 현재 대화에 속하지 않습니다. 변경 내용을 다시 확인해주세요.",
        code: "AMORA_PENDING_ACTION_CONFIRMATION_REJECTED",
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (approvedPendingAction) {
    const approvalPolicy = getAmoraActionApprovalPolicy(
      approvedPendingAction.tool,
      approvedPendingAction.input,
    );
    if (approvalPolicy === "blocked") {
      await releaseClaimBeforeStream("AMORA_PENDING_ACTION_POLICY_BLOCKED");
      return NextResponse.json(
        {
          error: "이 변경은 현재 아모라가 직접 반영하지 않도록 막아두었어요.",
          code: "AMORA_PENDING_ACTION_POLICY_BLOCKED",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const { data, error } = await getServiceClient().rpc(
      "authorize_amora_shared_action_execution",
      {
        p_action_id: approvedPendingAction.actionId,
        p_confirmation_message_id: bodyUserMessageId,
        p_couple_id: coupleId,
        p_source_message_id: previousCanonicalRow!.id,
        p_user_id: actorId,
      },
    );
    const authorized = isRecord(data) && data.authorized === true;
    if (error || !authorized) {
      const failure = `${error?.code ?? ""} ${error?.message ?? ""}`;
      const approvalRequired =
        failure.includes("AMORA_SHARED_ACTION_APPROVAL_REQUIRED");
      const applicationClaimRejected =
        failure.includes("AMORA_SHARED_ACTION_APPLICATION_CLAIM");
      const proposalChanged =
        failure.includes("AMORA_SHARED_ACTION_PROPOSAL_CHANGED")
        || failure.includes("AMORA_SHARED_ACTION_STALE_CONTEXT")
        || failure.includes("AMORA_SHARED_ACTION_EXPIRED");
      const knownConflict =
        approvalRequired || applicationClaimRejected || proposalChanged;
      await releaseClaimBeforeStream(
        knownConflict
          ? "AMORA_SHARED_ACTION_CONFIRMATION_REJECTED"
          : "AMORA_SHARED_ACTION_AUTHORIZATION_UNAVAILABLE",
      );
      if (!knownConflict) {
        console.error(
          "[amora-shared-action] execution authorization unavailable",
          error?.code ?? "invalid-response",
        );
      }
      return NextResponse.json(
        proposalChanged
          ? {
              error: "그 사이 내용이 바뀌어 아무것도 변경하지 않았어요. 최신 제안을 다시 확인해 주세요.",
              code: "AMORA_SHARED_ACTION_PROPOSAL_CHANGED",
            }
          : applicationClaimRejected
            ? {
                error: "다른 화면의 적용 요청과 겹쳐 아무것도 변경하지 않았어요. 최신 상태를 확인한 뒤 다시 시도해 주세요.",
                code: "AMORA_SHARED_ACTION_APPLICATION_CLAIM_REQUIRED",
              }
            : approvalRequired
              ? {
                  error: "두 분의 확인이 모두 끝나기 전이라 아직 아무것도 변경하지 않았어요.",
                  code: "AMORA_SHARED_ACTION_APPROVAL_REQUIRED",
                }
              : {
                  error: "확인 상태를 안전하게 검증하지 못해 아무것도 변경하지 않았어요.",
                  code: "AMORA_SHARED_ACTION_AUTHORIZATION_UNAVAILABLE",
                },
        {
          status: knownConflict ? 409 : 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  }

  // 범위 권한은 현재 사용자 발화와 서버가 검증한 승인 액션에서만 얻는다.
  // 일반 대화 기록·첨부 내용·저장 기억·진행 단계는 도구 권한을 높이지 않는다.
  // 짧은 후속 말은 범위를 승격하지 않는다. 바로 앞의 정확히 연결된
  // 대화 1회만 별도 context-only 계약으로 전달하며, 권한은 현재 발화와
  // 서버가 검증한 confirmedActionId에서만 얻는다.
  // Quote checklist messages carry server-bound machine context for this turn's
  // analyze_quote call. They are never human memory evidence, including legacy
  // or malformed marker variants.
  const quoteAnalysisSelection = parseCanonicalQuoteAnalysisSelection(lastUserText);
  const questionScope = classifyAmoraQuestionScope({
    userText: lastUserText,
    requestKind,
    // A service-validated first-use receipt proves this otherwise generic
    // five-line draft came from the wedding journey. The classifier still
    // evaluates crisis/domain-risk language before this W0 promotion, so the
    // receipt cannot launder a legal, medical, financial, or safety request.
    hasApprovedWeddingAction: Boolean(
      approvedPendingAction
      || firstUsePromotionBinding
      || resolvedScheduleCareFollowUp
      || scheduleCareSharedActionDraft.status === "valid",
    ),
  });
  if (
    firstUseApplicationSource
    && approvedPendingAction
    && lastUserText === AMORA_FIRST_USE_ACTION_APPLICATION_CONFIRMATION
    && validatedAttachments.length === 0
    && questionScope.scope === "W0_wedding_core"
    && currentCanonicalUserRow
    && canonicalJourneyStateRevision !== null
    && initialPrivacyEpoch !== null
    && requestClaimAcquired
    && requestClaimAttemptCount !== null
  ) {
    let finalizedData: unknown;
    try {
      const { data, error } = await getServiceClient().rpc(
        "finalize_amora_first_use_action_application_v1",
        {
          p_couple_id: dataCoupleId,
          p_actor_user_id: actorId,
          p_source_proposal_message_id:
            firstUseApplicationSource.sourceProposalMessageId,
          p_confirmation_message_id: currentCanonicalUserRow.id,
          p_chat_request_key: clientRequestId,
          p_chat_claim_attempt_count: requestClaimAttemptCount,
          p_expected_privacy_epoch: initialPrivacyEpoch,
        },
      );
      if (error) {
        const serviceRoleFailure = `${error.code ?? ""} ${error.message ?? ""}`
          .includes("AMORA_FIRST_USE_ACTION_APPLICATION_SERVICE_ROLE_REQUIRED");
        const invariantFailure = error.code === "55000";
        const knownConflict = !serviceRoleFailure && (
          error.code === "22023"
          || error.code === "23505"
          || error.code === "23514"
          || error.code === "40001"
          || error.code === "42501"
        );
        await releaseClaimBeforeStream(
          knownConflict
            ? "AMORA_FIRST_USE_ACTION_APPLICATION_STALE"
            : invariantFailure
              ? "AMORA_FIRST_USE_ACTION_APPLICATION_INVARIANT_FAILED"
              : "AMORA_FIRST_USE_ACTION_APPLICATION_UNAVAILABLE",
        );
        return NextResponse.json(
          {
            error: knownConflict
              ? "이 실행 카드는 최신 준비 상태와 달라져 적용하지 않았어요. 최신 제안을 다시 확인해 주세요."
              : invariantFailure
                ? "행동 카드의 저장 결과를 안전하게 확인하지 못해 적용하지 않았어요."
                : "행동 카드를 안전하게 저장하지 못했어요. 잠시 후 같은 요청으로 다시 시도해 주세요.",
            code: knownConflict
              ? "AMORA_FIRST_USE_ACTION_APPLICATION_STALE"
              : invariantFailure
                ? "AMORA_FIRST_USE_ACTION_APPLICATION_INVARIANT_FAILED"
                : "AMORA_FIRST_USE_ACTION_APPLICATION_UNAVAILABLE",
            retryable: !knownConflict && !invariantFailure,
            retryPolicy: knownConflict
              ? "regenerate_first_use_action"
              : invariantFailure
                ? "new_message"
                : "same_request",
          },
          {
            status: knownConflict ? 409 : 503,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }
      finalizedData = data;
    } catch (error) {
      console.error("[chat] deterministic first-use application failed", error);
      await releaseClaimBeforeStream(
        "AMORA_FIRST_USE_ACTION_APPLICATION_UNAVAILABLE",
      );
      return NextResponse.json(
        {
          error: "행동 카드를 안전하게 저장하지 못했어요. 잠시 후 같은 요청으로 다시 시도해 주세요.",
          code: "AMORA_FIRST_USE_ACTION_APPLICATION_UNAVAILABLE",
          retryable: true,
          retryPolicy: "same_request",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    // The RPC owns the action, receipt, and exact chat claim in one commit.
    // Never let parsing or release failures overwrite that terminal truth.
    requestClaimAcquired = false;
    requestClaimAttemptCount = null;
    const persistedApplication = parseAmoraFirstUseDeterministicApplication({
      value: finalizedData,
      expectedChatRequestKey: clientRequestId,
      expectedVisibleRequestKey: visibleClientRequestKey,
      expectedConfirmationMessageId: currentCanonicalUserRow.id,
      expectedPendingAction: approvedPendingAction,
      expectedJourneyRevision: canonicalJourneyStateRevision,
      expectedPromotionId: firstUseApplicationSource.promotionId,
    });
    if (!persistedApplication) {
      console.error("[chat] deterministic first-use application was malformed", {
        requestCorrelationId,
      });
      return NextResponse.json(
        {
          error: "저장된 행동 카드 결과를 안전하게 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.",
          code: "AMORA_FIRST_USE_ACTION_APPLICATION_INVALID",
          retryable: true,
          retryPolicy: "same_request",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    try {
      return await replayPersistedWithMemoryReconciliation(
        persistedApplication,
        initialPrivacyEpoch,
      );
    } catch (error) {
      console.error("[chat] deterministic first-use application release failed", error);
      const privacyCode = getAmoraPrivacyContextErrorCode(error);
      return NextResponse.json(
        {
          error: privacyCode
            ? "개인정보 설정이 바뀌어 저장 결과를 바로 보여주지 않았어요. 최신 상태에서 다시 확인해 주세요."
            : "저장된 행동 카드 결과를 안전하게 보여주지 못했어요. 같은 요청으로 다시 확인해 주세요.",
          code: privacyCode
            ?? "AMORA_FIRST_USE_ACTION_APPLICATION_RELEASE_FAILED",
          retryable: privacyCode === null,
          retryPolicy: privacyCode === null ? "same_request" : "new_message",
        },
        {
          status: privacyCode ? 409 : 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  }
  if (
    providerBackedAddActionApplicationSource
    && approvedPendingAction
    && firstUseApplicationSource === null
    && lastUserText === AMORA_FIRST_USE_ACTION_APPLICATION_CONFIRMATION
    && currentCanonicalUserRow?.content
      === AMORA_FIRST_USE_ACTION_APPLICATION_CONFIRMATION
    && currentCanonicalUserRow.metadata?.confirmed_amora_action_id
      === approvedPendingAction.actionId
    && validatedAttachments.length === 0
    && questionScope.scope === "W0_wedding_core"
    && canonicalJourneyStateRevision
      === providerBackedAddActionApplicationSource.journeyRevision
    && initialPrivacyEpoch !== null
    && requestClaimAcquired
    && requestClaimAttemptCount !== null
  ) {
    let finalizedData: unknown;
    try {
      const { data, error } = await getServiceClient().rpc(
        "finalize_amora_provider_backed_add_action_application_v1",
        {
          p_couple_id: dataCoupleId,
          p_actor_user_id: actorId,
          p_source_proposal_message_id:
            providerBackedAddActionApplicationSource.sourceProposalMessageId,
          p_confirmation_message_id: currentCanonicalUserRow.id,
          p_chat_request_key: clientRequestId,
          p_chat_claim_attempt_count: requestClaimAttemptCount,
          p_expected_privacy_epoch: initialPrivacyEpoch,
        },
      );
      if (error) {
        const failure = `${error.code ?? ""} ${error.message ?? ""}`;
        const serviceRoleFailure = failure.includes(
          "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_SERVICE_ROLE_REQUIRED",
        );
        const invariantFailure = error.code === "55000"
          || failure.includes(
            "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_RESULT_INVALID",
          )
          || failure.includes(
            "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_REPLAY_INVALID",
          );
        const retryableBusy = failure.includes(
          "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_EXECUTION_BUSY",
        );
        const knownConflict = !serviceRoleFailure
          && !invariantFailure
          && !retryableBusy
          && (
            error.code === "22023"
            || error.code === "23505"
            || error.code === "23514"
            || error.code === "40001"
            || error.code === "42501"
          );
        await releaseClaimBeforeStream(
          knownConflict
            ? "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_STALE"
            : invariantFailure
              ? "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_INVARIANT_FAILED"
              : "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_UNAVAILABLE",
        );
        return NextResponse.json(
          {
            error: knownConflict
              ? "행동 카드 제안이 현재 준비 상태와 달라져 적용하지 않았어요. 최신 제안을 다시 확인해 주세요."
              : invariantFailure
                ? "행동 카드 저장 결과를 안전하게 확인하지 못해 적용하지 않았어요."
                : "행동 카드를 안전하게 저장하지 못했어요. 같은 요청으로 다시 시도해 주세요.",
            code: knownConflict
              ? "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_STALE"
              : invariantFailure
                ? "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_INVARIANT_FAILED"
                : "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_UNAVAILABLE",
            retryable: !knownConflict && !invariantFailure,
            retryPolicy: knownConflict || invariantFailure
              ? "new_message"
              : "same_request",
          },
          {
            status: knownConflict ? 409 : 503,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }
      finalizedData = data;
    } catch (error) {
      console.error(
        "[chat] provider-backed add-action application failed",
        error,
      );
      await releaseClaimBeforeStream(
        "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_UNAVAILABLE",
      );
      return NextResponse.json(
        {
          error: "행동 카드를 안전하게 저장하지 못했어요. 같은 요청으로 다시 시도해 주세요.",
          code: "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_UNAVAILABLE",
          retryable: true,
          retryPolicy: "same_request",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    // The service-only RPC owns the action, tool receipt, assistant receipt,
    // and exact request claim in one transaction. Parsing may withhold an
    // invalid public response, but it must never mark that committed claim as
    // failed or fall through to a provider retry.
    requestClaimAcquired = false;
    requestClaimAttemptCount = null;
    const persistedApplication =
      parseAmoraProviderBackedAddActionApplication({
        value: finalizedData,
        expectedChatRequestKey: clientRequestId,
        expectedVisibleRequestKey: visibleClientRequestKey,
        expectedConfirmationMessageId: currentCanonicalUserRow.id,
        expectedSourceMessageId:
          providerBackedAddActionApplicationSource.sourceProposalMessageId,
        expectedPendingAction: approvedPendingAction,
        expectedJourneyRevision:
          providerBackedAddActionApplicationSource.journeyRevision,
        expectedCoupleId: coupleId,
      });
    if (!persistedApplication) {
      console.error(
        "[chat] provider-backed add-action application was malformed",
        { requestCorrelationId },
      );
      return NextResponse.json(
        {
          error: "저장된 행동 카드 결과를 안전하게 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.",
          code: "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_INVALID",
          retryable: true,
          retryPolicy: "same_request",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    try {
      return await replayPersistedWithMemoryReconciliation(
        persistedApplication,
        initialPrivacyEpoch,
      );
    } catch (error) {
      console.error(
        "[chat] provider-backed add-action application release failed",
        error,
      );
      const privacyCode = getAmoraPrivacyContextErrorCode(error);
      return NextResponse.json(
        {
          error: privacyCode
            ? "개인정보 설정이 바뀌어 저장 결과를 바로 보여주지 않았어요. 최신 상태에서 다시 확인해 주세요."
            : "저장된 행동 카드 결과를 안전하게 보여주지 못했어요. 같은 요청으로 다시 확인해 주세요.",
          code: privacyCode
            ?? "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_RELEASE_FAILED",
          retryable: privacyCode === null,
          retryPolicy: privacyCode === null ? "same_request" : "new_message",
        },
        {
          status: privacyCode ? 409 : 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  }
  if (
    firstUsePromotionBinding
    && questionScope.scope === "W0_wedding_core"
    && currentCanonicalUserRow
    && canonicalJourneyStateRevision !== null
    && initialPrivacyEpoch !== null
    && requestClaimAcquired
    && requestClaimAttemptCount !== null
  ) {
    let finalizedData: unknown;
    try {
      const { data, error } = await getServiceClient().rpc(
        "finalize_amora_first_use_action_proposal_v1",
        {
          p_couple_id: dataCoupleId,
          p_owner_user_id: actorId,
          p_shared_user_message_id: currentCanonicalUserRow.id,
          p_chat_request_key: clientRequestId,
          p_chat_claim_attempt_count: requestClaimAttemptCount,
          p_expected_privacy_epoch: initialPrivacyEpoch,
        },
      );
      if (error) {
        const failure = `${error.code ?? ""} ${error.message ?? ""}`;
        const serviceRoleFailure = failure.includes(
          "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_SERVICE_ROLE_REQUIRED",
        );
        const invariantFailure = error.code === "55000";
        const knownConflict = !serviceRoleFailure && (
          error.code === "22023"
          || error.code === "23505"
          || error.code === "23514"
          || error.code === "40001"
          || error.code === "42501"
        );
        await releaseClaimBeforeStream(
          knownConflict
            ? "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_STALE"
            : invariantFailure
              ? "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_INVARIANT_FAILED"
              : "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_UNAVAILABLE",
        );
        return NextResponse.json(
          {
            error: knownConflict
              ? "실행 카드가 최신 준비 상태와 달라졌어요. 개인 상담에서 다시 정리해 공유해주세요."
              : invariantFailure
                ? "저장된 실행 카드의 연결 상태를 안전하게 확인하지 못했어요."
              : "실행 카드를 안전하게 준비하지 못했어요. 잠시 후 같은 요청으로 다시 시도해주세요.",
            code: knownConflict
              ? "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_STALE"
              : invariantFailure
                ? "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_INVARIANT_FAILED"
                : "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_UNAVAILABLE",
            retryable: !knownConflict && !invariantFailure,
            retryPolicy: knownConflict
              ? "regenerate_first_use_action"
              : invariantFailure
                ? "new_message"
                : "same_request",
          },
          {
            status: knownConflict ? 409 : 503,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }
      finalizedData = data;
    } catch (error) {
      console.error("[chat] deterministic first-use proposal failed", error);
      await releaseClaimBeforeStream(
        "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_UNAVAILABLE",
      );
      return NextResponse.json(
        {
          error: "실행 카드를 안전하게 준비하지 못했어요. 잠시 후 같은 요청으로 다시 시도해주세요.",
          code: "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_UNAVAILABLE",
          retryable: true,
          retryPolicy: "same_request",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    // A successful RPC has already atomically completed the exact claim. From
    // here onward no failure marker may race that committed terminal result.
    requestClaimAcquired = false;
    requestClaimAttemptCount = null;
    const persistedProposal = parseAmoraFirstUseDeterministicProposal({
      value: finalizedData,
      binding: firstUsePromotionBinding,
      availableTools: PENDING_ACTION_TOOLS,
      expectedChatRequestKey: clientRequestId,
      expectedVisibleRequestKey: visibleClientRequestKey,
      expectedSharedUserMessageId: currentCanonicalUserRow.id,
      expectedJourneyRevision: canonicalJourneyStateRevision,
      expectedCriterionDecisionId:
        coupleCriterionSnapshot?.decisionId ?? null,
      now: Date.now(),
    });
    if (!persistedProposal) {
      console.error("[chat] deterministic first-use proposal was malformed", {
        requestCorrelationId,
      });
      return NextResponse.json(
        {
          error: "저장된 실행 카드를 안전하게 확인하지 못했어요.",
          code: "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_INVALID",
          retryable: false,
          retryPolicy: "new_message",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    try {
      return await replayPersistedWithMemoryReconciliation(
        persistedProposal,
        initialPrivacyEpoch,
      );
    } catch (error) {
      console.error("[chat] deterministic first-use proposal release failed", error);
      const privacyCode = getAmoraPrivacyContextErrorCode(error);
      return NextResponse.json(
        {
          error: privacyCode
            ? "개인정보 설정이 바뀌어 실행 카드를 바로 보여주지 않았어요. 최신 상태에서 다시 확인해주세요."
            : "저장된 실행 카드를 안전하게 확인하지 못했어요.",
          code: privacyCode
            ?? "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_RELEASE_FAILED",
          retryable: false,
          retryPolicy: "new_message",
        },
        {
          status: privacyCode ? 409 : 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  }
  const boundedContinuity =
    !isDemo
    && requestKind === "chat"
    && isDurableUserMessageBound
    && typeof bodyUserMessageId === "string"
    && shouldLoadBoundedContinuity
      ? buildAmoraBoundedContinuity({
          newestFirstRows: selectAmoraTrustedHistoryRows({
            oldestFirstRows: [...canonicalContextRows].reverse(),
            currentUserMessageId: bodyUserMessageId,
            visibility,
          }).reverse(),
          currentMessageId: bodyUserMessageId,
          currentUserText: lastUserText,
          requesterUserId: actorId,
          visibility,
          segmentId: boundedContinuitySegmentId as string,
        })
      : null;
  const allowsLongTermMemoryForTurn =
    !isListenOnly
    && questionScope.allowsLongTermMemory
    && resolvedScheduleCareFollowUp === null
    && quoteAnalysisSelection.status === "absent";
  const memoryEnqueueRequested =
    allowsLongTermMemoryForTurn
    && memoryEnabledForTurn
    && isAuxiliaryMemoryRuntimeEnabled();
  const allowsStoredProviderContext =
    requestKind === "chat"
    && !isListenOnly
    && resolvedScheduleCareFollowUp === null
    && (
      questionScope.scope === "W0_wedding_core"
      || questionScope.scope === "W1_wedding_adjacent"
    );
  const assertStoredContextTerminalReleasePrivacyEpochCurrent = async () => {
    // Current-input-only scopes never loaded stored couple context, so they do
    // not need another database read at the terminal display boundary.
    if (isDemo || !allowsStoredProviderContext) return;
    if (initialPrivacyEpoch === null) {
      throw new AmoraPrivacyContextError("AMORA_PRIVACY_CONTEXT_UNAVAILABLE");
    }
    const currentEpoch = await getAmoraPrivacyEpoch(
      dataCoupleId,
      visibility,
      supabase,
    );
    if (currentEpoch !== initialPrivacyEpoch) {
      throw new AmoraPrivacyContextError("AMORA_PRIVACY_CONTEXT_CHANGED");
    }
  };
  const isStructuredMediation =
    requestKind === "mediation"
    && questionScope.scope === "W1_wedding_adjacent";
  const isHighRiskMediation =
    requestKind === "mediation"
    && questionScope.scope === "W2_high_risk_adjacent";
  const allowsCurrentAttachmentContext =
    requestKind === "chat"
    && !isListenOnly
    && (
      questionScope.scope === "W0_wedding_core"
      || questionScope.scope === "W1_wedding_adjacent"
      || questionScope.scope === "W2_high_risk_adjacent"
    );

  // --- Part 2 & 3: 불만족 자동 감지 + 세션 수준 실수 추적 ---

  // 직전 AI 메시지 (마지막 assistant 메시지)
  const lastAiMsg = [...typedMessages].reverse().find((m) => m.role === "assistant");
  const lastAiText = lastAiMsg?.content ?? "";
  // 불만족 감지
  const dissatisfaction = detectDissatisfaction(lastUserText, lastAiText);

  // 세션 내 수정 횟수 카운트 (전체 대화 기록에서 correction/retry/frustration 시그널 확인)
  let correctionCount = 0;
  for (let i = 1; i < typedMessages.length; i++) {
    const m = typedMessages[i];
    if (m.role === "user") {
      // 직전 assistant 메시지 찾기
      const prevAssistant = typedMessages.slice(0, i).reverse().find((p) => p.role === "assistant");
      const result = detectDissatisfaction(m.content, prevAssistant?.content);
      if (result?.detected && ["correction", "retry", "frustration"].includes(result.signal)) {
        correctionCount++;
      }
    }
  }

  // 불만족 감지 시 자동 피드백 저장 (비동기, 비블로킹)
  if (
    !isDemo
    && requestKind === "chat"
    && !isListenOnly
    && questionScope.allowsLongTermMemory
    && dissatisfaction?.detected
  ) {
    autoSaveDissatisfaction({
      userId: actorId,
      coupleId,
      signal: dissatisfaction.signal,
      visibility,
    });
  }

  // Part 3: 세션 내 2회 이상 수정 시 신중 모드 프리픽스
  const providerCorrectionCount = allowsStoredProviderContext
    ? correctionCount
    : 0;
  const cautionPrefix = providerCorrectionCount >= 2
    ? "[CONTEXT: 이 세션에서 사용자가 2번 이상 수정했습니다. 더 신중하게, 확인하며 답변하세요.]\n\n"
    : "";

  const attachmentKind =
    textAttachments.length > 0
    || visionAttachments.some((attachment) => attachment.mediaType === "application/pdf")
      ? "document" as const
      : visionAttachments.length > 0
        ? "image" as const
        : "none" as const;

  // D3: 저장된 웨딩 맥락이 허용된 요청에서만 stage + specialist를 계산한다.
  const weddingDateForStage = allowsStoredProviderContext
    ? resolvedWeddingContext.weddingDate
    : null;
  const stageTag = allowsStoredProviderContext
    ? determineStage(weddingDateForStage)
    : null;
  const requiresW4AttachmentReuploadGuidance =
    requestKind === "chat"
    && questionScope.scope === "W4_out_of_scope"
    && attachmentKind !== "none";
  // 2026-08-18: 문서를 올렸다는 사실만으로 계약 검토 전문분야로 넘어가지 않는다.
  // 첨부에 필요한 도구(견적 확인·공시 시세)는 amoraToolPolicy가 첨부 종류로
  // 직접 열어 주므로, 전문분야는 평소 라우팅을 그대로 따른다.
  const specialistType = allowsStoredProviderContext && stageTag !== null
    ? routeSpecialist(lastUserText, stageTag)
    : "general" as const;

  // Private 모드 안내. v2의 bride/groom은 호환 슬롯이므로 prompt에 노출하지 않는다.
  const privacyPrefix = visibility === "bride_private" || visibility === "groom_private"
    ? (allowsStoredProviderContext
      ? usesNeutralMemberPresentation
        ? "[PRIVATE_MODE] 이 메시지는 사용자의 개인 비공개 대화입니다.\n"
        : `[PRIVATE_MODE] 이 메시지는 ${visibility === "bride_private" ? "신부" : "신랑"} 분이 **상대방 모르게** 아모라에게만 털어놓는 비공개 대화입니다.\n`
      : "[PRIVATE_MODE] 이 메시지는 사용자의 개인 비공개 대화입니다.\n") +
      `- 상대방을 비난하거나 편드는 발언 금지. 객관적·공감적으로.\n` +
      `- 이 대화 내용은 절대 상대방의 채팅(shared/상대방의 private)에서 언급·인용하지 마세요. 시스템이 격리하지만 아모라도 의식적으로 분리.\n` +
      `- 그러나 이 대화에서 드러난 인사이트는 본인의 향후 private 대화에서는 자연스럽게 이어가도 됩니다.\n` +
      `- 답변은 평소처럼 따뜻하고 실용적으로. 비공개라고 톤을 어둡게 하지 마세요.\n\n`
    : "";

  // Old deployed clients do not send userMessageId. They remain answer-compatible,
  // but may not execute a mutation because the intent is not bound to one DB row.
  const candidateTools = getAvailableChatTools({
    requestKind,
    isDurableUserMessageBound,
    tools: BETA_SAFE_TOOLS,
  });
  const policySelectedTools = selectAmoraTools({
    availableTools: candidateTools,
    userText: lastUserText,
    specialistType,
    attachmentKind,
  });
  const initialPlaceSearchToolChoice = getPlaceSearchToolChoice({
    userText: lastUserText,
    round: 0,
    tools: candidateTools,
  });
  const selectedTools = initialPlaceSearchToolChoice
    ? candidateTools.filter((tool) => (
        tool.name === initialPlaceSearchToolChoice.name
        || policySelectedTools.includes(tool)
      ))
    : policySelectedTools;
  // 개인 대화가 공유 일정·예산을 몰래 바꾸면 "상대방 모르게"라는 약속과
  // 모순된다. 개인 공간에서는 조회·분석만 허용하고 변경은 공유 대화에서 한다.
  const visibilityScopedTools = visibility === "shared"
    ? selectedTools
    : selectedTools.filter((tool) => !isMutatingTool(tool.name));
  // A confirmed pending action is executed once by the server below. The model
  // receives read tools only so it cannot repeat or alter the approved write.
  // 2026-07-24 근본 수리: 모델은 어떤 턴에도 변경 함수를 직접 받지 않는다.
  // 변경의 유일한 경로 = pending 표식 → 사용자 확인 → 서버 직접 실행.
  // (7/18 확인-우선 재설계 이후에도 변경 함수가 도구 목록에 남아 "확인 전
  // 실행 금지" 지시와 경합했고, 모델이 호출도 표식도 못 하는 마비 상태로
  // "기능이 연결돼 있지 않다"는 환각 응답을 만들던 것이 운영 E2E로 확인됨 —
  // 재설계 이후 운영에서 변경 실행 0건.)
  const availableTools = resolvedScheduleCareFollowUp || isListenOnly
    ? []
    : filterAmoraToolsByQuestionScope(
        visibilityScopedTools.filter((tool) => !isMutatingTool(tool.name)),
        questionScope,
      );
  const availableToolNameSet = new Set(
    availableTools.map((tool) => tool.name),
  );
  const questionScopeToolNameCeiling = new Set(
    filterAmoraToolsByQuestionScope(BETA_SAFE_TOOLS, questionScope)
      .map((tool) => tool.name),
  );
  const selectedPendingProposalTools =
    isListenOnly
      ? []
      : scheduleCareSharedActionDraft.status === "valid"
        ? selectAmoraScheduleCareSharedActionProposalTools(
            PENDING_ACTION_TOOLS,
            scheduleCareSharedActionDraft,
          )
        : scheduleCareSharedActionDraft.status === "invalid"
          ? []
          : selectAmoraPendingProposalTools({
              availableTools: PENDING_ACTION_TOOLS,
              userText: lastUserText,
              specialistType,
              attachmentKind,
              // Relative dates on a confirmed important-moment declaration are
              // resolved in KST and server-bound before provider output is
              // accepted. The user still sees the exact date in the approval
              // card before any shared write.
              now: new Date(),
              firstUseActionBinding: firstUsePromotionBinding,
            });
  const pendingProposalTools =
    !isDemo
    && requestKind === "chat"
    && isDurableUserMessageBound
    && visibility === "shared"
    && !approvedPendingAction
      ? filterAmoraToolsByQuestionScope(
          selectedPendingProposalTools.filter(
            (tool) =>
              getAmoraActionApprovalPolicy(tool.name) !== "blocked",
          ),
          questionScope,
        )
      : [];
  const pendingOfferEnabled = pendingProposalTools.length > 0;
  const actionContract: AmoraActionContract | undefined = approvedPendingAction
    ? {
        kind: "execution",
        text: buildAmoraApprovedActionPrompt(approvedPendingAction),
      }
    : pendingOfferEnabled
      ? {
          kind: "proposal",
          text: buildAmoraPendingActionPrompt(
            pendingProposalTools.map((tool) => tool.name),
            pendingProposalTools
              .filter(
                (tool) => tool.name === "add_amora_action"
                  && tool.input_schema["x-amora-bound-input"] !== undefined,
              )
              .map((tool) => tool.name),
          ),
        }
      : undefined;
  const promptContext = {
    weddingDate: weddingDateForStage,
    budget: resolvedWeddingContext.budget,
    venue: resolvedWeddingContext.venue,
    progress,
    preparationStatus: normalizePreparationStatus(
      userProfile.preparation_status,
    ),
    brideName,
    groomName,
    senderName: safeSenderName,
    // Legacy booking rows are outside the current web MVP and are not sent
    // to the model merely because they still exist in the database.
    bookings: [],
    scheduleEvents,
    chatSummaries,
    preferences: preferences ?? undefined,
    helpPreference: personalizationProfile?.preferences ?? null,
    coupleCriterion,
    coreCriterion,
    amoraProfiles: consentedAmoraProfiles,
    pastDecisions,
    pastConflicts,
  };
  const scheduleCareFollowUpContext = resolvedScheduleCareFollowUp
    ? buildAmoraScheduleCareDAfterContext({
        eventTitle: resolvedScheduleCareFollowUp.eventTitle,
        eventDate: resolvedScheduleCareFollowUp.eventDate,
        question: resolvedScheduleCareFollowUp.question,
      }) + "\n\n"
    : "";
  const buildSystemPromptForTools = (enabledTools: typeof BETA_SAFE_TOOLS) =>
    cautionPrefix
    + privacyPrefix
    + scheduleCareFollowUpContext
    + buildAmoraSystemPrompt(promptContext, {
      specialist: specialistType,
      requestKind,
      interactionMode,
      persistenceMode: isDemo ? "demo" : "durable",
      enabledToolNames: enabledTools.map((tool) => tool.name),
      actionContract,
      questionScope,
      currentUserText: lastUserText,
      linkedContextMode: boundedContinuity?.mode,
      maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
    });
  const systemPrompt = buildSystemPromptForTools(availableTools);
  const noToolSystemPrompt = availableTools.length > 0
    ? buildSystemPromptForTools([])
    : systemPrompt;

  // 오래된 대화가 exact-token 상한을 영구적으로 막지 않게 최근 연속 문맥을
  // 보존한다. 실제 비용 경계는 provider의 exact count가 최종 판정한다.
  const currentCanonicalUserMessageId = !isDemo && requestKind === "chat"
    ? [...canonicalRows].reverse().find((row) =>
        row.role === "user"
        && row.sender_type !== "ai"
        && row.sender_id === actorId
      )?.id ?? null
    : null;
  const trustedStoredProviderMessages = !isDemo && currentCanonicalUserMessageId
    ? selectAmoraTrustedHistoryRows({
        oldestFirstRows: canonicalRows,
        currentUserMessageId: currentCanonicalUserMessageId,
        visibility,
      }).map(toCanonicalMessage)
    : typedMessages;
  const providerMessages = resolvedScheduleCareFollowUp
    ? [{ role: "user" as const, content: scheduleCareFollowUpAnswer as string }]
    : allowsStoredProviderContext
      ? takeRecentAmoraConversation(trustedStoredProviderMessages)
      : boundedContinuity?.messages
        ?? [{ role: "user" as const, content: lastUserText }];
  const boundedTextAttachments = allowsCurrentAttachmentContext
    ? boundAmoraTextAttachments(textAttachments)
    : "";
  const providerVisionAttachments = allowsCurrentAttachmentContext
    ? visionAttachments
    : [];

  // 메시지 포맷팅
  const formattedMessages: ChatInputItem[] = providerMessages.map(
    (m: { role: string; content: string }, index: number) => {
      const role = m.role === "assistant" ? ("assistant" as const) : ("user" as const);
      const isLastUserMessage = role === "user" && index === providerMessages.length - 1;

      if (isLastUserMessage) {
        // 문서 텍스트가 있으면 메시지에 포함
        let enrichedText = m.content;
        if (boundedTextAttachments) {
          enrichedText = `${boundedTextAttachments}\n\n${m.content}`;
        }

        // 이미지/PDF 첨부가 있으면 멀티모달로
        if (providerVisionAttachments.length > 0) {
          return {
            role,
            content: buildMultimodalContent(enrichedText, providerVisionAttachments),
          } as ChatInputItem;
        }

        return { role, content: enrichedText } as ChatInputItem;
      }

      return { role, content: m.content } as ChatInputItem;
    }
  );

  // 주의(2026-07-24): pendingOffer 턴을 primary(terra)로 승격했다가 회수 —
  // 운영에서 terra가 reasoning "none" 잠금 하에 빈 응답을 내 모든 저장·예산
  // 턴이 죽는 사고. terra 빈응답 궁합은 별도 백로그, 저장 턴은 검증된 fast 유지.
  const modelRole =
    isStructuredMediation
      ? ("primary" as const)
      : chooseAmoraChatModelRole({
          specialistType,
          userText: lastUserText,
          correctionCount: providerCorrectionCount,
        });
  const shouldBufferProviderText = Boolean(approvedPendingAction)
    || pendingOfferEnabled
    || resolvedScheduleCareFollowUp !== null
    || requestKind === "mediation"
    || requiresW4AttachmentReuploadGuidance
    || boundedContinuity !== null
    || isListenOnly
    // Replies built from stored couple context stay hidden until the database
    // atomically validates the exact privacy epoch and commits the message.
    || allowsStoredProviderContext
    // Demo has no durable write boundary. Buffer every demo chat response so
    // an unexpected completion claim can never flash before terminal scrubbing.
    || (isDemo && requestKind === "chat");
  const executionContext: ToolExecutionContext = {
    coupleId,
    ...(!isDemo ? { actorProfileId: actorId } : {}),
    requestKey: clientRequestId,
    requestAttemptCount: requestClaimAttemptCount ?? undefined,
    currentUserText: lastUserText,
    weddingContext: {
      weddingDate: resolvedWeddingContext.weddingDate,
      budget: resolvedWeddingContext.budget,
      venue: resolvedWeddingContext.venue,
      // The canonical type predates reserved __events/__preferences keys.
      // Runtime values have already passed the bounded structural normalizer.
      progress: resolvedWeddingContext.progress as ToolExecutionContext["weddingContext"]["progress"],
    },
  };

  const providerTimeRemainingMs = requestDeadlineAt - Date.now();
  if (providerTimeRemainingMs <= 1_000) {
    await releaseClaimBeforeStream("CHAT_REQUEST_DEADLINE_EXCEEDED");
    return NextResponse.json(
      {
        error: "응답 준비 시간이 초과됐어요. 같은 요청으로 다시 시도해주세요.",
        code: "CHAT_REQUEST_DEADLINE_EXCEEDED",
      },
      { status: 504, headers: { "Cache-Control": "no-store" } },
    );
  }

  // SSE 스트림 응답 생성
  const encoder = new TextEncoder();
  const turnAbortController = new AbortController();
  const deadlineAbortController = new AbortController();
  const preMutationAbortController = new AbortController();
  const propagateAbort = (signal: AbortSignal) => {
    if (signal.aborted) {
      if (!preMutationAbortController.signal.aborted) {
        preMutationAbortController.abort(signal.reason);
      }
      return;
    }
    signal.addEventListener("abort", () => {
      if (!preMutationAbortController.signal.aborted) {
        preMutationAbortController.abort(signal.reason);
      }
    }, { once: true });
  };
  propagateAbort(turnAbortController.signal);
  propagateAbort(deadlineAbortController.signal);
  const deadlineTimer = setTimeout(() => {
    deadlineAbortController.abort(
      new DOMException("Amora total request deadline exceeded", "TimeoutError"),
    );
  }, providerTimeRemainingMs);
  let toolExecutionCompleted = false;
  let paidProviderBoundaryReached = false;
  const abortBeforeDurableTool = () => {
    if (!toolExecutionCompleted && !turnAbortController.signal.aborted) {
      turnAbortController.abort();
    }
  };
  if (request.signal.aborted) abortBeforeDurableTool();
  else request.signal.addEventListener("abort", abortBeforeDurableTool, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      // SSE 킵얼라이브: 8초마다 comment 전송
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 8000);

      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // 클라이언트 연결 끊김
        }
      };
      const buffersSensitiveToolEvents = !isDemo && allowsStoredProviderContext;
      const bufferedSensitiveToolEvents: Array<Record<string, unknown>> = [];
      let sensitiveToolEventsReleased = !buffersSensitiveToolEvents;
      const sendSensitiveToolEvent = (event: Record<string, unknown>) => {
        if (!sensitiveToolEventsReleased) {
          bufferedSensitiveToolEvents.push(event);
          return;
        }
        send(event);
      };
      const releaseSensitiveToolEvents = () => {
        if (sensitiveToolEventsReleased) return;
        sensitiveToolEventsReleased = true;
        for (const event of bufferedSensitiveToolEvents) send(event);
        bufferedSensitiveToolEvents.length = 0;
      };
      const providerPreviewGate = shouldBufferProviderText
        ? null
        : createAmoraProviderPreviewGate((content) => {
            send({ type: "text_delta", content });
          });

      const closeStream = () => {
        clearInterval(heartbeat);
        clearTimeout(deadlineTimer);
        controller.close();
      };

      // 사용자 turn 이벤트는 쿼터/운영 지표용으로 유지한다. 각 provider 호출의
      // 모델·토큰·비용은 per-call ledger가 소유하므로 여기서 중복 기록하지 않는다.
      const turnStartedAt = startLatencyClock();

      try {
        let currentMessages = [...formattedMessages];
        const toolResults: ToolExecutionResult[] = [];
        const toolsUsed: string[] = [];
        let lockToolsAfterPlaceSearch = false;
        let toolCallCount = 0;
        let approvedPendingActionExecuted = false;
        const executeApprovedPendingAction = async (
          reserveBeforeSideEffect?: () => Promise<void>,
        ) => {
          if (!approvedPendingAction || approvedPendingActionExecuted) return;
          await reserveBeforeSideEffect?.();
          if (preMutationAbortController.signal.aborted) {
            throw new DOMException(
              "Chat request aborted before confirmed action",
              "AbortError",
            );
          }
          sendSensitiveToolEvent({
            type: "tool_start",
            toolName: approvedPendingAction.tool,
            toolInput: getClientSafeToolInput(
              approvedPendingAction.tool,
              approvedPendingAction.input,
            ),
          });
          toolCallCount += 1;
          toolsUsed.push(approvedPendingAction.tool);
          const approvedResult = await executeTool(
            approvedPendingAction.tool,
            approvedPendingAction.input,
            {
              ...executionContext,
              pendingActionId: approvedPendingAction.actionId,
            },
          );
          approvedPendingActionExecuted = true;
          toolExecutionCompleted = true;
          toolResults.push(approvedResult);
          sendSensitiveToolEvent({
            type: "tool_result",
            result: getClientSafeToolResult(approvedResult),
          });
          currentMessages.push({
            role: "user",
            content: [
              "[SERVER_CONFIRMED_ACTION_RESULT]",
              `action_id=${approvedPendingAction.actionId}`,
              `tool=${approvedPendingAction.tool}`,
              boundAmoraToolResultJson(
                {
                  success: approvedResult.success,
                  displayMessage: approvedResult.displayMessage,
                  toolOutput: getModelSafeToolOutput(approvedResult),
                },
                AMORA_MAX_TOOL_RESULT_CHARS,
              ),
            ].join("\n"),
          });
        };
        const prepareTerminalResponse = (fullText: string) => {
          const {
            cleanText: afterSuggest,
            suggestions: extractedSuggestions,
          } = extractSuggestions(fullText);
          // Strip the private internal marker on every path so a prompt-injected
          // lookalike can never become visible. Only a live trusted D+1 binding
          // below may promote the validated payload into assistant metadata.
          const scheduleCareExtraction =
            extractAmoraScheduleCareActionDraft(afterSuggest, {
              guardUnsupportedHardClaims:
                resolvedScheduleCareFollowUp !== null,
            });
          const afterScheduleCare = scheduleCareExtraction.cleanText;
          // A mediation turn can become a jointly accepted decision. Provider
          // suggestion chips are a separate visible output channel and would
          // otherwise bypass the card/prose neutrality guard. Mediation has a
          // dedicated confirm flow, so dropping all provider chips is the
          // smallest fail-closed contract and does not remove user content.
          const suggestions = requestKind === "mediation"
            || isListenOnly
            || resolvedScheduleCareFollowUp !== null
              ? []
              : extractedSuggestions;
          const pendingExtraction = extractAmoraPendingAction({
            text: afterScheduleCare,
            allowedTools: pendingOfferEnabled ? pendingProposalTools : [],
            now: Date.now(),
            createActionId: randomUUID,
          });
          if (
            pendingExtraction.pendingAction
            && canonicalJourneyStateRevision === null
          ) {
            throw new Error("AMORA_JOURNEY_REVISION_UNAVAILABLE");
          }
          const pendingBudgetImpactPreview = pendingExtraction.pendingAction
            && canonicalJourneyStateRevision !== null
            ? buildAmoraBudgetImpactPreview({
                action: pendingExtraction.pendingAction,
                sourceRevision: canonicalJourneyStateRevision,
                context: executionContext,
              })
            : null;
          const {
            cleanText: extractedMediationText,
            mediation: extractedMediation,
          } = extractMediation(
            pendingExtraction.cleanText,
          );
          // Provider text is untrusted. Strip a stray marker from every turn,
          // but only the server-owned mediation request kind may promote it
          // into a confirmable shared card.
          const screenedMediation = isStructuredMediation
            && extractedMediation
            ? toUserRequestedMediationV2(extractedMediation)
            : null;
          const mediationRejectedByOutputGuard = Boolean(
            isStructuredMediation
            && (
              (extractedMediation && !screenedMediation)
              || findMediationNeutralityViolations(extractedMediationText).length > 0
            ),
          );
          const mediation = mediationRejectedByOutputGuard
            ? null
            : screenedMediation;
          const mediationFollowUpSafetyMarker = buildMediationFollowUpSafetyMarker({
            requestKind,
            questionScope: questionScope.scope,
            hasScreenedMediationCard: mediation !== null,
          });
          // 서버가 이미 고위험으로 판정했으면 모델이 무엇을 어떤 모양으로 써 보냈든
          // 합의안은 나가지 않는다. 예전에는 이 대체가 "완전한 4필드 블록이 왔고 블록
          // 밖 텍스트가 비어 있을 때"만 발동해서, 필드 하나가 빠진 블록이나 마커 없는
          // 산문이면 '조금씩 양보하세요'가 그대로 상대에게까지 저장됐다. 안전이 모델
          // 출력 형식에 달려 있으면 그건 안전장치가 아니다.
          const providerCleanText = isHighRiskMediation
            ? "이 사안은 합의안으로 단정하기보다 안전과 권리·건강에 관련된 확인이 먼저예요. 확인된 사실만 정리하고, 해당 분야의 자격 있는 전문가나 공식 기관에 문의할 질문을 준비해 주세요."
            : mediationRejectedByOutputGuard
              ? AMORA_MEDIATION_OUTPUT_GUARD_FALLBACK
            : !isStructuredMediation
              && extractedMediation
              && !extractedMediationText
                ? mediationBlockToOrdinaryText(extractedMediation)
                : extractedMediationText;
          const cleanText = requiresW4AttachmentReuploadGuidance
            ? "지금 요청만으로는 이 파일이 결혼 준비와 어떤 관련이 있는지 확인할 수 없어요. 결혼 준비 관련 파일이라면 관련성을 한 줄로 알려주시고, 파일을 다시 첨부해 주세요."
            : providerCleanText;
          const persistenceClaimGuard = composeAmoraPersistenceTerminal({
            text: cleanText,
            toolResults,
            hasPendingAction: pendingExtraction.pendingAction !== null,
            persistenceMode: isDemo ? "demo" : "durable",
            demoUserText: lastUserText,
          });
          const persistenceSafeText = persistenceClaimGuard.text;
          const firstUsePromotionSourceSeal =
            !isDemo
            && requestKind === "chat"
            && !isListenOnly
            && visibility !== "shared"
            && resolvedScheduleCareFollowUp === null
            && canonicalJourneyStateRevision !== null
            && firstUseGrounding !== null
            && initialPrivacyEpoch !== null
            && initialPrivacyContextSnapshot !== null
              ? buildAmoraFirstUsePromotionSourceSeal({
                  content: persistenceSafeText,
                  grounding: firstUseGrounding,
                  sourceRevision: canonicalJourneyStateRevision,
                  criterionDecisionId:
                    coupleCriterionSnapshot?.decisionId ?? null,
                  privacyEpoch: initialPrivacyEpoch,
                  rosterFingerprint:
                    initialPrivacyContextSnapshot.rosterFingerprint,
                })
              : null;
          const sealsOrdinaryProviderAddActionProposal =
            shouldSealAmoraOrdinaryProviderAddActionProposal({
              pendingAction: pendingExtraction.pendingAction,
              isDurableSharedW0:
                !isDemo
                && requestKind === "chat"
                && visibility === "shared"
                && questionScope.scope === "W0_wedding_core"
                && isDurableUserMessageBound,
              persistenceSourceIsProvider:
                persistenceClaimGuard.source === "provider",
              hasApprovedPendingAction: approvedPendingAction !== null,
              hasFirstUseProvenance:
                isFirstUseSharedDraft
                || firstUsePromotionBinding !== null
                || firstUseApplicationSource !== null,
              scheduleCareDraftStatus: scheduleCareSharedActionDraft.status,
              hasResolvedScheduleCareFollowUp:
                resolvedScheduleCareFollowUp !== null,
              attachmentCount: validatedAttachments.length,
            });
          const metadata: Record<string, unknown> = {
            toolResults: getPersistableToolResults(toolResults),
            toolsUsed,
            senderName: safeSenderName,
            question_scope: questionScope.scope,
            memory_eligible: allowsLongTermMemoryForTurn,
            memory_enqueue_requested: memoryEnqueueRequested,
            ...(requestKind === "mediation"
              && !isDemo
              && mediation !== null
              && mediationDraftPrivacyContextSnapshot !== null
              ? {
                  mediation_draft_state: "draft",
                  mediation_draft_sendable: true,
                  mediation_draft_roster_fingerprint:
                    mediationDraftPrivacyContextSnapshot.rosterFingerprint,
                }
              : {}),
            ...(isListenOnly
              ? { interaction_mode: "listen_only" }
              : {}),
            ...(canonicalJourneyStateRevision !== null
              && requestKind === "chat"
              && !isListenOnly
              && resolvedScheduleCareFollowUp === null
              && (
                questionScope.scope === "W0_wedding_core"
                || questionScope.scope === "W1_wedding_adjacent"
              )
              ? {
                  amora_wedding_context_revision:
                    canonicalJourneyStateRevision,
                  ...(coupleCriterionSnapshot
                    ? {
                        amora_couple_criterion_decision_id:
                          coupleCriterionSnapshot.decisionId,
                      }
                    : {}),
                  ...(firstUseGrounding
                    && !sealsOrdinaryProviderAddActionProposal
                    ? { amora_first_use_grounding: firstUseGrounding }
                    : {}),
                  ...(firstUsePromotionSourceSeal
                    ? {
                        amora_first_use_action_promotion_v1:
                          firstUsePromotionSourceSeal.metadata,
                      }
                    : {}),
                }
              : {}),
            ...(resolvedScheduleCareFollowUp
              ? {
                  [AMORA_SCHEDULE_CARE_FOLLOW_UP_METADATA_KEY]:
                    buildAmoraScheduleCareFollowUpPrivateMetadata(
                      resolvedScheduleCareFollowUp.binding,
                    ),
                  ...(scheduleCareExtraction.draft
                    ? {
                        [AMORA_SCHEDULE_CARE_ACTION_DRAFT_METADATA_KEY]:
                          scheduleCareExtraction.draft,
                      }
                    : {}),
                }
              : {}),
            ...(boundedContinuity
              ? {
                  context_mode: boundedContinuity.mode,
                  context_capabilities: boundedContinuity.capabilities,
                }
              : {}),
            ...(typeof bodyUserMessageId === "string"
              ? { in_reply_to_user_message_id: bodyUserMessageId }
              : {}),
            ...(typeof bodyConfirmedActionId === "string"
              ? { confirmed_amora_action_id: bodyConfirmedActionId }
              : {}),
            ...(visibleClientRequestKey !== clientRequestId
              ? { client_visible_request_id: visibleClientRequestKey }
              : {}),
            ...(suggestions.length > 0 ? { suggestions } : {}),
            ...(mediation ? { mediation } : {}),
            ...(mediationFollowUpSafetyMarker
              ? { mediation_follow_up_safety: mediationFollowUpSafetyMarker }
              : {}),
            ...(pendingExtraction.pendingAction
              ? {
                  pending_amora_action: pendingExtraction.pendingAction,
                  pending_amora_action_journey_revision:
                    canonicalJourneyStateRevision,
                  ...(sealsOrdinaryProviderAddActionProposal
                    ? {
                        [AMORA_ADD_ACTION_PROPOSAL_ORIGIN_METADATA_KEY]:
                          AMORA_ADD_ACTION_PROPOSAL_ORIGIN,
                      }
                    : {}),
                  ...(matchesAmoraFirstUsePendingAction(
                    pendingExtraction.pendingAction,
                    firstUsePromotionBinding,
                  )
                    ? {
                        amora_first_use_promotion_id:
                          firstUsePromotionBinding.promotionId,
                      }
                    : {}),
                  ...(pendingBudgetImpactPreview
                    ? {
                        pending_amora_action_impact_preview:
                          pendingBudgetImpactPreview,
                      }
                    : {}),
                }
              : {}),
            ...(persistenceClaimGuard.removedClaimCount > 0
              ? {
                  persistence_claim_corrected: true,
                  persistence_claim_removed_count:
                    persistenceClaimGuard.removedClaimCount,
                }
              : {}),
            ...(persistenceClaimGuard.source !== "provider"
              ? { persistence_terminal_source: persistenceClaimGuard.source }
              : {}),
          };
          return {
            cleanText,
            persistenceSafeText,
            suggestions,
            pendingExtraction,
            persistenceClaimGuard,
            metadata,
          };
        };

        for (let round = 0; round < AMORA_MAX_TOOL_ROUNDS; round++) {
          // 실시간 스트리밍: 모든 라운드에서 텍스트 토큰을 즉시 클라이언트로 전송
          // tool_use가 발견되면 text_clear로 리셋 후 도구 실행
          const providerCallIndex = round + 1;
          const requestPolicy = getAmoraProviderRequestPolicy(providerCallIndex);
          let preparedTerminal: ReturnType<typeof prepareTerminalResponse> | null = null;
          let atomicFinalization: AtomicAmoraChatResponseFinalization | null = null;
          const resumedCheckpoint = durableToolRoundJournal[round];
          const resumedResult: ChatWithToolsResult | null = resumedCheckpoint
            ? {
              fullText: "",
              toolCalls: resumedCheckpoint.toolCalls.map((toolCall) => ({
                callId: toolCall.callId,
                name: toolCall.name,
                input: toolCall.input,
                ...(toolCall.parseError ? { parseError: toolCall.parseError } : {}),
              })),
              outputItems: resumedCheckpoint.outputItems,
              stopReason: "completed",
              usageStatus: "complete",
            }
            : null;
          if (resumedResult && round === 0) {
            // A journaled provider round can only exist after the original
            // callback reserved the receipt and attempted this exact action.
            // Re-enter its idempotent ledger so the continuation always sees
            // the durable result even when the process crashed afterward.
            await executeApprovedPendingAction();
          }
          if (!resumedResult) paidProviderBoundaryReached = false;
          const result = resumedResult ?? await runAmoraProviderCallWithLedger(
            {
              userId: isDemo ? null : actorId,
              coupleId: isDemo ? null : coupleId,
              requestKey: clientRequestId,
              source: isEvaluation ? "release_eval" : isDemo ? "demo" : "durable",
              sessionId: requestCorrelationId,
              modelRole,
              specialistType,
              callIndex: providerCallIndex,
              phase: "tool_round",
              stageTag,
              providerPrivacyScope:
                !isDemo && !isEvaluation && initialPrivacyEpoch !== null
                  ? { visibility, expectedPrivacyEpoch: initialPrivacyEpoch }
                  : null,
              costGuard: {
                coupleId: quotaSubjectId,
                isAdmin: userProfile?.is_admin === true,
                quotaScope: isEvaluation
                  ? "release_eval"
                  : isDemo
                    ? "demo"
                    : "standard",
                maxCostMicrousd:
                  getAmoraProviderCallCostReservationMicrousd(modelRole),
              },
              onCostReserved: (reservation) => {
                if (
                  typeof reservation.remaining === "number"
                  && reservation.remaining <= 15
                ) {
                  send({ type: "quota", remaining: reservation.remaining });
                }
              },
            },
            async (
              reserveBeforeGeneration,
              reserveBeforeSideEffect,
              authorizeProviderEgress,
            ) => {
              if (approvedPendingAction && round === 0) {
                // Reserve this exact provider receipt before the durable
                // action without marking the paid provider boundary. OpenAI
                // marks that boundary with the shared reservation below.
                await executeApprovedPendingAction(async () => {
                  await assertPrivacyContextStillCurrent();
                  await reserveBeforeSideEffect();
                });
              }

              const providerResult = await chatWithToolsStream({
                systemPrompt,
                input: currentMessages,
                tools: lockToolsAfterPlaceSearch ? [] : availableTools,
                toolChoice: lockToolsAfterPlaceSearch
                  ? undefined
                  : getPlaceSearchToolChoice({
                      userText: lastUserText,
                      round,
                      tools: availableTools,
                }),
                onTextDelta: (token) => {
                  providerPreviewGate?.push(token);
                },
                maxInputTokens: requestPolicy.maxInputTokens,
                maxOutputTokens: requestPolicy.maxOutputTokens,
                // OpenAI counts input tokens before its paid generation hook,
                // and that count carries the full prompt. Fence every provider
                // request on the privacy context, not just the billed one; the
                // hook below repeats the check after counting and before the
                // reservation.
                beforeProviderEgress: async (request) => {
                  await assertPrivacyContextStillCurrent();
                  await authorizeProviderEgress(request);
                },
                beforeGeneration: async () => {
                  await assertPrivacyContextStillCurrent();
                  await reserveBeforeGeneration();
                  paidProviderBoundaryReached = true;
                },
                modelRole,
                safetyIdentifierScope,
                signal: toolExecutionCompleted
                  ? deadlineAbortController.signal
                  : preMutationAbortController.signal,
              });
              // Consent, roster, reset, or personalization may change while
              // the provider is generating. Recheck after the paid boundary
              // and before the ledger can atomically persist/display a reply
              // or let a model-requested tool proceed.
              await assertPrivacyContextStillCurrent();
              return providerResult;
            },
            {
              buildAtomicChatResponse: (providerResult) => {
                if (providerResult.toolCalls.length > 0) return null;
                const terminal = prepareTerminalResponse(providerResult.fullText);
                preparedTerminal = terminal;
                if (isDemo) return null;
                if (requestClaimAttemptCount === null) {
                  throw new ChatRequestClaimError(
                    "Terminal response claim generation was missing",
                  );
                }
                if (initialPrivacyEpoch === null) {
                  throw new AmoraPrivacyContextError(
                    "AMORA_PRIVACY_CONTEXT_UNAVAILABLE",
                  );
                }
                return {
                  coupleId,
                  userId: actorId,
                  requestKey: clientRequestId,
                  visibility,
                  claimAttemptCount: requestClaimAttemptCount,
                  expectedPrivacyEpoch: initialPrivacyEpoch,
                  content: terminal.persistenceSafeText,
                  metadata: terminal.metadata,
                  stageTag,
                  specialistType,
                };
              },
              buildToolRoundCheckpoint: (providerResult) => {
                if (isDemo || providerResult.toolCalls.length === 0) return null;
                if (requestClaimAttemptCount === null) {
                  throw new ChatRequestClaimError(
                    "Tool-round checkpoint claim generation was missing",
                  );
                }
                return {
                  coupleId,
                  requestKey: clientRequestId,
                  claimAttemptCount: requestClaimAttemptCount,
                  checkpoint: buildAmoraToolRoundCheckpoint(
                    providerCallIndex,
                    providerResult,
                  ),
                };
              },
              onAtomicChatResponseFinalized: (finalization) => {
                atomicFinalization = finalization;
              },
            },
          );

          // tool use가 없으면 최종 응답 (이미 토큰별로 스트리밍됨)
          if (result.toolCalls.length === 0) {
            const terminal = preparedTerminal as
              ReturnType<typeof prepareTerminalResponse> | null;
            if (!terminal) {
              throw new AiMessagePersistenceError(
                "Terminal AI response was not prepared",
              );
            }
            const {
              persistenceSafeText,
              suggestions,
              pendingExtraction,
              persistenceClaimGuard,
              metadata,
            } = terminal;

            let committedMessage: PersistedAiMessage | null = null;
            if (!isDemo) {
              const committed = atomicFinalization as
                AtomicAmoraChatResponseFinalization | null;
              if (committed?.outcome === "privacy_context_changed") {
                requestClaimAcquired = false;
                requestClaimAttemptCount = null;
                throw new AmoraPrivacyContextError(
                  "AMORA_PRIVACY_CONTEXT_CHANGED",
                );
              }
              if (committed?.outcome !== "persisted" || !committed.message?.id) {
                throw new AiMessagePersistenceError(
                  "Atomic terminal AI response was not committed",
                );
              }
              committedMessage = committed.message;
              requestClaimAcquired = false;
              requestClaimAttemptCount = null;
            }

            // 서버 사이드 INSERT (with 10s idempotency)
            // 모바일 retry / 중복 fetch 시 동일 내용을 또 INSERT하지 않음.
            let insertResult: PersistedAiMessage;
            if (isDemo) {
              insertResult = await persistAiMessage({
                isDemo: true,
                coupleId,
                cleanText: persistenceSafeText,
                clientRequestId,
                metadata,
                stageTag,
                specialistType,
                visibility,
              });
            } else {
              if (!committedMessage) {
                throw new AiMessagePersistenceError(
                  "Atomic terminal AI response was not committed",
                );
              }
              insertResult = committedMessage;
            }
            if (
              !isDemo
              && insertResult.id
              && memoryEnqueueRequested
            ) {
              const memoryReconciliation =
                await reconcilePersistedAmoraMemoryEnqueue({
                  coupleId,
                  userId: actorId,
                  expectedVisibility: visibility,
                  message: insertResult,
                });
              if (memoryReconciliation.status === "retry_required") {
                throw new AmoraMemoryEnqueueRetryError();
              }
              if (
                memoryReconciliation.status !== "reconciled"
                && memoryReconciliation.status !== "repair_queued"
              ) {
                throw new AiMessagePersistenceError(
                  "Eligible memory metadata was not persisted safely",
                );
              }
            }

            // Tool cards, terminal text, and suggestions form one success
            // release. Keep all of them invisible until both the atomic
            // privacy commit and the durable memory handoff are confirmed.
            // Revalidate the authenticated scalar epoch after the awaited
            // handoff so a consent/reset race cannot release stored context.
            await assertStoredContextTerminalReleasePrivacyEpochCurrent();
            if (insertResult.reused) {
              send({ type: "text_clear" });
              const storedSuggestions = requestKind === "mediation" || isListenOnly
                ? []
                : getStoredSuggestions(insertResult);
              if (storedSuggestions.length > 0) {
                send({ type: "suggestions", suggestions: storedSuggestions });
              }
            } else {
              releaseSensitiveToolEvents();
              if (
                pendingExtraction.hadPendingActionTag
                || persistenceClaimGuard.corrected
                || shouldBufferProviderText
                || suggestions.length > 0
                || !providerPreviewGate?.matchesTerminal(persistenceSafeText)
              ) {
                // Provider tokens may already have contained a private marker
                // or unsupported persistence claim. Replace the draft only at
                // the final success boundary.
                send({ type: "text_clear" });
                if (persistenceSafeText) {
                  send({ type: "text_delta", content: persistenceSafeText });
                }
              }
              if (suggestions.length > 0) {
                send({ type: "suggestions", suggestions });
              }
            }

            send({
              type: "done",
              fullContent: insertResult.content ?? persistenceSafeText,
              metadata: getDoneMetadata(
                insertResult,
                requestKind === "mediation" || isListenOnly,
              ),
            });

            if (insertResult.reused) {
              closeStream();
              return;
            }

            // D1: 성공 turn 로깅 (fire-and-forget)
            if (!isDemo) void logAIInteraction({
              userId: actorId,
              coupleId,
              interactionType: "chat_turn",
              specialistType,
              userInput: null,
              aiOutput: null,
              latencyMs: elapsedMs(turnStartedAt),
              success: true,
              model: null,
              tokensInput: null,
              tokensOutput: null,
              cacheCreationTokens: null,
              cacheReadTokens: null,
              costUsd: null,
              metadata: {
                visibility,
                stage_tag: stageTag,
                question_scope: questionScope.scope,
                ...(isListenOnly
                  ? { interaction_mode: "listen_only" }
                  : {}),
                ...(boundedContinuity
                  ? { context_mode: boundedContinuity.mode }
                  : {}),
                tools_used: toolsUsed,
                tool_rounds: round + 1,
                correction_count: correctionCount,
                // 사전 토큰 계산을 건너뛴 턴이면 사유가 남는다. 이 값이 없으면
                // 제공자 장애로 채팅이 죽어도 원인을 원장에서 볼 수 없다
                // (2026-07-25 실제로 그래서 진단이 오래 걸렸다).
                input_count_unavailable: result.inputCountUnavailableReason ?? null,
              },
            });

            closeStream();
            return;
          }

          // tool use 감지 → 스트리밍된 텍스트 클리어 후 도구 실행
          sendSensitiveToolEvent({ type: "text_clear" });

          // UI 카드로 자동 렌더링되는 도구 목록
          const UI_RENDERED_TOOLS = new Set([
            "search_vendors", "recommend_vendors", "get_vendor_detail",
            "get_available_slots", "create_booking", "cancel_booking", "search_nearby_places",
            "analyze_quote", "simulate_guest_guarantee",
          ]);

          const toolResultInputs: ChatInputItem[] = [];
          const rejectToolCall = (
            callId: string,
            toolName: string,
            errorCode: string,
            error: string,
          ) => {
            const rejectedResult = JSON.stringify({
              success: false,
              error_code: errorCode,
              error,
            });
            sendSensitiveToolEvent({
              type: "tool_result",
              result: {
                toolName,
                toolInput: {},
                toolOutput: JSON.parse(rejectedResult),
                success: false,
              },
            });
            toolResultInputs.push(
              buildToolResultInput(callId, rejectedResult),
            );
          };
          for (const toolUse of result.toolCalls) {
            toolCallCount += 1;
            if (toolCallCount > AMORA_MAX_TOOL_CALLS_PER_TURN) {
              const limitOutput = JSON.stringify({
                success: false,
                error_code: "TOOL_CALL_LIMIT_REACHED",
                error: "이 요청에서 실행할 수 있는 도구 수를 초과했습니다. 지금까지의 결과만 정리하세요.",
              });
              sendSensitiveToolEvent({
                type: "tool_result",
                result: {
                  toolName: toolUse.name,
                  toolInput: {},
                  toolOutput: JSON.parse(limitOutput),
                  success: false,
                },
              });
              toolResultInputs.push(buildToolResultInput(toolUse.callId, limitOutput));
              continue;
            }
            if (!toolExecutionCompleted && turnAbortController.signal.aborted) {
              throw new DOMException("Chat request aborted before tool execution", "AbortError");
            }

            // 승인된 변경은 위의 executeApprovedPendingAction 서버 경로에서만
            // 정확히 한 번 실행한다. provider 출력과 재개 journal은 W0에서도
            // 변경 도구를 직접 실행할 수 없다.
            if (isMutatingTool(toolUse.name)) {
              rejectToolCall(
                toolUse.callId,
                toolUse.name,
                "MODEL_MUTATION_TOOL_BLOCKED",
                "변경 도구는 서버가 확인한 액션 경로에서만 실행할 수 있습니다.",
              );
              continue;
            }

            // Provider output and a resumed journal are both untrusted at the
            // execution boundary. Even if either contains a tool that was not
            // offered this turn, the deterministic question scope remains the
            // absolute upper bound.
            if (!questionScopeToolNameCeiling.has(toolUse.name)) {
              rejectToolCall(
                toolUse.callId,
                toolUse.name,
                "QUESTION_SCOPE_TOOL_BLOCKED",
                "이 질문 범위에서는 해당 도구를 실행할 수 없습니다. 현재 범위 안에서만 답하세요.",
              );
              continue;
            }

            // Intent policy may be narrower than W0/W1. It is also recomputed
            // on a reclaimed request, so an older checkpoint cannot preserve
            // authority that the current policy no longer grants. After an
            // ephemeral place search, later rounds intentionally have no tools.
            if (
              lockToolsAfterPlaceSearch
              || !availableToolNameSet.has(toolUse.name)
            ) {
              rejectToolCall(
                toolUse.callId,
                toolUse.name,
                "TOOL_NOT_AVAILABLE_FOR_TURN",
                "이 요청의 현재 도구 계약에는 해당 도구가 없습니다.",
              );
              continue;
            }

            if (toolUse.parseError) {
              const invalidResult = JSON.stringify({
                success: false,
                error_code: "INVALID_TOOL_INPUT",
                error: "도구 입력 형식이 올바르지 않습니다. 정의된 스키마에 맞게 다시 시도하세요.",
              });
              sendSensitiveToolEvent({
                type: "tool_result",
                result: {
                  toolName: toolUse.name,
                  toolInput: {},
                  toolOutput: JSON.parse(invalidResult),
                  success: false,
                },
              });
              toolResultInputs.push(buildToolResultInput(toolUse.callId, invalidResult));
              continue;
            }

            if (
              toolUse.name === "analyze_quote"
              && quoteAnalysisSelection.status === "invalid"
            ) {
              rejectToolCall(
                toolUse.callId,
                toolUse.name,
                "INVALID_QUOTE_ANALYSIS_SELECTION",
                "견적 항목 선택 원문 형식이 올바르지 않습니다. 체크리스트에서 다시 선택해 주세요.",
              );
              continue;
            }

            toolsUsed.push(toolUse.name);
            const executableToolInput = toolUse.name === "analyze_quote"
              ? bindCanonicalQuoteAnalysisInput(
                  toolUse.input as Record<string, unknown>,
                  quoteAnalysisSelection,
                )
              : toolUse.input;

            sendSensitiveToolEvent({
              type: "tool_start",
              toolName: toolUse.name,
              toolInput: getClientSafeToolInput(toolUse.name, executableToolInput),
            });
            const execResult = await executeTool(toolUse.name, executableToolInput, {
              ...executionContext,
              providerCallIndex,
            });
            // 조회 도구는 연결 종료 시 즉시 중단할 수 있다. 변경 도구만 이미
            // 커밋되었을 가능성이 있으므로 응답/원장을 끝까지 확정한다.
            if (isMutatingTool(toolUse.name)) toolExecutionCompleted = true;
            toolResults.push(execResult);
            sendSensitiveToolEvent({
              type: "tool_result",
              result: getClientSafeToolResult(execResult),
            });
            // UI 카드로 렌더링되는 도구는 텍스트 중복 방지 리마인더 추가
            const reminder = UI_RENDERED_TOOLS.has(toolUse.name)
              ? "\n[SYSTEM: 이 결과는 프론트엔드에서 인터랙티브 카드/버튼으로 자동 표시됩니다. 텍스트 응답에서 업체 목록, 상품 목록, 시간표, 가격표를 절대 나열하지 마세요. 간단한 안내 1~2문장만 작성하세요.]"
              : "";
            const perToolFeedbackBudget = Math.floor(
              AMORA_MAX_TOOL_FEEDBACK_CHARS_PER_TURN / AMORA_MAX_TOOL_CALLS_PER_TURN,
            );
            const outputJson = boundAmoraToolResultJson(
              getModelSafeToolOutput(execResult),
              Math.min(
                AMORA_MAX_TOOL_RESULT_CHARS,
                perToolFeedbackBudget - reminder.length,
              ),
            );
            toolResultInputs.push(
              buildToolResultInput(toolUse.callId, outputJson + reminder)
            );
          }

          if (hasEphemeralPlaceSearchResult(toolResults)) {
            // NAVER output is untrusted, display-only content. Later rounds get
            // neither that content nor mutation tools.
            lockToolsAfterPlaceSearch = true;
          }

          // store:false이므로 reasoning(암호화 content 포함), assistant message,
          // function_call 원본과 function_call_output을 모두 다음 요청에 재전송한다.
          currentMessages = [
            ...currentMessages,
            ...result.outputItems,
            ...toolResultInputs,
          ];
        }

        // 최대 라운드 초과 시 마지막 호출 (역시 실시간 스트리밍)
        const finalCallIndex = AMORA_MAX_TOOL_ROUNDS + 1;
        const finalRequestPolicy = getAmoraProviderRequestPolicy(finalCallIndex);
        let preparedFinalTerminal: ReturnType<typeof prepareTerminalResponse> | null = null;
        let atomicFinalization2: AtomicAmoraChatResponseFinalization | null = null;
        paidProviderBoundaryReached = false;
        await runAmoraProviderCallWithLedger(
          {
            userId: isDemo ? null : actorId,
            coupleId: isDemo ? null : coupleId,
            requestKey: clientRequestId,
            source: isEvaluation ? "release_eval" : isDemo ? "demo" : "durable",
            sessionId: requestCorrelationId,
            modelRole,
            specialistType,
            callIndex: finalCallIndex,
            phase: "final_no_tool",
            stageTag,
            providerPrivacyScope:
              !isDemo && !isEvaluation && initialPrivacyEpoch !== null
                ? { visibility, expectedPrivacyEpoch: initialPrivacyEpoch }
                : null,
            costGuard: {
              coupleId: quotaSubjectId,
              isAdmin: userProfile?.is_admin === true,
              quotaScope: isEvaluation
                ? "release_eval"
                : isDemo
                  ? "demo"
                  : "standard",
              maxCostMicrousd:
                getAmoraProviderCallCostReservationMicrousd(modelRole),
            },
            onCostReserved: (reservation) => {
              if (
                typeof reservation.remaining === "number"
                && reservation.remaining <= 15
              ) {
                send({ type: "quota", remaining: reservation.remaining });
              }
            },
          },
          async (
            reserveBeforeGeneration,
            _reserveBeforeSideEffect,
            authorizeProviderEgress,
          ) => {
            const providerResult = await chatWithToolsStream({
              systemPrompt: noToolSystemPrompt,
              input: currentMessages,
              // 최대 도구 라운드 이후에는 새 mutation 요청을 받지 않고 기존 결과를
              // 사용자용 문장으로 정리하게 한다.
              tools: [],
              onTextDelta: (token) => {
                providerPreviewGate?.push(token);
              },
              maxInputTokens: finalRequestPolicy.maxInputTokens,
              maxOutputTokens: finalRequestPolicy.maxOutputTokens,
              // Fences OpenAI's input-token count, which precedes the paid
              // generation hook and already carries the full prompt.
              beforeProviderEgress: async (request) => {
                await assertPrivacyContextStillCurrent();
                await authorizeProviderEgress(request);
              },
              beforeGeneration: async () => {
                await assertPrivacyContextStillCurrent();
                await reserveBeforeGeneration();
                paidProviderBoundaryReached = true;
              },
              modelRole,
              safetyIdentifierScope,
              signal: toolExecutionCompleted
                ? deadlineAbortController.signal
                : preMutationAbortController.signal,
            });
            await assertPrivacyContextStillCurrent();
            return providerResult;
          },
          {
            buildAtomicChatResponse: (providerResult) => {
              const terminal = prepareTerminalResponse(providerResult.fullText);
              preparedFinalTerminal = terminal;
              if (isDemo) return null;
              if (requestClaimAttemptCount === null) {
                throw new ChatRequestClaimError(
                  "Final response claim generation was missing",
                );
              }
              if (initialPrivacyEpoch === null) {
                throw new AmoraPrivacyContextError(
                  "AMORA_PRIVACY_CONTEXT_UNAVAILABLE",
                );
              }
              return {
                coupleId,
                userId: actorId,
                requestKey: clientRequestId,
                visibility,
                claimAttemptCount: requestClaimAttemptCount,
                expectedPrivacyEpoch: initialPrivacyEpoch,
                content: terminal.persistenceSafeText,
                metadata: terminal.metadata,
                stageTag,
                specialistType,
              };
            },
            onAtomicChatResponseFinalized: (finalization) => {
              atomicFinalization2 = finalization;
            },
          },
        );

        const finalTerminal = preparedFinalTerminal as
          ReturnType<typeof prepareTerminalResponse> | null;
        if (!finalTerminal) {
          throw new AiMessagePersistenceError(
            "Final terminal AI response was not prepared",
          );
        }
        const {
          persistenceSafeText: finalPersistenceSafeText,
          suggestions,
          pendingExtraction: pendingExtraction2,
          persistenceClaimGuard: finalPersistenceClaimGuard,
          metadata: finalMetadata,
        } = finalTerminal;

        let committedFinalMessage: PersistedAiMessage | null = null;
        if (!isDemo) {
          const committed = atomicFinalization2 as
            AtomicAmoraChatResponseFinalization | null;
          if (committed?.outcome === "privacy_context_changed") {
            requestClaimAcquired = false;
            requestClaimAttemptCount = null;
            throw new AmoraPrivacyContextError(
              "AMORA_PRIVACY_CONTEXT_CHANGED",
            );
          }
          if (committed?.outcome !== "persisted" || !committed.message?.id) {
            throw new AiMessagePersistenceError(
              "Atomic final AI response was not committed",
            );
          }
          committedFinalMessage = committed.message;
          requestClaimAcquired = false;
          requestClaimAttemptCount = null;
        }

        // 서버 사이드 INSERT (MAX_TOOL_ROUNDS 초과 분기 — idempotency 포함)
        let insertResult2: PersistedAiMessage;
        if (isDemo) {
          insertResult2 = await persistAiMessage({
            isDemo: true,
            coupleId,
            cleanText: finalPersistenceSafeText,
            clientRequestId,
            metadata: finalMetadata,
            stageTag,
            specialistType,
            visibility,
          });
        } else {
          if (!committedFinalMessage) {
            throw new AiMessagePersistenceError(
              "Atomic final AI response was not committed",
            );
          }
          insertResult2 = committedFinalMessage;
        }

        if (
          !isDemo
          && insertResult2.id
          && memoryEnqueueRequested
        ) {
          const memoryReconciliation =
            await reconcilePersistedAmoraMemoryEnqueue({
              coupleId,
              userId: actorId,
              expectedVisibility: visibility,
              message: insertResult2,
            });
          if (memoryReconciliation.status === "retry_required") {
            throw new AmoraMemoryEnqueueRetryError();
          }
          if (
            memoryReconciliation.status !== "reconciled"
            && memoryReconciliation.status !== "repair_queued"
          ) {
            throw new AiMessagePersistenceError(
              "Eligible memory metadata was not persisted safely",
            );
          }
        }

        // MAX_TOOL_ROUNDS completion uses the exact same atomic privacy and
        // durable memory success boundary as the normal terminal branch.
        await assertStoredContextTerminalReleasePrivacyEpochCurrent();
        if (insertResult2.reused) {
          send({ type: "text_clear" });
          const storedSuggestions = requestKind === "mediation" || isListenOnly
            ? []
            : getStoredSuggestions(insertResult2);
          if (storedSuggestions.length > 0) {
            send({ type: "suggestions", suggestions: storedSuggestions });
          }
        } else {
          releaseSensitiveToolEvents();
          if (
            pendingExtraction2.hadPendingActionTag
            || finalPersistenceClaimGuard.corrected
            || shouldBufferProviderText
            || suggestions.length > 0
            || !providerPreviewGate?.matchesTerminal(finalPersistenceSafeText)
          ) {
            send({ type: "text_clear" });
            if (finalPersistenceSafeText) {
              send({ type: "text_delta", content: finalPersistenceSafeText });
            }
          }
          if (suggestions.length > 0) {
            send({ type: "suggestions", suggestions });
          }
        }

        send({
          type: "done",
          fullContent: insertResult2.content ?? finalPersistenceSafeText,
          metadata: getDoneMetadata(
            insertResult2,
            requestKind === "mediation" || isListenOnly,
          ),
        });

        if (insertResult2.reused) {
          closeStream();
          return;
        }

        // D1: MAX_TOOL_ROUNDS 초과 후 성공 turn 로깅 (fire-and-forget)
        if (!isDemo) void logAIInteraction({
          userId: actorId,
          coupleId,
          interactionType: "chat_turn",
          specialistType,
          userInput: null,
          aiOutput: null,
          latencyMs: elapsedMs(turnStartedAt),
          success: true,
          model: null,
          tokensInput: null,
          tokensOutput: null,
          cacheCreationTokens: null,
          cacheReadTokens: null,
          costUsd: null,
          metadata: {
            visibility,
            stage_tag: stageTag,
            question_scope: questionScope.scope,
            ...(isListenOnly
              ? { interaction_mode: "listen_only" }
              : {}),
            ...(boundedContinuity
              ? { context_mode: boundedContinuity.mode }
              : {}),
            tools_used: toolsUsed,
            tool_rounds: AMORA_MAX_TOOL_ROUNDS,
            exceeded_max_rounds: true,
            correction_count: correctionCount,
          },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const inputStreamError = getAmoraInputStreamError(err);
        const privacyContextErrorCode =
          getAmoraPrivacyContextErrorCode(err);
        const costGuardError = err instanceof AmoraCostGuardError ? err : null;
        const memoryEnqueueError =
          err instanceof AmoraMemoryEnqueueRetryError ? err : null;
        const durableErrorCode =
          err instanceof AiMessagePersistenceError || err instanceof ChatRequestClaimError
            ? err.code
            : null;
        const publicErrorCode =
          durableErrorCode
          ?? memoryEnqueueError?.code
          ?? privacyContextErrorCode
          ?? costGuardError?.code
          ?? inputStreamError?.code;
        // The immutable request key may only be replayed when the failed
        // provider attempt never crossed its paid generation boundary (or
        // when replay is the explicit durable memory-repair path). Once a
        // receipt can be settled/unknown, force a new user message instead of
        // offering an exact-key retry loop that can never make progress.
        const exactRetryAllowed = Boolean(
          memoryEnqueueError
          || costGuardError
          || (
            !paidProviderBoundaryReached
            && !toolExecutionCompleted
            && inputStreamError?.code !== "AMORA_INPUT_TOO_LARGE"
            && inputStreamError?.code !== "AMORA_PROVIDER_UNAVAILABLE"
          )
        );
        console.error("채팅 API 에러:", errMsg);
        if (requestClaimAcquired) {
          await failChatRequest({
            ...claimParams,
            failureCode: publicErrorCode ?? "CHAT_TURN_FAILED",
          }).catch((claimError) => {
            console.error("[chat] durable request failure marker failed", claimError);
          });
          requestClaimAcquired = false;
        }
        // 내부 에러 원문(모델명·스택·DB 제약 등)을 클라이언트에 노출하지 않는다.
        // 이미 일부 토큰이 보였다면 실패한 초안을 확정 답변처럼 남기지 않는다.
        send({ type: "text_clear" });
        send({
          type: "error",
          code: publicErrorCode,
          retryable: exactRetryAllowed,
          retryPolicy: exactRetryAllowed ? "same_request" : "new_message",
          message: memoryEnqueueError
            ? "답변은 저장됐지만 장기 기억 반영을 확인하지 못했어요. 같은 요청으로 다시 시도해주세요."
            : !exactRetryAllowed
              ? inputStreamError
                && (inputStreamError.code === "AMORA_INPUT_TOO_LARGE"
                  || inputStreamError.code === "AMORA_PROVIDER_UNAVAILABLE")
                ? inputStreamError.message
                : privacyContextErrorCode
                  ? "개인정보 설정이 변경되었거나 안전하게 확인되지 않았어요. 최신 설정에서 새 메시지로 다시 보내주세요."
                  : "이 요청은 같은 식별자로 다시 이어갈 수 없어요. 새 메시지로 다시 보내주세요."
            : durableErrorCode
            ? "답변 저장을 완료하지 못했어요. 같은 요청으로 다시 시도해주세요."
            : privacyContextErrorCode
              ? "개인정보 설정이 변경되었거나 안전하게 확인되지 않았어요. 최신 설정으로 다시 시도해주세요."
            : costGuardError
              ? costGuardError.result.message ?? "아모라 사용량을 확인하지 못했어요. 잠시 후 다시 시도해주세요."
            : inputStreamError
              ? inputStreamError.message
              : errMsg.toLowerCase().includes("timeout") || errMsg.toLowerCase().includes("abort")
              ? "응답 시간이 초과되었습니다. 다시 시도해주세요."
              : "AI 응답 생성에 실패했어요. 잠시 후 다시 시도해주세요.",
        });

        // D1: 실패 turn 로깅 (fire-and-forget)
        if (!isDemo) void logAIInteraction({
          userId: actorId,
          coupleId,
          interactionType: "chat_turn",
          specialistType,
          userInput: null,
          aiOutput: null,
          latencyMs: elapsedMs(turnStartedAt),
          success: false,
          errorMessage: publicErrorCode ?? "CHAT_TURN_FAILED",
          model: null,
          tokensInput: null,
          tokensOutput: null,
          cacheCreationTokens: null,
          cacheReadTokens: null,
          costUsd: null,
          metadata: {
            visibility,
            stage_tag: stageTag,
            question_scope: questionScope.scope,
            ...(isListenOnly
              ? { interaction_mode: "listen_only" }
              : {}),
            ...(boundedContinuity
              ? { context_mode: boundedContinuity.mode }
              : {}),
          },
        });
      }

      closeStream();
    },
    cancel() {
      if (!toolExecutionCompleted) clearTimeout(deadlineTimer);
      abortBeforeDurableTool();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
