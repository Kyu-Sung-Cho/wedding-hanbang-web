import { asksWhereToStart } from "@/lib/marketing/preparationPriorities";
import { resolveAmoraPreparationSource } from "@/lib/amora/preparationHandoff";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildFirstHelloContextTurn } from "@/lib/ai/firstHelloContext";
import { compareChatTimestamps, normalizePreparationStatus } from "@hanbang/shared";
import {
  PARTNER_TARGET_SUFFIX,
  speakerLabelFor,
} from "@/lib/ai/speakerLabels";
import {
  buildMultimodalContent,
  buildToolResultInput,
  chatWithToolsStream,
  normalizeOpenAIProviderError,
  OpenAIProviderError,
} from "@/lib/ai/openai";
import type { ChatInputItem, ImageAttachment } from "@/lib/ai/openai";
import type { ChatWithToolsResult } from "@/lib/ai/openai";
import { chooseAmoraChatModelRole } from "@/lib/ai/modelConfig";
import { getAmoraPlanningTurn } from "@/lib/ai/amoraPlanningTurn";
import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
  type AmoraActionContract,
} from "@/lib/ai/amoraPromptComposer";
import { AMORA_EVAL_HEADER, verifyAmoraEvalToken } from "@/lib/ai/amoraEvalAuth";
import { saveAutomaticDissatisfaction } from "@/lib/ai/automaticFeedback";
import { shouldRescueChecklistScope } from "@/lib/ai/amoraChecklistScopeRescue";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import {
  getAvailableChatTools,
  getPlaceSearchToolChoice,
  isPlaceSearchCandidate,
  PLACE_SEARCH_TOOL_NAME,
} from "@/lib/ai/placeSearchRouting";
import {
  getClientSafeToolInput,
  getClientSafeToolResult,
  getModelSafeToolOutput,
  getPersistableToolResults,
  hasEphemeralPlaceSearchResult,
} from "@/lib/ai/placeSearchResultPolicy";
import { executeTool } from "@/lib/ai/toolExecutor";
import { getPersonalActionDraftToolChoice, personalActionConversationConsent, personalActionConversationMetadata, selectPersonalActionConversationTools } from "@/lib/ai/amoraPersonalActionConversation";
import { readPersonalActionConversationCount } from "@/lib/amora/personalActionConversationRead";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import { stripAmoraReasoningPreamble } from "@/lib/ai/amoraReasoningLeak";
import {
  applyAmoraOutputHygiene,
  ensureNonEmptyTerminalText,
  type AmoraOutputHygieneAction,
} from "@/lib/ai/amoraOutputHygiene";
import { extractSuggestions } from "@/lib/ai/chatSuggestions";
import { detectDissatisfaction } from "@/lib/ai/dissatisfaction";
import { composeAmoraPersistenceTerminal,
  isExplicitAmoraChangeRequest,
} from "@/lib/ai/amoraPersistenceClaims";
import { createAmoraProviderPreviewGate } from "@/lib/ai/amoraProviderPreviewGate";
import {
  determineStage,
  matchedSpecialistByKeyword,
  routeSpecialist,
} from "@/lib/ai/stage-router";
import { logAIInteractionAfterResponse, startLatencyClock, elapsedMs } from "@/lib/compliance/ai-log";
import {
  extractMediation,
  mediationBlockToOrdinaryText,
  toUserRequestedMediationV2,
} from "@/lib/ai/mediation";
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
  collectAmoraChecklistLabels,
  AMORA_CHECKLIST_STATE_VERB,
} from "@/lib/ai/amoraToolPolicy";
import {
  classifyAmoraQuestionScope,
  hasAmoraSafetySignal,
  filterAmoraToolsByQuestionScope,
  type AmoraQuestionScopeClassification,
} from "@/lib/ai/amoraQuestionScope";
import {
  buildAmoraBoundedContinuity,
  canAttemptAmoraBoundedContinuity,
} from "@/lib/ai/amoraBoundedContinuity";
import {
  isAmoraClarificationAnswerShaped,
  resolveAmoraWeddingClarificationContinuity,
} from "@/lib/ai/amoraClarificationContinuity";
import { selectAmoraTrustedHistoryRows } from "@/lib/ai/amoraTrustedHistory";
import { appendAmoraToolResultHistory, appendAmoraBoundedToolResultHistory } from "@/lib/ai/amoraToolResultHistory";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { isPlaceSearchConfigured } from "@/lib/ai/tools/placeSearchTools";
import { getAmoraActionApprovalPolicy } from "@/lib/ai/amoraActionApprovalPolicy";
import {
  buildAmoraApprovedActionPrompt,
  buildAmoraPendingActionPrompt,
  buildAmoraHistoryContent,
  isAmoraFailedProposalNotice,
  extractAmoraPendingAction,
  resolveAmoraPendingAction,
  describeUnconfirmedAmoraPendingAction,
  describeAmoraQueuedAction,
} from "@/lib/ai/amoraPendingAction";
import {
  advanceAmoraActionQueue,
  createAmoraActionQueue,
  resolveAmoraActionQueue,
  type AmoraActionQueue,
} from "@/lib/ai/amoraActionQueue";
import { buildAmoraBudgetImpactPreview } from "@/lib/ai/amoraBudgetImpactPreview";
import { parseExplicitBudgetPlanRequest } from "@/lib/ai/amoraExplicitBudgetPlan";
import { parseExplicitScheduleRequest } from "@/lib/ai/amoraExplicitScheduleRequest";
import { assessExplicitTaskRequest } from "@/lib/ai/amoraExplicitTaskRequest";
import { getUnsupportedScheduleFieldsReply } from "@/lib/ai/amoraUnsupportedScheduleFields";
import { assessAmoraBudgetChange } from "@/lib/ai/amoraBudgetChangeAssessment";
import { assessCurrentStoredStateRequest, formatCurrentStoredStateSummary, getRequiredCurrentStoredStateReads } from "@/lib/ai/amoraCurrentStoredStateSummary";
import { getSharedPersonalActionNavigationReply } from "@/lib/ai/amoraPersonalActionNavigation";
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
import { buildAmoraInitialGreetingRequestKey } from "@/lib/ai/amoraInitialGreetingKey";
import type { ToolExecutionResult } from "@/types/database.types";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isAmoraTestUser } from "@/lib/ai/amoraTestAccess";
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
import { createHash, randomUUID } from "node:crypto";
import {
  dropOutdatedTruthlessDecisions,
  isSupersededDecision,
} from "@/lib/ai/supersededDecisions";
import { inspectScheduleEvents } from "@/utils/scheduleEvents";
import { log } from "@/utils/log";
// mammoth는 필요할 때만 동적 import (Vercel 호환성)

// Vercel Pro: 최대 300초 (5분)
export const maxDuration = 300;

const MAX_EXTRACTED_TEXT_CHARS = 80_000;
const MAX_DOCX_EXTRACTED_TEXT_CHARS = 200_000;
const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;
/**
 * canonical `chat_messages` 창 크기(행 수).
 *
 * 2026-09-03: 40 → 120. 40행은 사용자·아모라를 합친 수라 약 20턴이고, 22턴 전에
 * 만든 예산 배분표를 아모라가 "대화에 남아 있지 않다"고 답했다(2차 감사 Turn 29).
 * provider 입력의 실제 경계는 행 수가 아니라 문자 상한
 * (`AMORA_MAX_CONVERSATION_CHARS` 32,000, 아래 `takeRecentAmoraConversation`)과
 * exact-token 상한이 지고 있으므로 행 수를 올려도 입력 상한은 그대로다.
 * 안전 필터(`selectAmoraTrustedHistoryRows`)는 행마다 그대로 돈다. 다만 그 필터가
 * 통과시키는 범위는 2026-09-03 부터 W0·W1·**W4** 다 — 같은 대화의 사실이 그 문장에
 * 결혼 낱말이 없다는 이유만으로 이력에서 영구히 지워지던 결함을 고치면서 바뀌었다
 * (근거는 `amoraTrustedHistory.ts` 의 `isTrustedHistoryScope`). 안전 축인 W2·W3·W5
 * 행은 창이 넓어져도 한 건도 들어오지 않는다.
 */
const MAX_CONTEXT_MESSAGES = 120;
/**
 * 클라이언트가 한 요청에 실어 보낼 수 있는 메시지 수.
 *
 * 예전에는 `MAX_CONTEXT_MESSAGES` 를 그대로 썼다. 창을 넓히면서 분리했다 —
 * 서버가 DB 에서 더 읽는 것과 클라이언트가 더 보내도 되는 것은 다른 문제이고,
 * 입력 경계는 넓힐 이유가 없다(클라이언트 이력은 prompt source 로 쓰이지 않는다).
 */
const MAX_CLIENT_REQUEST_MESSAGES = 40;
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

const CHAT_LOG_PROVIDER_CATEGORIES = new Set<string>([
  "auth_config", "rate_limit", "timeout", "aborted", "invalid_request",
  "provider_5xx", "incomplete_max_output", "refusal", "transport", "response_invalid",
]);
const CHAT_LOG_PROVIDER_CODES = new Set<string>([
  "openai_not_enabled", "input_token_limit", "invalid_input_token_count",
  "invalid_tool_name", "invalid_tool_schema", "forced_tool_unavailable", "prompt_cache_disabled",
  "invalid_function_call_status", "invalid_function_call_id", "invalid_function_call_name",
  "duplicate_function_call_id", "too_many_function_calls", "missing_completed_response",
  "empty_response", "model_refusal", "max_output_tokens", "incomplete",
  "response_failed", "stream_error", "rate_limit_exceeded", "server_error",
]);

function safeChatFailureLogError(error: unknown): Error {
  // 정규화는 일반 오류도 transport로 분류한다. 원래 typed 경계만 진단에 사용한다.
  try {
    if (error instanceof OpenAIProviderError) {
      const suppliedCategory = error.category;
      const suppliedCode = error.providerCode;
      const category = typeof suppliedCategory === "string" && CHAT_LOG_PROVIDER_CATEGORIES.has(suppliedCategory)
        ? suppliedCategory : "unknown";
      const code = typeof suppliedCode === "string" && CHAT_LOG_PROVIDER_CODES.has(suppliedCode)
        ? suppliedCode : "unknown";
      // 원래 message·stack·cause·ID·usage를 복사하지 않는다. 새 Error의 자체 스택만 남는다.
      return new Error(`[chat] failure source=openai_boundary category=${category} provider_code=${code}`);
    }
  } catch {
    // 진단 속성이 잘못되어도 기존 SSE 실패 처리를 중단하지 않는다.
  }
  return new Error("[chat] failure source=non_provider_or_unknown");
}

function getAmoraInputStreamError(error: unknown): {
  code: "AMORA_INPUT_TOO_LARGE" | "AMORA_INPUT_COUNT_UNAVAILABLE";
  message: string;
} | null {
  if (!isRecord(error)) return null;
  if (error.providerCode === "input_token_limit") {
    return {
      code: "AMORA_INPUT_TOO_LARGE",
      message: "대화나 첨부파일 내용이 너무 길어요. 첨부파일을 줄이거나 새 대화에서 다시 시도해주세요.",
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
/**
 * 첫 실행 안내를 끝낸 시각. **프로필 select와 절대 합치지 않는다.**
 *
 * 처음에는 `readChatActorProfile`의 select에 이 컬럼을 얹었다. 그게 사고였다 —
 * 컬럼이 아직 없는 배포에서 select 전체가 42703으로 실패하고, 폴백이
 * `preparation_status: null`을 하드코딩한다. null은 `normalizePreparationStatus`에서
 * `"preparing"`이 되므로, **예식을 연기하거나 이어가지 않기로 한 사람에게 카운트다운과
 * 재촉이 통째로 되살아난다.** 그 컬럼의 계약 파일이 첫 문단에서 "어떤 버그보다 아프다"고
 * 적어둔 바로 그 상황을, 안내 플래그 하나 때문에 만들 뻔했다.
 *
 * 그래서 따로 읽고, 실패하면 조용히 null이다. 최악이 "첫마디 맥락이 빠진다"이고
 * 그건 아무도 다치지 않는다. 이 조회는 아모라가 아직 한 마디도 하지 않은 대화에서만
 * 일어나므로 평소 턴에는 비용이 없다.
 */
async function readFirstRunTutorialCompletedAt(
  actorId: string,
): Promise<string | null> {
  try {
    const { data, error } = await getServiceClient()
      .from("profiles")
      .select("first_run_tutorial_completed_at")
      .eq("id", actorId)
      .single();
    if (error || !data) return null;
    const value = (data as { first_run_tutorial_completed_at?: unknown })
      .first_run_tutorial_completed_at;
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

type ChatViewClearedAt = {
  shared: string | null;
  private: string | null;
  privacyEpoch: number | null;
};

const NO_CHAT_VIEW_CLEARED_AT: ChatViewClearedAt = { shared: null, private: null, privacyEpoch: null };

function chatViewBoundaryUnavailableResponse() {
  return NextResponse.json(
    {
      error: "대화 정리 범위를 안전하게 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
      code: "CHAT_VIEW_BOUNDARY_UNAVAILABLE",
      retryable: true,
      retryPolicy: "same_request",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 화면 정리는 원문을 삭제하지 않고 프로필 커서와 privacy epoch를 갱신한다.
 * 본인 권한으로 두 값을 한 snapshot에서 읽어 숨긴 원문이 프롬프트로 복귀하거나
 * 초기화 전 문맥으로 시작한 요청이 새 epoch를 사용하는 일을 막는다.
 * 확인된 null 커서와 조회 실패를 구분하고, 확인할 수 없는 경계는 재시도 오류로 닫는다.
 */
async function readChatViewClearedAt(
  supabase: Awaited<ReturnType<typeof createClientFromRequest>>,
  coupleId: string,
  visibility: "shared" | "bride_private" | "groom_private",
): Promise<ChatViewClearedAt | null> {
  try {
    // 같은 DB snapshot에서 읽어야 이전 커서와 초기화 후 epoch가 섞이지 않는다.
    const { data, error } = await supabase.rpc("get_own_amora_chat_view_snapshot", {
      p_couple_id: coupleId,
      p_visibility: visibility,
    });
    if (error || !isRecord(data) || data.version !== 1
      || !Number.isSafeInteger(data.privacyEpoch) || Number(data.privacyEpoch) < 1) return null;
    const normalize = (value: unknown): string | null | undefined => {
      if (value === null) return null;
      return typeof value === "string"
        && value.length > 0
        && Number.isFinite(Date.parse(value))
        ? value
        : undefined;
    };
    const shared = normalize(data.shared);
    const privateCursor = normalize(data.private);
    if (shared === undefined || privateCursor === undefined) return null;
    return { shared, private: privateCursor, privacyEpoch: Number(data.privacyEpoch) };
  } catch {
    return null;
  }
}

/**
 * 이 행이 화면에 남아 있는가. 화면과 **같은 비교**를 쓴다 —
 * `stores/chatStore.ts` 의 `isAfterClearedAt` 는 `>` 이지 `>=` 가 아니다.
 * 커서가 없으면 참(오늘과 동일).
 */
function isAfterChatViewClear(
  createdAt: unknown,
  rowVisibility: unknown,
  cleared: ChatViewClearedAt,
): boolean {
  const cursor = rowVisibility === "shared" ? cleared.shared : cleared.private;
  if (!cursor) return true;
  if (typeof createdAt !== "string") return true;
  const comparison = compareChatTimestamps(createdAt, cursor);
  if (comparison === null) return true;
  return comparison === 1;
}

/**
 * 한 질의가 두 레인(shared + 본인 private)을 함께 읽을 때 DB 에 걸 바닥.
 *
 * 레인마다 커서가 다르므로 DB 에서는 **더 이른 쪽**까지만 좁히고, 정확한 레인별
 * 판정은 위 `isAfterChatViewClear` 가 행 단위로 한 번 더 한다. 한쪽이라도 커서가
 * 없으면 그 레인은 통째로 살아 있어야 하므로 바닥을 두지 않는다.
 */
function chatViewClearedFloor(cursors: ReadonlyArray<string | null>): string | null {
  let floor: string | null = null;
  for (const cursor of cursors) {
    if (!cursor) return null;
    if (floor === null || compareChatTimestamps(cursor, floor) === -1) floor = cursor;
  }
  return floor;
}

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

function getDoneMetadata(message: PersistedAiMessage): Record<string, unknown> {
  const metadata = { ...(message.metadata ?? {}) };
  delete metadata.client_request_id;
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

function replayPersistedMessage(message: PersistedAiMessage): Response {
  const events: Array<Record<string, unknown>> = [];
  const suggestions = getStoredSuggestions(message);
  if (suggestions.length > 0) events.push({ type: "suggestions", suggestions });
  events.push({
    type: "done",
    fullContent: message.content ?? "",
    metadata: getDoneMetadata(message),
  });
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(payload, { headers: SSE_HEADERS });
}

function replayEphemeralCrisisMessage(
  content: string,
  kind: AmoraCrisisKind,
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
      stageTag: null,
      specialistType: null,
      replayed: false,
    },
  })}\n\n`;
  return new Response(payload, { headers: SSE_HEADERS });
}

function isValidChatMessages(value: unknown): value is Array<{
  role: "user" | "assistant";
  content: string;
  id?: string;
}> {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CLIENT_REQUEST_MESSAGES) {
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
    log.error("자동 불만족 피드백 저장 실패 (무시됨):", err);
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
    preparationSource: bodyPreparationSource,
    requestKind: bodyRequestKind,
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

  const actorId = user?.id ?? (isEvaluation ? EVAL_ACTOR_ID : DEMO_ACTOR_ID);
  const evalLimit = isEvaluation ? getEvalRequestLimit(request) : null;
  const isQuotaExempt = !isDemo && isAmoraTestUser(user?.id);

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
  const requestedVisibility: "shared" | "bride_private" | "groom_private" =
    bodyVisibility === "bride_private" || bodyVisibility === "groom_private" ? bodyVisibility : "shared";
  let visibility: "shared" | "bride_private" | "groom_private" = requestedVisibility;

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

  if (requestedVisibility !== "shared") {
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
  // 인사 replay는 일반 문맥 조회보다 먼저 온다. 그 전에 서버 커서를 읽어
  // 정리 전 인사를 찾지 않도록 한다. 새 공간은 기존 greeting 키를 유지하고,
  // 정리한 공간은 기존 RPC가 허용하는 별도 lifecycle 키로 한 번만 인사한다.
  const greetingChatViewClearedAt = requestKind === "initial_greeting" && !isDemo
    ? await readChatViewClearedAt(supabase, dataCoupleId, visibility)
    : NO_CHAT_VIEW_CLEARED_AT;
  if (!greetingChatViewClearedAt) return chatViewBoundaryUnavailableResponse();
  const clientRequestId = requestKind === "initial_greeting"
    ? buildAmoraInitialGreetingRequestKey({
        actorId,
        coupleId,
        visibility,
        resetAt: visibility === "shared"
          ? greetingChatViewClearedAt.shared
          : greetingChatViewClearedAt.private,
      })
    : `chat:${actorId}:${durableClientRequestUuid}`;
  const requestCorrelationId = createHash("sha256")
    .update(clientRequestId)
    .digest("hex");
  const replayPersistedWithMemoryReconciliation = async (
    message: PersistedAiMessage,
    expectedReplayPrivacyEpoch: number,
  ): Promise<Response> => {
    // 같은 요청 재전송도 화면 정리 이후 숨겨진 답변을 되살리면 안 된다.
    // 초기 문맥 조회를 건너뛰는 replay 경로이므로 여기서 별도로 확인한다.
    const replayViewClearedAt = await readChatViewClearedAt(supabase, dataCoupleId, visibility);
    if (!replayViewClearedAt) return chatViewBoundaryUnavailableResponse();
    if (!isAfterChatViewClear(message.createdAt, message.visibility, replayViewClearedAt)) {
      return NextResponse.json(
        {
          error: "정리한 대화의 답변은 다시 불러오지 않아요. 새 메시지로 시작해주세요.",
          code: "CHAT_REPLAY_CLEARED",
          retryable: false,
          retryPolicy: "new_message",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const memoryReconciliation = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId,
      userId: actorId,
      expectedVisibility: visibility,
      message,
    });
    if (memoryReconciliation.status === "retry_required") {
      log.error("[chat] persisted memory enqueue retry required", {
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
      log.error("[chat] persisted memory message scope mismatch", {
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
    return replayPersistedMessage(message);
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

  const earlySafetyAssessment = earlyCrisisUserText === null
    ? null
    : assessAmoraSafetyText(earlyCrisisUserText);
  const earlyCrisisClassification = earlyCrisisUserText === null
    ? null
    : classifyAmoraCrisis(earlyCrisisUserText);
  if (earlyCrisisClassification) {
    return replayEphemeralCrisisMessage(
      buildAmoraCrisisResponse(
        earlyCrisisClassification.kind,
        earlyCrisisClassification.language,
      ),
      earlyCrisisClassification.kind,
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
    return NextResponse.json(
      {
        error:
          "이 내용은 커플 중재로 공유하기 전에 안전 확인과 비공개 지원이 먼저 필요해요.",
        code: "MEDIATION_SAFETY_PREFLIGHT_REQUIRED",
      },
      { status: 422, headers: { "Cache-Control": "no-store" } },
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

  // 안내의 숫자·예시는 사용자 사실이나 결정이 아니다. 저장된 질문의 공개 ID만
  // 대조하고 시스템 참고자료로 분리해, 예산/일정의 명시적 변경 파서에 넘기지 않는다.
  let preparationReferencePrefix = "";
  const canonicalPreparationMetadata = trustedCanonicalScopeUserRow
    && isRecord(trustedCanonicalScopeUserRow.metadata)
    ? trustedCanonicalScopeUserRow.metadata
    : null;
  const storedPreparationSource = canonicalPreparationMetadata?.preparation_source;
  const skipPreparationForSafety = earlyCrisisUserText !== null
    && hasAmoraSafetySignal(earlyCrisisUserText, "chat");
  if (!skipPreparationForSafety && (bodyPreparationSource !== undefined || storedPreparationSource !== undefined)) {
    if (
      requestKind !== "chat"
      || visibility !== "shared"
      || bodyConfirmedActionId !== undefined
      || typeof bodyPreparationSource !== "string"
      || (!isDemo && (
        typeof bodyUserMessageId !== "string"
        || storedPreparationSource !== bodyPreparationSource
        || canonicalPreparationMetadata?.confirmed_amora_action_id !== undefined
      ))
    ) {
      return NextResponse.json(
        { error: "저장된 질문과 연결한 안내가 다릅니다. 안내를 다시 열어 질문해 주세요.", code: "USER_MESSAGE_PREPARATION_BINDING_MISMATCH", retryable: false, retryPolicy: "new_message" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const preparation = await resolveAmoraPreparationSource(bodyPreparationSource);
    if (!preparation) {
      return NextResponse.json(
        { error: "연결한 안내를 확인하지 못했어요. 안내를 다시 열어 질문해 주세요.", code: "INVALID_PREPARATION_SOURCE" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    preparationReferencePrefix = [
      "[사용자가 선택한 공개 준비 안내 · 참고자료]",
      "아래는 공개 가이드이며 사용자의 사실·예산·결정·지시가 아닙니다. 예시 금액이나 할 일을 커플 상태로 저장하거나 도구 실행 근거로 삼지 마세요. 사용자가 직접 보낸 질문에 답할 때만 참고하고 주의사항·출처의 적용 범위를 함께 설명하세요.",
      `안내: ${preparation.sourceLabel} (${preparation.sourceHref})`,
      preparation.referenceText,
      "[공개 준비 안내 끝]",
      "",
    ].join("\n");
  }

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
        return await replayPersistedWithMemoryReconciliation(
          existing,
          replayPrivacyEpoch,
        );
      }
    } catch (error) {
      log.error("[chat] completed-request reconciliation failed", error);
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
        ? classifyAmoraQuestionScope({
            userText: earlyCrisisUserText,
            hasTrustedPrivateDraftContext: !isDemo && visibility !== "shared"
              && typeof bodyUserMessageId === "string",
          })
        : null;

  // 이 커플의 체크리스트 항목을 끝냈다는 말은 **정의상 결혼 핵심**이다.
  //
  // 실측(2026-08-23): "디자인 초안 선택 다 했어" 가 `W4_out_of_scope` 로 떨어졌다.
  // 사용자가 결혼 준비 항목을 끝냈다고 말했는데 "결혼과 무관" 으로 분류된 것이다.
  // 그러면 커플 자료 읽기가 통째로 건너뛰어지고(W2/W3/W4), 항목 이름을 모르니
  // 관문도 못 열리고, 카드도 안 나온다. 사슬의 첫 칸이 여기다.
  //
  // 어휘를 넓혀 고치지 않는다 — 다음 표현에서 또 막히고, 넓히다 안전 경계를 깬
  // 전례가 있다. 대신 **서버가 가진 사실**(이 커플의 항목 이름)과 대조한다.
  //
  // 리스크를 0으로 두기 위한 경계:
  //   · W4 에서만 올린다. W2·W5 안전 축은 이 코드에 닿지도 않는다.
  //   · 올리기만 하고 내리지 않는다.
  //   · 완료·해제 표현이 없으면 조회조차 하지 않는다(대부분의 턴은 질의 0회).
  //   · 존재하지 않는 항목에는 절대 열리지 않는다 — 이름이 자료에 있어야 한다.
  let checklistScopeRescue: AmoraQuestionScopeClassification | null = null;
  if (
    requestKind === "chat"
    && !isDemo
    && preliminaryQuestionScope?.scope === "W4_out_of_scope"
    && earlyCrisisUserText !== null
    // 완료·해제 표현이 없으면 DB 조회조차 하지 않는다(대부분의 턴은 질의 0회).
    && AMORA_CHECKLIST_STATE_VERB.test(earlyCrisisUserText)
  ) {
    try {
      const journeyProgress = await supabase
        .from("wedding_journeys")
        .select("progress")
        .eq("couple_id", dataCoupleId)
        .single();
      const labels = collectAmoraChecklistLabels(journeyProgress.data?.progress);
      // 판정은 `shouldRescueChecklistScope` 한 곳에만 둔다. 예전에는 이 조건이
      // 여기 인라인으로 있었고 경계 테스트가 그것을 **복사**해 두어, 안전 판정
      // 한 줄이 바뀌자 둘이 갈라졌다.
      if (shouldRescueChecklistScope({
        userText: earlyCrisisUserText,
        checklistLabels: labels,
        isWeddingCoreCandidate: true,
      })) {
        checklistScopeRescue = {
          scope: "W0_wedding_core",
          // **기억은 켜지 않는다.** 이 구제의 목적은 체크리스트 카드가 나오게
          // 하는 것뿐이고, 기억까지 열 이유가 없다.
          //
          // 실측(2026-08-23): "초대장 주문·제작 다 했는데 신랑이 화내서
          // 무서웠어요" 가 구제를 통과했다. 위 안전 가드가 있는데도 통과한 이유는
          // 강압 통제 탐지기의 재현율이 30% 라 "화내서 무서웠어요" 를 못 잡기
          // 때문이다. 그 상태에서 기억까지 켜면 두려움 서술이 장기 기억에 남는다.
          //
          // 탐지기를 넓히는 것은 별건이고 오탐을 다시 재야 한다. 그동안 이
          // 구제가 **기억을 절대 열지 않게** 두면 그 위험이 사라진다.
          allowsLongTermMemory: false,
          confidence: "high",
          needsClarification: false,
        };
      }
    } catch (error) {
      // 조회 실패로 대화를 막지 않는다. 구제가 없을 뿐 예전 동작 그대로다.
      log.error("[chat] checklist scope rescue lookup failed", error);
    }
  }
  const effectivePreliminaryScope = checklistScopeRescue ?? preliminaryQuestionScope;
  // 아모라가 되물은 직후의 짧은 답일 수 있는가. 현재 발화만 보는 값싼 판정이고
  // 아무 권한도 주지 않는다 — 저장된 결혼 문맥 읽기를 건너뛸지만 정한다.
  // 실제 판정은 행이 도착한 뒤 `resolveAmoraWeddingClarificationContinuity`가 한다.
  //
  // 대화 행을 따로 더 읽지는 않는다. 이 조건이 참이면 아래 skip이 꺼져 라우트가
  // **평소의 전체 문맥 질의**를 그대로 쓰고, 되묻기 판정에 필요한 직전 한 턴은
  // 그 안에 이미 들어 있다. bounded continuity의 3행 창(그리고 그 앞의 활성 구간
  // 증명 질의)은 건드리지 않는다 — 그 경로는 context-only 계약을 그대로 유지한다.
  const isClarificationAnswerShaped =
    requestKind === "chat"
    && earlyCrisisUserText !== null
    && isAmoraClarificationAnswerShaped(earlyCrisisUserText);
  const shouldAttemptBoundedContinuity =
    !isDemo
    && requestKind === "chat"
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
  // 2026-09-03: 화면 정리 커서를 여기서 미리 띄워 둔다. 아래 저장 문맥 병렬 읽기의
  // 질의를 **만들 때** 값이 필요하므로 그 Promise.all 안에 넣을 수 없고, 그렇다고
  // 직렬 왕복을 하나 더 붙이면 모든 턴이 그만큼 느려진다. 체험(demo)에는 프로필이
  // 없으므로 조회하지 않는다.
  const chatViewClearedAtPromise: Promise<ChatViewClearedAt | null> = isDemo
    ? Promise.resolve(NO_CHAT_VIEW_CLEARED_AT)
    : requestKind === "initial_greeting"
      ? Promise.resolve(greetingChatViewClearedAt)
      : readChatViewClearedAt(supabase, dataCoupleId, visibility);
  // 되묻기 직후일 수 있는 턴에서는 저장된 결혼 문맥 읽기를 건너뛰지 않는다.
  // 건너뛰면 연속성이 성립해도 저니·프로필·결정 이력이 비어 있어 도구가 되살아난
  // 자리에서 아무것도 답하지 못한다. 연속성이 성립하지 않으면 범위는 그대로 W4라
  // `allowsStoredProviderContext`가 false로 남고, 읽어둔 문맥은 provider 경계를
  // 넘지 않은 채 버려진다.
  const skipsIrrelevantProviderContextReads =
    bodyConfirmedActionId === undefined
    && !isClarificationAnswerShaped
    && (
      requestKind === "initial_greeting"
      || requestKind === "mediation"
      || shouldAttemptBoundedContinuity
      || (
        requestKind === "chat"
        && trustedCanonicalScopeUserRow !== null
        && effectivePreliminaryScope !== null
        && (
          effectivePreliminaryScope.scope === "W2_high_risk_adjacent"
          || effectivePreliminaryScope.scope === "W3_social_care"
          || effectivePreliminaryScope.scope === "W4_out_of_scope"
        )
      )
    );

  const limited = isQuotaExempt ? null : await checkRateLimitPersistent(
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
          return await replayPersistedWithMemoryReconciliation(
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
      log.error("[chat] durable request claim failed", error);
      if (requestClaimAcquired) {
        await failChatRequest({
          ...claimParams,
          failureCode: "CHAT_TURN_JOURNAL_UNAVAILABLE",
        }).catch((claimError) => {
          log.error("[chat] journal failure marker failed", claimError);
        });
        requestClaimAcquired = false;
        requestClaimAttemptCount = null;
      }
      const privacyCode = getAmoraPrivacyContextErrorCode(error);
      return NextResponse.json(
        {
          error: "대화를 안전하게 시작하지 못했습니다. 잠시 후 다시 시도해주세요.",
          code: privacyCode ?? "CHAT_REQUEST_CLAIM_FAILED",
          retryable: true,
          retryPolicy: "same_request",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  // 2026-09-03: 스트림 시작 전 실패는 여기서 클레임을 풀고 도구·저장 부작용이
  // 아직 하나도 없으므로 같은 requestKey 재시도가 실제로 진행 가능하다. 그런데
  // 그 지점의 503/504 본문이 retryable/retryPolicy 를 안 실어, 클라이언트가
  // 전부 "영구 실패"로 읽고 재시도 버튼을 지웠다(서버 문구는 다시 시도하라고
  // 적혀 있는데). 스트림 이전 실패 응답에 같은 파일의 기존 규약대로 same_request 를 싣는다.
  const releaseClaimBeforeStream = async (failureCode: string) => {
    if (!requestClaimAcquired) return;
    await failChatRequest({ ...claimParams, failureCode }).catch((error) => {
      log.error("[chat] pre-stream claim release failed", error);
    });
    requestClaimAcquired = false;
    requestClaimAttemptCount = null;
  };

  const { visionAttachments, textAttachments } = processedAttachments;

  // Consent must be resolved before any auxiliary-memory read. Disabled
  // scopes do not query factual summaries or profile source nodes at all.
  const requestedMemoryVisibilities = visibility === "shared"
    ? ["shared"] as const
    : ["shared", visibility] as const;
  let initialPrivacyContextSnapshot: AmoraPrivacyContextSnapshot | null = null;
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
      log.error("[chat] privacy context snapshot unavailable", code);
      await releaseClaimBeforeStream(code);
      return NextResponse.json(
        {
          error:
            "개인정보 설정을 안전하게 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
          code,
          retryable: true,
          retryPolicy: "same_request",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
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
        log.error("[chat] active conversation segment unavailable", {
          providerCode: activeSegmentResult.error?.code ?? null,
          visibility,
        });
        await releaseClaimBeforeStream("CONVERSATION_SEGMENT_UNAVAILABLE");
        return NextResponse.json(
          {
            error: "현재 대화 구간을 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
            code: "CONVERSATION_SEGMENT_UNAVAILABLE",
            retryable: true,
            retryPolicy: "same_request",
          },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
      activeConversationSegmentId = candidateId;
    } catch (error) {
      log.error("[chat] active conversation segment lookup failed", error);
      await releaseClaimBeforeStream("CONVERSATION_SEGMENT_UNAVAILABLE");
      return NextResponse.json(
        {
          error: "현재 대화 구간을 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
          code: "CONVERSATION_SEGMENT_UNAVAILABLE",
          retryable: true,
          retryPolicy: "same_request",
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

  // 2026-09-03: 화면 정리 커서. 아래 질의들이 "화면에 남아 있는 범위"만 읽도록
  // 좁히는 데만 쓴다 — 커서가 없으면(대부분) 조건이 붙지 않아 오늘과 동일하다.
  const chatViewClearedAt = await chatViewClearedAtPromise;
  if (!chatViewClearedAt) {
    await releaseClaimBeforeStream("CHAT_VIEW_BOUNDARY_UNAVAILABLE");
    return chatViewBoundaryUnavailableResponse();
  }
  if (!isDemo && chatViewClearedAt.privacyEpoch !== initialPrivacyEpoch) {
    await releaseClaimBeforeStream("AMORA_PRIVACY_CONTEXT_CHANGED");
    return NextResponse.json(
      {
        error: "대화 정리 또는 개인정보 설정이 바뀌었어요. 다시 시도해주세요.",
        code: "AMORA_PRIVACY_CONTEXT_CHANGED",
        retryable: true,
        retryPolicy: "same_request",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const messagesClearedFloor = chatViewClearedFloor(
    visibility === "shared"
      ? [chatViewClearedAt.shared]
      : [chatViewClearedAt.shared, chatViewClearedAt.private],
  );
  const summariesClearedFloor = chatViewClearedFloor(
    enabledMemoryVisibilities.map((candidate) => (
      candidate === "shared" ? chatViewClearedAt.shared : chatViewClearedAt.private
    )),
  );
  const boundedContinuityClearedFloor = chatViewClearedFloor([
    visibility === "shared" ? chatViewClearedAt.shared : chatViewClearedAt.private,
  ]);

  /**
   * canonical 대화 창 질의. **아래 5번(평소 문맥)과 9번(W4 이력)이 같은 창을 쓴다.**
   *
   * 2026-09-03: 두 벌로 적어 두면 상대 메시지 제외·세그먼트·화면 정리 커서 중 하나가
   * 갈라져도 아무도 못 알아챈다. 한 곳에서 만들고 두 곳이 부른다.
   */
  const canonicalMessageWindowColumns: string =
    conversationSegmentReadEnabled || shouldLoadBoundedContinuity
      ? "id, sender_id, sender_type, role, content, metadata, visibility, segment_id, created_at"
      : "id, sender_id, sender_type, role, content, metadata, visibility, created_at";
  const buildCanonicalMessageWindowQuery = () => {
    let q = supabase
      .from("chat_messages")
      .select(canonicalMessageWindowColumns)
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
    // 화면 정리 이전 행은 사용자 화면에 없다. private 턴은 두 레인을 함께 읽으므로
    // DB 에는 더 이른 커서까지만 걸고, 레인별 정확한 판정은 아래에서 행마다 한다.
    if (messagesClearedFloor) q = q.gt("created_at", messagesClearedFloor);
    return visibility === "shared"
      ? q.eq("visibility", "shared")
      : q.in("visibility", ["shared", visibility]);
  };
  /**
   * **W4 턴에도 이력을 싣기 위한 별도 읽기.**
   *
   * 2026-09-03 스테이징 실측: "앞에서 만든 배분표 그대로 실제 예산에 반영해줘" 가
   * 그 문장에 결혼 낱말이 없어 `W4_out_of_scope` 로 분류되자, 라우트가 대화 읽기를
   * 통째로 건너뛰어 provider 가 **그 한 문장만** 받았다. 표가 DB 에 멀쩡히 있는데
   * 아모라는 "대화에 보이지 않아요" 라고 답했다.
   *
   * 여기서 읽는 것은 **이력뿐이다.** 저장 문맥(저니·프로필·요약·결정·개인화·장기
   * 기억)의 skip 은 위 `skipsIrrelevantProviderContextReads` 그대로 두었고, 이 행들은
   * `selectAmoraTrustedHistoryRows`(안전 스크린 + W2·W3·W5 배제 + 쌍 증명)를 지난 뒤
   * `providerMessages` 에만 쓰인다. `canonicalRows` 는 손대지 않는다 — 그쪽을 넓히면
   * 카드 이월·되묻기 연속성·최신 행 관문까지 같이 움직인다.
   *
   * 연결 문맥(bounded continuity)이 도는 턴은 제외한다. 그 레인은 자기 3행 계약과
   * `linked_context_only` 라벨을 함께 쓰므로, 같은 턴에 넓은 이력을 얹으면 프롬프트가
   * 스스로와 어긋난다.
   */
  const shouldLoadW4TrustedHistory =
    !isDemo
    && requestKind === "chat"
    && skipsIrrelevantProviderContextReads
    && !shouldLoadBoundedContinuity
    && typeof bodyUserMessageId === "string"
    && trustedCanonicalScopeUserRow !== null
    && effectivePreliminaryScope?.scope === "W4_out_of_scope";

  const [
    journeyResult,
    profilesResult,
    summariesResult,
    decisionsResult,
    messagesResult,
    profileNodesResult,
    personalizationResult,
    boundedContinuityRowsResult,
    w4TrustedHistoryRowsResult,
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
      // 화면 정리 이전 요약은 지워진 대화를 요약한 것이다. 커서가 없으면 조건 없음.
      if (summariesClearedFloor) q = q.gt("created_at", summariesClearedFloor);
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
          // source_actor_role: 누가 말한 값인지. 없으면 프롬프트가 라벨을 붙이지
          // 않는다 — 공동 전제를 한쪽 사람의 주장으로 귀속하던 자리(2026-09-03).
          .select("category, decision_type, title, chosen_value, reasoning, confidence, stage_tag, source, visibility, created_at, memory_key, superseded_at, metadata, source_actor_role")
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
      // **되묻기 답인 턴에서는 넓은 창을 쓴다.**
      //
      // 2026-09-02 회귀 복구. 이 갈래가 `shouldLoadBoundedContinuity` 만 보고
      // 3행 질의로 갈아치우고 있었고, 그 3행이 `canonicalRows` 를 거쳐
      // `resolveAmoraWeddingClarificationContinuity` 로 그대로 흘러갔다.
      // 그 함수는 홉을 올릴 때 `index < 2` 면 즉시 `null` 을 돌려주므로
      // (`amoraClarificationContinuity.ts`), 행이 3개면 **2홉이 물리적으로
      // 불가능**하다. `MAX_CLARIFICATION_HOPS = 3` 은 운영에서 한 번도 쓰인 적이
      // 없었다. 위 1350행 주석은 "평소의 전체 문맥 질의를 그대로 쓴다" 고
      // 적혀 있었는데 코드가 그 반대였다.
      //
      // 연결 문맥(bounded continuity)이 쓰는 3행은 아래 별도 원소로 따로 받는다.
      // **넓은 결과를 잘라서 주면 안 된다** — 넓은 질의는 `.or(metadata->>target…)`
      // 로 partner 행을 DB 에서 빼므로, 그 마지막 3행을 주면 원래 끊겨야 할
      // 대화가 인접해 보인다(바로 아래 주석이 못 박은 계약).
      if (shouldLoadBoundedContinuity && !isClarificationAnswerShaped) {
        // Read exactly the current row and its two direct predecessors. Do not
        // hide partner-target rows here: their presence must break continuity,
        // never make non-adjacent messages look adjacent after filtering.
        const boundedQuery = supabase
          .from("chat_messages")
          .select(canonicalMessageWindowColumns)
          .eq("couple_id", dataCoupleId)
          .eq("visibility", visibility)
          .eq("segment_id", boundedContinuitySegmentId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(3);
        // 화면 정리 이전 행이 앞자리를 채우면 3행이 안 되고, 그러면
        // `buildAmoraBoundedContinuity` 가 null 을 내 연결 문맥이 꺼진다 —
        // 지운 대화와 이어붙는 것보다 그편이 맞다.
        return boundedContinuityClearedFloor
          ? boundedQuery.gt("created_at", boundedContinuityClearedFloor)
          : boundedQuery;
      }
      return buildCanonicalMessageWindowQuery();
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
    // 8. 연결 문맥(bounded continuity) 전용 3행.
    //
    // 위 5번이 되묻기 답인 턴에서 넓은 창을 쓰게 되면서, 연결 문맥이 요구하는
    // "현재 행과 직전 두 행" 을 여기서 따로 받는다. `buildAmoraBoundedContinuity`
    // 는 행이 정확히 3개가 아니면 **예외 없이 조용히 `null`** 을 돌려주므로,
    // 넓은 결과를 잘라 넘기면 그 레인이 소리 없이 꺼진다. 같은 이유로 여기서도
    // partner 행을 숨기지 않는다 — 그 존재는 연속성을 끊어야지, 걸러낸 뒤에
    // 인접해 보이게 만들면 안 된다.
    shouldLoadBoundedContinuity && isClarificationAnswerShaped
      ? (() => {
          const boundedQuery = supabase
            .from("chat_messages")
            .select("id, sender_id, sender_type, role, content, metadata, visibility, segment_id, created_at")
            .eq("couple_id", dataCoupleId)
            .eq("visibility", visibility)
            .eq("segment_id", boundedContinuitySegmentId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(3);
          // 5번의 3행 갈래와 같은 이유로 화면 정리 커서를 건다.
          return boundedContinuityClearedFloor
            ? boundedQuery.gt("created_at", boundedContinuityClearedFloor)
            : boundedQuery;
        })()
      : Promise.resolve({ data: null, error: null }),
    // 9. W4(결혼 밖) 턴 이력 전용 창.
    //
    // 위 5번은 이 턴에서 현재 행 하나만 돌려준다(저장 문맥 skip). 그런데 "이 대화에
    // 아까 그게 있었나" 는 저장 문맥이 아니라 **이력**의 문제다. 같은 창을 한 번 더
    // 읽어 `providerMessages` 에만 쓰고, `canonicalRows` 는 건드리지 않는다.
    // 실패하면 data 가 null 로 남아 오늘과 똑같이 현재 발화 하나만 간다.
    shouldLoadW4TrustedHistory
      ? buildCanonicalMessageWindowQuery()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const journey = journeyResult.data;
  if (!isDemo && journeyResult.error) {
    log.error("Journey 조회 에러:", journeyResult.error.message);
    await releaseClaimBeforeStream("WEDDING_CONTEXT_UNAVAILABLE");
    return NextResponse.json(
      {
        error: "저장된 웨딩 정보를 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
        code: "WEDDING_CONTEXT_UNAVAILABLE",
        retryable: true,
        retryPolicy: "same_request",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const canonicalJourneyStateRevision =
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
    log.error("[chat] canonical context lookup failed", {
      code: criticalContextFailure.code,
      providerCode: criticalContextFailure.error?.code ?? null,
    });
    await releaseClaimBeforeStream(criticalContextFailure.code);
    return NextResponse.json(
      {
        error: criticalContextFailure.message,
        code: criticalContextFailure.code,
        retryable: true,
        retryPolicy: "same_request",
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

  // 중립 준비 공간에서 bride/groom은 저장 슬롯일 뿐 사용자 정체성이 아니다.
  // 그 값을 그대로 라벨로 쓰면 아모라가 고르지도 않은 성별로 사용자를 부른다.
  // 플래그가 꺼져 있으면 컬럼을 조회하지 않는다 — 마이그레이션 전에 배포돼도
  // 42703으로 채팅이 죽지 않게 한다.
  let memberModelVersion: 1 | 2 = 1;
  if (
    !isDemo
    && process.env.AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED === "true"
  ) {
    const memberModelResult = await supabase
      .from("couples")
      .select("member_model_version")
      .eq("id", dataCoupleId)
      .maybeSingle();

    // 컬럼이 아직 없다(=마이그레이션 미적용)면 중립 커플이 존재할 수 없다.
    // 그 상태에서 v1로 읽는 것은 추측이 아니라 사실이다. 이걸 503으로 만들면
    // 플래그를 켜는 순간 기존 커플까지 채팅이 통째로 멈춘다.
    const schemaNotReady = memberModelResult.error !== null
      && ["42703", "PGRST202", "PGRST204"].includes(
        String((memberModelResult.error as { code?: unknown }).code ?? ""),
      );

    if (schemaNotReady) {
      console.warn(
        "[chat] member_model_version 미적용 — v1로 처리한다",
        memberModelResult.error?.code,
      );
    } else {
      const rawMemberModelVersion = isRecord(memberModelResult.data)
        ? memberModelResult.data.member_model_version
        : null;
      if (
        memberModelResult.error
        || (rawMemberModelVersion !== 1 && rawMemberModelVersion !== 2)
      ) {
        // 여기는 일시 장애다. 잘못 추측하면 중립 사용자에게 성별이 찍히므로
        // 추측하지 않고 멈춘다.
        log.error("[chat] member model lookup failed", memberModelResult.error);
        await releaseClaimBeforeStream("AMORA_MEMBER_MODEL_UNAVAILABLE");
        return NextResponse.json(
          {
            error: "현재 준비 공간의 구성 방식을 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
            code: "AMORA_MEMBER_MODEL_UNAVAILABLE",
            retryable: true,
            retryPolicy: "same_request",
          },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
      memberModelVersion = rawMemberModelVersion;
    }
  }
  const usesNeutralMemberPresentation = memberModelVersion === 2;

  // 프로필에서 신부/신랑 이름 추출
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
  const summariesData = ((summariesResult.data ?? []) as unknown as Array<{
    summary: string;
    summary_type: string | null;
    visibility: "shared" | "bride_private" | "groom_private";
    segment_id?: string | null;
    created_at: string;
    message_count: number | null;
    to_message_id: string | null;
  }>).filter((summary) => isAfterChatViewClear(
    // 2026-09-03: DB 에는 두 레인 중 더 이른 커서만 걸 수 있으므로 레인별 정확한
    // 판정을 여기서 한 번 더 한다. 커서가 없으면 전부 통과(오늘과 동일).
    summary.created_at,
    summary.visibility,
    chatViewClearedAt,
  ));
  if (
    conversationSegmentReadEnabled
    && summariesData.some((summary) =>
      summary.segment_id !== activeConversationSegmentId
      || summary.visibility !== visibility)
  ) {
    log.error("[chat] memory summary escaped active conversation segment", {
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
    category: string;
    decision_type: string;
    title: string;
    chosen_value: Record<string, unknown> | null;
    reasoning: string | null;
    confidence: number | null;
    stage_tag: string | null;
    source: string;
    visibility: "shared" | "bride_private" | "groom_private";
    created_at: string;
    memory_key: string | null;
    superseded_at: string | null;
    metadata: Record<string, unknown> | null;
    source_actor_role: "bride" | "groom" | null;
  }>;
  const isAutomaticMemory = (decision: typeof rawDecisions[number]) =>
    decision.memory_key !== null || typeof decision.metadata?.extracted_by === "string";
  const decisionsData =
    visibility === "shared"
      ? rawDecisions.filter((d) =>
          d.visibility === "shared"
          && d.superseded_at === null
          && (sharedMemoryEnabledForTurn || !isAutomaticMemory(d)))
      : rawDecisions.filter((d) =>
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
        .map((event) => ({ id: event.id, date: event.date, title: event.title, time: event.time ?? null }))
      : [],
    // 총예산을 넘기지 않으면 예산 판정이 있어도 돌지 않는다. 옛 총예산 영수증이
    // 현재처럼 회상되던 문제가 여기서 끊긴다(2026-08-22).
    totalBudgetKrw: isRecord(journey) && typeof journey.total_budget === "number"
      ? journey.total_budget
      : null,
  };
  // 하객 수·예식 형태·시기는 여정에 대조할 값이 없어 위 판정이 영원히 닿지 않는다.
  // 그 세 category 만 (visibility, category, 값 모양) 안에서 최신 1건을 남긴다.
  // 방향을 바꾼 뒤 옛 하객 수·시기가 "아직 유효한 것"으로 회상되던 자리다(2026-09-03).
  const liveDecisions = dropOutdatedTruthlessDecisions(
    decisionsData
      .filter((d) => !isSupersededDecision(
        { category: d.category, title: d.title, chosenValue: d.chosen_value },
        currentJourneyFacts,
      ))
      .map((d) => ({ ...d, createdAt: d.created_at, chosenValue: d.chosen_value })),
  );

  const pastDecisions = liveDecisions.map((d) => ({
    category: d.category,
    decisionType: d.decision_type,
    title: d.title,
    value: typeof d.chosen_value?.value === "string" ? d.chosen_value.value : null,
    reasoning: d.reasoning,
    confidence: d.confidence ?? 0.5,
    source: d.source,
    createdAt: d.created_at,
    // 기록된 것만 넘긴다. 지어내면 이번 오류(공동 전제를 한쪽 값으로 귀속)를 반복한다.
    sourceActorRole: d.source_actor_role === "bride" || d.source_actor_role === "groom"
      ? d.source_actor_role
      : null,
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
      pending_amora_action_queue?: unknown;
      // 아직 안 누른 카드를 새 답변으로 옮길 때 **원래 값 그대로** 들고 간다.
      pending_amora_action_journey_revision?: unknown;
      pending_amora_action_impact_preview?: unknown;
      /** 이 카드가 원본 턴 이후 몇 번 옮겨졌는가. 없으면 0(원본 턴). */
      pending_amora_action_carry_count?: unknown;
      /** 이 카드가 처음 나온 답변 행 id. 관측용이며 정책을 바꾸지 않는다. */
      pending_amora_action_carry_origin_message_id?: unknown;
      in_reply_to_user_message_id?: unknown;
      toolResults?: unknown;
    } | null;
    visibility: "shared" | "bride_private" | "groom_private";
    segment_id?: string | null;
    created_at: string;
  };

  if (!isDemo && messagesResult.error) {
    log.error("Canonical chat history lookup failed:", messagesResult.error.message);
    await releaseClaimBeforeStream("CHAT_HISTORY_UNAVAILABLE");
    return NextResponse.json(
      {
        error: "저장된 대화를 확인하지 못했습니다.",
        code: "CHAT_HISTORY_UNAVAILABLE",
        retryable: true,
        retryPolicy: "same_request",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // 2026-09-03: 화면 정리 이전 행은 사용자 화면에 없다. DB 에는 두 레인 중 더 이른
  // 커서까지만 걸 수 있으므로(private 턴은 shared + 본인 private 를 함께 읽는다)
  // 레인별 정확한 판정을 여기서 한 번 더 한다. 커서가 없으면 전부 통과 = 오늘과 동일.
  const canonicalContextRows = ((messagesResult.data ?? []) as unknown as CanonicalChatRow[])
    .filter((row) => isAfterChatViewClear(row.created_at, row.visibility, chatViewClearedAt));
  /**
   * 연결 문맥이 볼 행. **넓은 창을 잘라 쓰지 않는다.**
   *
   * 되묻기 답인 턴에서는 위 5번이 넓은 창을 읽으므로, 연결 문맥이 요구하는
   * "정확히 3행" 을 8번에서 따로 받아 여기서 고른다. `buildAmoraBoundedContinuity`
   * 는 3행이 아니면 예외 없이 조용히 `null` 이라, 잘라 넘기면 그 레인이 소리 없이
   * 꺼진다. 그리고 넓은 질의는 partner 행을 DB 에서 빼므로, 그 꼬리 3행은
   * "끊겨야 할 대화가 인접해 보이는" 바로 그 결과를 만든다.
   */
  const boundedContinuityRows = boundedContinuityRowsResult?.data
    ? (boundedContinuityRowsResult.data as unknown as CanonicalChatRow[])
        .filter((row) => isAfterChatViewClear(row.created_at, row.visibility, chatViewClearedAt))
    : canonicalContextRows;
  /**
   * W4 턴 이력 전용 행(9번). 오래된 것부터 정렬해 두고, `canonicalRows` 와 같은
   * 두 겹 — 상대 대상 제외 + 화면 정리 커서 — 을 그대로 태운다. 읽지 않았거나
   * 실패했으면 null 이고, 그때 provider 입력은 오늘과 같다. (2026-09-03)
   */
  const w4TrustedHistoryContextRows = w4TrustedHistoryRowsResult?.data
    ? (w4TrustedHistoryRowsResult.data as unknown as CanonicalChatRow[])
        .filter((row) => row.metadata?.target !== "partner")
        .filter((row) => isAfterChatViewClear(row.created_at, row.visibility, chatViewClearedAt))
        .reverse()
    : null;
  if (
    conversationSegmentReadEnabled
    && canonicalContextRows.some((row) =>
      row.segment_id !== activeConversationSegmentId
      || row.visibility !== visibility)
  ) {
    log.error("[chat] canonical history escaped active conversation segment", {
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
      // 실패 안내는 모델에게 보여주지 않는다. 보여주면 모델이 그것을 아모라
      // 턴의 모양으로 배워서, 몇 번의 실패가 그 대화를 영구히 망친다
      // (2026-08-24 운영·스테이징 양쪽에서 재현). 화면과 DB 는 그대로다.
      if (isAmoraFailedProposalNotice(row.content)) return null;
      // 제안했던 턴은 표식을 되붙이고, 확인만 약속하고 표식이 없던 턴은 그
      // 약속을 걷어낸다. 이력은 모델에게 "아모라 턴은 이렇게 생겼다"를 가르친다.
      return {
        role: "assistant" as const,
        content: appendAmoraToolResultHistory(
          buildAmoraHistoryContent(row.content, row.metadata?.pending_amora_action),
          row.metadata?.toolResults,
        ),
        id: row.id,
      };
    }
    const roleLabel = speakerLabelFor({
      neutral: usesNeutralMemberPresentation,
      isSelf: row.sender_id === actorId,
      senderType: row.sender_type,
    });
    const targetLabel = row.metadata?.target === "partner"
      ? PARTNER_TARGET_SUFFIX
      : "";
    return {
      role: "user" as const,
      content: `[${roleLabel}${targetLabel}] ${row.content}`,
      id: row.id,
    };
  };
  const canonicalMessages = canonicalRows
    .map(toCanonicalMessage)
    .filter((message): message is NonNullable<typeof message> => message !== null);

  // Signed demo만 DB가 없으므로 client history를 사용한다. 실제 사용자 턴은
  // canonical DB history만 prompt source로 허용한다.
  let typedMessages: Array<{ role: "user" | "assistant"; content: string; id?: string }> =
    isDemo
      ? (messages as Array<{ role: "user" | "assistant"; content: string; id?: string }>)
      : canonicalMessages;
  let lastUserText: string;

  if (requestKind === "initial_greeting") {
    // 중립 준비 공간에서는 내부 슬롯이 bride로 배정되므로 role을 그대로 쓰면
    // 아모라가 고르지도 않은 성별로 사용자를 부른다. 슬롯은 라벨이 아니다.
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
    // 중립 준비 공간에서는 내부 슬롯이 bride로 배정되므로 role을 그대로 쓰면
    // 아모라가 고르지도 않은 성별로 사용자를 부른다. 슬롯은 라벨이 아니다.
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
          error: "보낸 메시지 저장을 아직 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
          code: "USER_MESSAGE_NOT_PERSISTED",
          // 2026-09-04: Retry-After 를 실어 보내면서 재시도 판정은 안 실어, 화면이
          // 409 를 영구 실패로 읽고 버튼을 지웠다. 클레임은 위에서 풀었고 같은
          // 키라 두 번 생성되지 않는다.
          retryable: true,
          retryPolicy: "same_request",
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

  // 첫마디에 대한 답인지. 블록 안에서 정해 아래 범위 판정이 쓴다.
  let firstHelloAnswered = false;
  // 아모라가 화면에서 건넨 첫마디를 이 턴의 맥락 맨 앞에 놓는다.
  //
  // 그 인사는 모델이 쓰지 않고 온보딩 입력만으로 만들어져 화면에만 존재한다. 그대로
  // 두면 사람이 인사를 읽고 "그래"라고만 답했을 때 모델은 인사를 본 적 없이 "그래"만
  // 받는다 — 첫 번째 턴부터 어긋난다.
  //
  // 클라이언트가 보낸 assistant 이력은 신뢰하지 않는 것이 이 라우트의 원칙이므로
  // (위 canonical 규칙), 받지 않고 커플 자신의 여정 데이터에서 서버가 다시 만든다.
  // 저장하지 않으므로 기록은 그대로다.
  if (
    requestKind === "chat"
    && !isDemo
    // 아모라가 이미 말한 적 있으면 조회조차 하지 않는다 — 평소 턴에 비용을 더하지 않는다.
    && !typedMessages.some((message) => message.role === "assistant")
  ) {
    const firstHelloTurn = buildFirstHelloContextTurn({
      canonicalMessages: typedMessages,
      tutorialCompletedAt: await readFirstRunTutorialCompletedAt(actorId),
      weddingDate:
        typeof journey?.wedding_date === "string" ? journey.wedding_date : null,
      progress: journey?.progress,
      now: Date.now(),
    });
    if (firstHelloTurn) typedMessages = [firstHelloTurn, ...typedMessages];
    // 아모라의 첫마디는 "오늘은 딱 한 가지만 정해볼까요? 무엇부터 볼지
    // 모르겠으면 그렇게 말씀해 주셔도 돼요." 로 끝난다. 그 초대에 가장 자연스러운
    // 답 — "응"·"네"·"그래"·"좋아"·"모르겠어" — 은 **전부 W4로 떨어진다**(실측).
    //
    // 그러면 도구가 0개가 되고 저장된 커플 문맥도 provider 경계를 못 넘는다.
    // 아모라가 직접 권한 답을 사람이 그대로 했는데 첫 턴부터 아무것도 못 한다.
    //
    // 되묻기 구제(`weddingClarificationContinuity`)는 [직전 사용자, 아모라,
    // 현재] 세 행을 요구하는데 첫마디 앞에는 사용자 행이 없어 닿지 않는다.
    // 여기서 잇는다 — 이 인사는 **서버가 커플 자신의 여정 데이터로 만든 것**이라
    // 정의상 결혼 이야기이고, 모델도 방금 그것을 문맥으로 받았다.
    firstHelloAnswered = firstHelloTurn !== null && isClarificationAnswerShaped;
  }

  const previousCanonicalRow = canonicalRows.length >= 2
    ? canonicalRows[canonicalRows.length - 2]
    : null;
  const approvedPendingAction =
    !isDemo
    && requestKind === "chat"
    && isDurableUserMessageBound
    && visibility === "shared"
    && previousCanonicalRow?.role === "assistant"
    && previousCanonicalRow.sender_type === "ai"
    && previousCanonicalRow.visibility === visibility
      ? resolveAmoraPendingAction({
          value: previousCanonicalRow.metadata?.pending_amora_action,
          confirmedActionId: bodyConfirmedActionId,
          allowedTools: PENDING_ACTION_TOOLS,
          now: Date.now(),
        })
      : null;
  // 버튼을 누르지 않고 말로 승인했을 때를 위한 **읽기 신호**.
  // 실행 권한이 아니다 — 적용은 여전히 서버 발급 action_id 를 받아야 한다.
  const awaitingPendingCard =
    bodyConfirmedActionId === undefined
    && !isDemo
    && requestKind === "chat"
    && visibility === "shared"
    && previousCanonicalRow?.role === "assistant"
    && previousCanonicalRow.sender_type === "ai"
    && previousCanonicalRow.visibility === visibility
      ? describeUnconfirmedAmoraPendingAction({
          value: previousCanonicalRow.metadata?.pending_amora_action,
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
  const queueHead = approvedPendingAction ?? awaitingPendingCard;
  const storedActionQueue = queueHead
    ? resolveAmoraActionQueue(previousCanonicalRow?.metadata?.pending_amora_action_queue, queueHead, PENDING_ACTION_TOOLS, Date.now())
    : null;
  if (approvedPendingAction && previousCanonicalRow?.metadata?.pending_amora_action_queue !== undefined && !storedActionQueue) {
    await releaseClaimBeforeStream("AMORA_PENDING_ACTION_QUEUE_INVALID");
    return NextResponse.json({ error: "남은 요청을 안전하게 확인하지 못해 변경하지 않았어요. 내용을 다시 알려주세요.", code: "AMORA_PENDING_ACTION_QUEUE_INVALID" }, { status: 409, headers: { "Cache-Control": "no-store" } });
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
        log.error(
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
  // 되묻기 직후의 답인지는 서버가 증명한다. 저장된 행에서만 읽고, 직전 사용자
  // 발화를 다시 판정하고, 아모라 행에 서버가 기록해 둔 question_scope를 본다.
  // 하나라도 어긋나면 null이 되어 지금까지의 (더 닫힌) 경로가 그대로 남는다.
  const weddingClarificationContinuity =
    !isDemo
    && requestKind === "chat"
    && isDurableUserMessageBound
    && !approvedPendingAction
    && typeof bodyUserMessageId === "string"
    && isClarificationAnswerShaped
      ? resolveAmoraWeddingClarificationContinuity({
          // **거르지 않은** 행을 넘긴다. 여기에 신뢰 필터를 통과시킨 목록을
          // 넘겼던 것이 이 기능 최악의 결함이었다 — 그 필터는 W2·W5 턴을
          // 지우므로, 폭력·위기 발화가 사이에 끼어도 연속성이 끊기는 대신
          // 오래된 웨딩 쌍이 답변과 붙어 보였다. 사이에 무엇이 있든 모양이
          // 어긋나면 거부되도록 원본 행을 그대로 준다.
          rawOldestFirstRows: canonicalRows,
          requesterUserId: actorId,
          currentUserMessageId: bodyUserMessageId,
          currentUserText: lastUserText,
        })
      : null;
  /**
   * **어떤 턴도 오늘보다 나빠지지 않는다.**
   *
   * 위에서 넓은 창으로 구제를 시도했는데 실패하면, 오늘 운영이 쓰던 것과 **완전히
   * 같은 3행 입력**으로 한 번 더 부른다. 창을 넓히는 것은 "얼마나 거슬러
   * 올라가느냐" 만 바꾸므로 이론상 넓은 쪽이 항상 같거나 낫지만, 이론이 틀렸을
   * 때 사용자가 대가를 치르지 않게 하는 것이 이 폴백이다. 홉마다 여덟 가드를
   * 다시 지나는 것은 두 경로 모두 같다.
   */
  const weddingClarificationContinuityWithFallback =
    weddingClarificationContinuity
    ?? (boundedContinuityRowsResult?.data && typeof bodyUserMessageId === "string"
      ? resolveAmoraWeddingClarificationContinuity({
          rawOldestFirstRows: [...(boundedContinuityRowsResult.data as unknown as CanonicalChatRow[])]
            .reverse(),
          requesterUserId: actorId,
          currentUserMessageId: bodyUserMessageId,
          currentUserText: lastUserText,
        })
      : null);
  // 답이 **이미 W0인데** 도구 의도만 없는 턴. 범위는 멀쩡하니 구제할 것이 없고,
  // 도구 선택기만 어휘를 못 찾아 0개가 된다.
  //
  // 2026-08-25 운영 실측 — 아모라가 자기가 물어 놓고 답을 받은 뒤:
  //   "이 대화에서는 할 일을 실제로 저장하는 도구가 없어 아직 반영되지 않았어요."
  //   "이 대화에서는 체크리스트 상태를 변경하는 도구가 없어 …"
  // 첫 사용자에게는 제품에 그 기능이 없는 것으로 보인다.
  //
  // 같은 행 가드·홉 가드를 그대로 지나며, 넘겨주는 것은 도구 선택용 의도뿐이다.
  // 범위·장기 기억·저장 문맥 권한은 아래 판정들이 그대로 정한다.
  const toolIntentContinuity =
    !weddingClarificationContinuityWithFallback
    && !isDemo
    && requestKind === "chat"
    && isDurableUserMessageBound
    && !approvedPendingAction
    && typeof bodyUserMessageId === "string"
      ? resolveAmoraWeddingClarificationContinuity({
          rawOldestFirstRows: canonicalRows,
          requesterUserId: actorId,
          currentUserMessageId: bodyUserMessageId,
          currentUserText: lastUserText,
          answerShape: "tool_intent",
        })
      : null;
  // 카드를 옮길 때 **원래 값 그대로** 들고 간다. 저니 리비전이 바뀌면
  // 적용이 정상적으로 거부되어야 하므로 새로 계산하지 않는다.
  const carriedPendingActionRevision = awaitingPendingCard !== null
    && isRecord(previousCanonicalRow?.metadata)
    && typeof previousCanonicalRow.metadata.pending_amora_action_journey_revision === "number"
      ? previousCanonicalRow.metadata.pending_amora_action_journey_revision
      : null;
  const carriedPendingActionImpactPreview = awaitingPendingCard !== null
    && isRecord(previousCanonicalRow?.metadata)
      ? previousCanonicalRow.metadata.pending_amora_action_impact_preview ?? null
      : null;
  /**
   * **카드는 몇 턴까지 따라다니는가.**
   *
   * 2026-09-02 운영 실측 — 안 누른 카드 하나가 **무관한 답변 8개를 43분간**
   * 따라다녔다. 이월에는 상한도 범위 관문도 없었다.
   *
   * 이월 자체는 옳다(화면이 최신 메시지의 카드만 누를 수 있게 하므로, 옮기지
   * 않으면 아모라가 "이대로 적용을 누르세요" 라고 하는데 버튼은 잠겨 있다).
   * 다만 **끝이 있어야 한다** — 사용자가 두 번 다른 이야기를 했으면 그 제안은
   * 그 대화의 것이 아니다. 원본 메시지에는 그대로 남으니 사라지는 것이 아니라
   * 따라다니기를 멈출 뿐이다.
   */
  const MAX_PENDING_CARD_CARRIES = 2;
  const previousPendingCardCarries =
    isRecord(previousCanonicalRow?.metadata)
    && typeof previousCanonicalRow.metadata.pending_amora_action_carry_count === "number"
      ? previousCanonicalRow.metadata.pending_amora_action_carry_count
      : 0;
  const nextPendingCardCarries = previousPendingCardCarries + 1;
  /**
   * 이 카드가 **처음 나온 답변**이 어느 행인가 (2026-09-04, 관측용).
   *
   * 이월된 카드는 원본 문장과 떨어져 뜬다. 그런데 옮겨진 행만 보면 그 카드가 어느
   * 대화에서 나온 것인지 되짚을 수가 없어, 운영에서 "문장과 다른 것이 저장됐다"는
   * 신고가 들어와도 원본 턴을 찾을 방법이 없었다.
   *
   * 이미 값이 있으면 그대로 물려받는다 — 두 번째 이월에서 원본이 직전 행으로
   * 바뀌면 가리키는 곳이 매번 달라진다. **판정에는 쓰지 않는다**: 이월 여부·횟수·
   * 범위 관문은 위에서 정한 그대로다.
   */
  const carriedPendingActionOriginMessageId = awaitingPendingCard === null
    ? null
    : isRecord(previousCanonicalRow?.metadata)
      && typeof previousCanonicalRow.metadata
        .pending_amora_action_carry_origin_message_id === "string"
      ? previousCanonicalRow.metadata.pending_amora_action_carry_origin_message_id
      : previousCanonicalRow?.id ?? null;
  const classifiedQuestionScope = classifyAmoraQuestionScope({
    userText: lastUserText,
    requestKind,
    hasApprovedWeddingAction: Boolean(approvedPendingAction),
    hasTrustedPrivateDraftContext: !isDemo && requestKind === "chat"
      && isDurableUserMessageBound && visibility !== "shared",
    hasWeddingClarificationContinuity:
      Boolean(weddingClarificationContinuityWithFallback) || firstHelloAnswered,
  });
  // 예비 판정에서 이미 구제된 턴은 최종 판정도 같아야 한다. 여기서 다시
  // W4 로 떨어지면 자료만 읽고 도구는 닫히는 어긋난 상태가 된다.
  // **W4 일 때만** 대체한다 — 안전 축(W2·W5)에는 손대지 않는다.
  const questionScope =
    checklistScopeRescue !== null
    && classifiedQuestionScope.scope === "W4_out_of_scope"
      ? checklistScopeRescue
      : classifiedQuestionScope;
  /**
   * 안 누른 카드를 이 턴으로 **옮겨도 되는가.**
   *
   * 두 가지를 본다.
   *
   * 1. **범위** — 결혼 이야기(W0/W1)일 때만 옮긴다. 안전(W2·W5)·위로(W3)·
   *    범위 밖(W4) 턴에 결혼 카드가 붙으면, 사용자가 힘든 이야기를 하는 화면에
   *    "예산 5,500만원으로 바꿀까요?" 가 따라온다. 판정을 읽기만 하고 **느슨하게
   *    만들지 않는다** — 여기서 하는 일은 닫는 쪽뿐이다.
   * 2. **횟수** — 연속 2턴까지. 사용자가 두 번 다른 이야기를 했으면 그 제안은
   *    이 대화의 것이 아니다.
   *
   * 어느 쪽으로 멈추든 카드가 사라지지는 않는다. 원본 메시지에는 그대로 남는다.
   */
  const shouldCarryPendingCard =
    (questionScope.scope === "W0_wedding_core"
      || questionScope.scope === "W1_wedding_adjacent")
    && nextPendingCardCarries <= MAX_PENDING_CARD_CARRIES;
  // 한 문장이 두 연속성에 모두 걸릴 수 있다("네", "그렇게 해줘"). 그때는 되묻기
  // 연속성이 이긴다 — 범위가 W0이면 provider 입력은 이미 신뢰 이력 전체를 쓰므로
  // 여기서 만든 3턴 묶음은 쓰이지도 않고, 남겨두면 `linked_context_only`(도구 금지)
  // 라벨과 되살아난 도구가 정면으로 부딪혀 프롬프트 조립이 예외를 던진다.
  const boundedContinuity =
    !isDemo
    && requestKind === "chat"
    && isDurableUserMessageBound
    && !weddingClarificationContinuityWithFallback
    // 되묻기 연속성만이 아니라 **범위가 W0/W1 로 살아난 모든 경우**를 빼야 한다.
    // 체크리스트 구제(`shouldRescueChecklistScope`)도 W0 을 만드는데 여기서
    // 빠져 있었다. 그때 `linked_context_only`(도구 금지) 라벨과 되살아난 도구가
    // 부딪혀 `buildAmoraSystemPrompt` 가 예외를 던지고, 그 지점을 감싸는 try 가
    // 없어 **요청 클레임이 안 풀린 채 POST 가 500** 이 된다.
    //
    //   직전: "예식장 후보 두 곳을 비교해줘"(W0)
    //   현재: "만날 장소 정하고 예약 다 했는데 다음은 뭐야?"
    //         (커플의 체크리스트 항목 이름이라 구제가 걸린다)
    //
    // 도구 개수가 아니라 **범위**로 가른다 — 아래 조립부의
    // `hasEligibleLinkedScope` 가 요구하는 것과 같은 조건이다.
    && questionScope.scope !== "W0_wedding_core"
    && questionScope.scope !== "W1_wedding_adjacent"
    && typeof bodyUserMessageId === "string"
    && shouldLoadBoundedContinuity
      ? (() => {
          const trustedRows = selectAmoraTrustedHistoryRows({
            oldestFirstRows: [...boundedContinuityRows].reverse(),
            currentUserMessageId: bodyUserMessageId,
            visibility,
          }).reverse();
          const continuity = buildAmoraBoundedContinuity({
            newestFirstRows: trustedRows,
            currentMessageId: bodyUserMessageId,
            currentUserText: lastUserText,
            requesterUserId: actorId,
            visibility,
            segmentId: boundedContinuitySegmentId as string,
          });
          return appendAmoraBoundedToolResultHistory(continuity, trustedRows[1]?.metadata?.toolResults);
        })()
      : null;
  const memoryEnqueueRequested =
    questionScope.allowsLongTermMemory
    && !(visibility !== "shared" && Object.values(personalActionConversationConsent(lastUserText)).some(Boolean))
    && memoryEnabledForTurn
    && isAuxiliaryMemoryRuntimeEnabled();
  const allowsStoredProviderContext =
    requestKind === "chat"
    && (
      questionScope.scope === "W0_wedding_core"
      || questionScope.scope === "W1_wedding_adjacent"
    );
  const assertStoredContextTerminalReleasePrivacyEpochCurrent = async () => {
    // 인사와 W4도 화면 정리로 무효화된다. 저장 이후 표시 직전까지 같은 경계를 쓴다.
    if (isDemo) return;
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

  // D3: stage + specialist 계산. 문서는 텍스트의 모호한 표현보다 서버가
  // 검증한 첨부 종류를 우선해 계약/견적 검토 경로로 일관되게 보낸다.
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
  // 2026-09-03: 위 라우팅이 키워드로 고른 것인지, 단계 기본값으로 떨어진 것인지는
  // 여기서만 알 수 있다. 확인 카드 관문(제안 도구)이 그 둘을 구별해야 한다.
  const specialistMatchedByKeyword =
    allowsStoredProviderContext && stageTag !== null
      ? matchedSpecialistByKeyword(lastUserText)
      : false;

  // Private 모드 안내 (한 사람이 단독으로 아모라에게 털어놓는 채팅)
  const privacyPrefix = visibility === "bride_private" || visibility === "groom_private"
    ? (allowsStoredProviderContext
      ? `[PRIVATE_MODE] 이 메시지는 ${usesNeutralMemberPresentation ? "이 사용자" : visibility === "bride_private" ? "신부" : "신랑"} 분이 **상대방 모르게** 아모라에게만 털어놓는 비공개 대화입니다.\n`
      : "[PRIVATE_MODE] 이 메시지는 사용자의 개인 비공개 대화입니다.\n") +
      `- 상대방을 비난하거나 편드는 발언 금지. 객관적·공감적으로.\n` +
      `- 이 대화 내용은 절대 상대방의 채팅(shared/상대방의 private)에서 언급·인용하지 마세요. 시스템이 격리하지만 아모라도 의식적으로 분리.\n` +
      `- 이번 요청에 제공된 본인의 개인 문맥 안에서만 이어서 답하세요. 현재 취향을 이해했다는 응답과 장기 기억 저장은 다릅니다. 저장 결과 없이 미래의 기억 저장을 약속하지 마세요.\n` +
      `- 취향을 들었다면 현재 발화에 대한 확인을 별도 문장으로 답하세요. 공동 변경을 부탁하지 않았다면 공동 예산·일정·할 일을 바꾸지 않는다는 안내로 답변을 대신하지 마세요.\n` +
      `- 답변은 평소처럼 따뜻하고 실용적으로. 비공개라고 톤을 어둡게 하지 마세요.\n\n`
    : "";

  // Old deployed clients do not send userMessageId. They remain answer-compatible,
  // but may not execute a mutation because the intent is not bound to one DB row.
  const candidateTools = getAvailableChatTools({
    requestKind,
    isDurableUserMessageBound,
    tools: BETA_SAFE_TOOLS,
  });
  // 범위를 되살려도 도구 선택이 현재 발화만 보면 고리는 그대로 남는다.
  // `selectAmoraTools`/`selectAmoraPendingProposalTools`는 어휘로 의도를 고르는데
  // "응 넣어줘"에는 일정도 예산도 없다. 연속성이 증명된 턴에서만 직전 W0 발화를
  // 앞에 붙여 같은 의도를 다시 읽게 한다. 그 문장은 자기 턴에서 이미 W0로 판정돼
  // 같은 도구를 받았으므로 여기서 새로 열리는 권한은 없다.
  // 관문이 손으로 쓴 낱말 대신 **이 커플의 실제 항목 이름**을 보게 한다.
  // 항목이 없으면 빈 배열이고, 그러면 규칙이 아무것도 열지 않는다.
  // 범위 구제와 같은 목록을 본다(`collectAmoraChecklistLabels`). 한 벌만 둔다.
  const coupleChecklistLabels = collectAmoraChecklistLabels(
    isRecord(journey) ? journey.progress : undefined,
  );
  const carriedToolIntent =
    weddingClarificationContinuityWithFallback ?? toolIntentContinuity;
  const toolIntentText = carriedToolIntent
    ? `${carriedToolIntent.priorUserText}\n${lastUserText}`
    : lastUserText;
  const policySelectedTools = selectAmoraTools({
    availableTools: candidateTools,
    userText: toolIntentText,
    specialistType,
    checklistLabels: coupleChecklistLabels,
    attachmentKind,
  });
  const initialPlaceSearchToolChoice = getPlaceSearchToolChoice({
    userText: lastUserText,
    round: 0,
    tools: candidateTools,
  });
  // 도구를 **주는 것**과 **강제로 부르게 하는 것**을 나눈다. 예전에는 하나였고,
  // 그래서 지역명을 못 알아본 문장("공덕에 상견례 한정식집 찾아줘")에서 도구가
  // 목록에서 통째로 빠져 아모라가 "검색 기능이 지금 없어요" 라고 답했다
  // (2026-08-23 실측). 사용자에게는 제품이 못 하는 것으로 보인다.
  const offersPlaceSearch =
    initialPlaceSearchToolChoice !== undefined
    || isPlaceSearchCandidate(lastUserText);
  const selectedTools = offersPlaceSearch
    ? candidateTools.filter((tool) => (
        tool.name === PLACE_SEARCH_TOOL_NAME
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
  // 지금 실제로 쓸 수 없는 도구는 모델에게 주지 않는다. 주면 모델이 그것을 부르고,
  // 실행기가 "설정되지 않았습니다" 같은 내부 사정을 사용자에게 돌려준다 —
  // 이 저장소가 반복해서 고쳐온 부류다. 없는 기능을 설명하는 것보다 없는 편이 낫다.
  const runnableTools = visibilityScopedTools.filter((tool) => (
    tool.name !== "search_nearby_places" || isPlaceSearchConfigured()
  ));
  const personalConversationTools = selectPersonalActionConversationTools({
    tools: candidateTools, userText: lastUserText, visibility, requestKind,
    durable: !isDemo && isDurableUserMessageBound, scope: questionScope,
  });
  const personalConversationToolNames = new Set(personalConversationTools.map(tool => tool.name));
  const availableTools = [...filterAmoraToolsByQuestionScope(
    runnableTools.filter((tool) => !isMutatingTool(tool.name)),
    questionScope,
  ), ...personalConversationTools];
  const availableToolNameSet = new Set(
    availableTools.map((tool) => tool.name),
  );
  const questionScopeToolNameCeiling = new Set(
    [...filterAmoraToolsByQuestionScope(BETA_SAFE_TOOLS, questionScope)
      .map((tool) => tool.name), ...personalConversationToolNames],
  );
  const pendingProposalTools =
    !isDemo
    && requestKind === "chat"
    && isDurableUserMessageBound
    && visibility === "shared"
    && !approvedPendingAction
      ? filterAmoraToolsByQuestionScope(
          selectAmoraPendingProposalTools({
            availableTools: PENDING_ACTION_TOOLS,
            userText: toolIntentText,
            specialistType,
            specialistMatchedByKeyword,
            attachmentKind,
            checklistLabels: coupleChecklistLabels,
          }).filter(
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
          text: buildAmoraPendingActionPrompt(pendingProposalTools),
        }
      : undefined;
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
      })
        .map(toCanonicalMessage)
        .filter((message): message is NonNullable<typeof message> => message !== null)
    : typedMessages;
  /**
   * **W4 턴의 이력.** 저장 문맥과 갈라서 이력만 싣는다.
   *
   * `allowsStoredProviderContext`(W0/W1)는 한 글자도 건드리지 않았다 — 커플 프로필·
   * 예산·결정·요약·장기 기억과 도구는 여전히 그 관문 뒤에 있다. 여기서 더하는 것은
   * **같은 커플·같은 레인에서 사용자 본인이 한 발화와 그에 묶인 아모라 답**뿐이고,
   * 그 목록은 `selectAmoraTrustedHistoryRows` 가 안전 스크린(자해·폭력 신호)과
   * 범위 판정(W2·W3·W5 배제)을 행마다 다시 돌린 결과다.
   *
   * 이력이 한 줄도 안 남으면 null 로 두어 오늘과 **완전히 같은 입력**(현재 발화
   * 하나)을 쓴다. 라벨이 붙은 한 줄로 바꿔치우지 않는다.
   */
  const w4TrustedProviderMessages =
    !isDemo
    && requestKind === "chat"
    && !allowsStoredProviderContext
    && questionScope.scope === "W4_out_of_scope"
    && isDurableUserMessageBound
    && typeof bodyUserMessageId === "string"
      ? (() => {
          const historyMessages = selectAmoraTrustedHistoryRows({
            oldestFirstRows: w4TrustedHistoryContextRows ?? canonicalRows,
            currentUserMessageId: bodyUserMessageId,
            visibility,
          })
            .map(toCanonicalMessage)
            .filter((message): message is NonNullable<typeof message> => message !== null);
          return historyMessages.length > 1 ? historyMessages : null;
        })()
      : null;
  const providerMessages = allowsStoredProviderContext
    ? takeRecentAmoraConversation(trustedStoredProviderMessages)
    : boundedContinuity?.messages
      ?? (w4TrustedProviderMessages !== null
        ? takeRecentAmoraConversation(w4TrustedProviderMessages)
        : [{ role: "user" as const, content: lastUserText }]);
  const planningTurn = getAmoraPlanningTurn({
    requestKind,
    durable: !isDemo && isDurableUserMessageBound,
    scope: questionScope.scope,
    allowsStoredProviderContext,
    preparationStatus: normalizePreparationStatus(userProfile.preparation_status),
    // 연속성 신호는 일반 이유 답변에도 생긴다. 실제 요청·확인 카드만 우선한다.
    hasPriorityAction: Boolean(
      approvedPendingAction || awaitingPendingCard || offersPlaceSearch
      || personalConversationTools.length > 0 || isExplicitAmoraChangeRequest(lastUserText)
      || (carriedToolIntent && isExplicitAmoraChangeRequest(carriedToolIntent.priorUserText))
    ),
    hasAttachments: textAttachments.length > 0 || visionAttachments.length > 0,
    actorId: actorId ?? "",
    currentUserMessageId: currentCanonicalUserMessageId ?? "",
    currentUserText: lastUserText,
    oldestFirstRows: canonicalRows,
    providerMessages,
  });
  const promptContext = {
    // 준비 순서 목록은 시작점을 묻는 턴에만 싣는다 — 프롬프트 상한에 여유가 없다.
    startingPointAsked: asksWhereToStart(lastUserText),
    weddingDate: weddingDateForStage,
    budget: resolvedWeddingContext.budget,
    venue: resolvedWeddingContext.venue,
    progress,
    preparationStatus: normalizePreparationStatus(
      userProfile.preparation_status,
    ),
    brideName,
    groomName,
    // 프롬프트의 접두어 규칙이 런타임과 같은 문자열을 쓰게 한다.
    neutralMemberPresentation: usesNeutralMemberPresentation,
    senderName: safeSenderName,
    // Legacy booking rows are outside the current web MVP and are not sent
    // to the model merely because they still exist in the database.
    bookings: [],
    scheduleEvents,
    chatSummaries,
    preferences: preferences ?? undefined,
    helpPreference: personalizationProfile?.preferences ?? null,
    amoraProfiles: consentedAmoraProfiles,
    pastDecisions,
    pastConflicts,
  };
  const buildSystemPromptForTools = (enabledTools: typeof BETA_SAFE_TOOLS) =>
    preparationReferencePrefix + cautionPrefix + privacyPrefix + buildAmoraSystemPrompt(promptContext, {
      specialist: specialistType,
      requestKind,
      persistenceMode: isDemo ? "demo" : "durable",
      enabledToolNames: enabledTools.map((tool) => tool.name),
      actionContract,
      questionScope,
      linkedContextMode: boundedContinuity?.mode,
      awaitingCardConfirmation: awaitingPendingCard?.confirmation,
      planningTurn,
      maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
    });
  const systemPrompt = buildSystemPromptForTools(availableTools);
  const noToolSystemPrompt = availableTools.length > 0
    ? buildSystemPromptForTools([])
    : systemPrompt;

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
          evidenceSummaryContext: {
            requestKind,
            durable: isDurableUserMessageBound,
            isDemo,
            hasPriorityAction: Boolean(actionContract) || Boolean(awaitingPendingCard),
            hasPersonalTools: personalConversationTools.length > 0,
            hasAttachments: attachmentKind !== "none",
            offersPlaceSearch,
            toolNames: availableTools.map(tool => tool.name),
          },
        });
  const shouldBufferProviderText = Boolean(approvedPendingAction)
    || pendingOfferEnabled
    || requestKind === "mediation"
    || requiresW4AttachmentReuploadGuidance
    || boundedContinuity !== null
    // Replies built from stored couple context stay hidden until the database
    // atomically validates the exact privacy epoch and commits the message.
    || !isDemo
    // Demo has no durable write boundary. Buffer every demo chat response so
    // an unexpected completion claim can never flash before terminal scrubbing.
    || (isDemo && requestKind === "chat");
  const executionContext: ToolExecutionContext = {
    coupleId,
    ...(!isDemo ? { actorProfileId: actorId } : {}),
    requestKey: clientRequestId,
    requestAttemptCount: requestClaimAttemptCount ?? undefined,
    currentUserText: lastUserText,
    ...(personalConversationTools.length > 0 && visibility !== "shared" ? {
      personalActions: {
        visibility,
        readCount: async (status: "all" | "open" | "done") => {
          await assertStoredContextTerminalReleasePrivacyEpochCurrent();
          const count = await readPersonalActionConversationCount(supabase, actorId, coupleId, visibility, status);
          await assertStoredContextTerminalReleasePrivacyEpochCurrent();
          return count;
        },
      },
    } : {}),
    weddingContext: {
      weddingDate: resolvedWeddingContext.weddingDate,
      budget: resolvedWeddingContext.budget,
      venue: resolvedWeddingContext.venue,
      // The canonical type predates reserved __events/__preferences keys.
      // Runtime values have already passed the bounded structural normalizer.
      progress: resolvedWeddingContext.progress as ToolExecutionContext["weddingContext"]["progress"],
    },
  };

  const currentStoredStateReadRequest = !isDemo && requestKind === "chat" && isDurableUserMessageBound
    && visibility === "shared" && questionScope.scope === "W0_wedding_core"
    && !approvedPendingAction && !awaitingPendingCard && !storedActionQueue
    && attachmentKind === "none" && personalConversationTools.length === 0 && !offersPlaceSearch
    ? assessCurrentStoredStateRequest(lastUserText) : null;

  const providerTimeRemainingMs = requestDeadlineAt - Date.now();
  if (providerTimeRemainingMs <= 1_000) {
    await releaseClaimBeforeStream("CHAT_REQUEST_DEADLINE_EXCEEDED");
    return NextResponse.json(
      {
        error: "응답 준비 시간이 초과됐어요. 같은 요청으로 다시 시도해주세요.",
        code: "CHAT_REQUEST_DEADLINE_EXCEEDED",
        retryable: true,
        retryPolicy: "same_request",
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
      const buffersSensitiveToolEvents = !isDemo;
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
        const requiredReadResults = new Map<string, ToolExecutionResult>();
        const toolsUsed: string[] = [];
        let lockToolsAfterPlaceSearch = false;
        let toolCallCount = 0;
        let approvedPendingActionExecuted = false;
        let queuedProposal: ReturnType<typeof extractAmoraPendingAction> | null = null;
        let nextActionQueue: AmoraActionQueue | null = null;
        let nextActionRevision: number | null = null;
        let nextActionContext = executionContext;
        let queueCompletion: { queueId: string; totalCount: number; completedCount: number } | null = null;
        let queueResumeNotice: string | null = null;
        let queueStepSucceeded: boolean | null = null;
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
          if (storedActionQueue) {
            queueStepSucceeded = approvedResult.success;
            const remaining = storedActionQueue.remainingActions;
            if (!approvedResult.success) {
              // 실패 영수증에는 결과 불명·진행 중도 포함된다. 새 id를 주면 중복 방지
              // 원장을 우회하므로 자동 재제안을 하지 않고 먼저 현재 상태를 확인한다.
              queueResumeNotice = "이번 항목의 처리 결과를 먼저 확인해 주세요. 남은 항목은 실행하지 않았어요.";
            } else if (remaining.length === 0) {
              queueCompletion = { queueId: storedActionQueue.queueId, totalCount: storedActionQueue.totalCount, completedCount: storedActionQueue.totalCount };
            } else {
              // 적용 결과와 다음 제안의 기준은 다르다. 저장 뒤 최신 리비전을 다시 읽는다.
              const fresh = await supabase.from("wedding_journeys")
                .select("state_revision,total_budget,progress")
                .eq("couple_id", coupleId).maybeSingle();
              const revision = fresh.data?.state_revision;
              if (!fresh.error && fresh.data && typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0) {
                const candidate = remaining[0];
                queuedProposal = extractAmoraPendingAction({
                  text: `[pending_action]${JSON.stringify(candidate)}[/pending_action]`,
                  allowedTools: PENDING_ACTION_TOOLS,
                  now: Date.now(), createActionId: randomUUID,
                });
                if (queuedProposal.pendingAction) {
                  nextActionRevision = revision;
                  nextActionContext = { ...executionContext, weddingContext: {
                    ...executionContext.weddingContext,
                    budget: fresh.data.total_budget ?? executionContext.weddingContext.budget,
                    progress: (fresh.data.progress ?? {}) as ToolExecutionContext["weddingContext"]["progress"],
                  } };
                  nextActionQueue = advanceAmoraActionQueue(storedActionQueue, queuedProposal.pendingAction);
                }
              }
              if (!queuedProposal?.pendingAction) {
                // 이미 실행된 항목을 실패로 바꾸거나 다시 실행하지 않는다. 나머지 입력은 보존한다.
                queueResumeNotice = "이번 항목은 반영됐어요. 다음 확인을 준비할 최신 정보를 읽지 못했어요. 아래 남은 요청을 확인한 뒤 이어서 요청해 주세요.";
              }
            }
            if (queueResumeNotice) {
              const unresolved = approvedResult.success ? remaining
                : [{ tool: approvedPendingAction.tool, input: approvedPendingAction.input }, ...remaining];
              const descriptions = unresolved.map(item => describeAmoraQueuedAction(item, PENDING_ACTION_TOOLS, Date.now())).filter(Boolean);
              queueResumeNotice += `\n\n${approvedResult.success ? "아직 반영하지 않은 요청" : "처리 상태를 확인할 요청"}\n${descriptions.join("\n\n")}`;
            }
          }
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
          // 모델의 사고 서두를 먼저 걷어낸다. 아모라는 사용자에게 한국어로만
          // 말하므로, 한글이 하나도 없는 앞쪽 문단은 답이 아니라 사고다.
          // 2026-08-24 운영에서 영어 사고가 내부 표식까지 그대로 나갔다.
          const { cleanText: afterSuggest, suggestions } = extractSuggestions(
            stripAmoraReasoningPreamble(fullText),
          );
          const hasPriorityAction = Boolean(approvedPendingAction)
            || Boolean(awaitingPendingCard) || Boolean(queuedProposal?.pendingAction);
          const canUseCurrentStoredState = !isDemo && requestKind === "chat" && isDurableUserMessageBound
            && visibility === "shared" && questionScope.scope === "W0_wedding_core"
            && !hasPriorityAction && attachmentKind === "none" && personalConversationTools.length === 0
            && !offersPlaceSearch && toolResults.every(result => !isMutatingTool(result.toolName));
          const currentStoredStateRequest = canUseCurrentStoredState
            ? currentStoredStateReadRequest : null;
          const currentStoredStateText = currentStoredStateRequest
            ? formatCurrentStoredStateSummary({
                request: currentStoredStateRequest,
                sourceRevision: canonicalJourneyStateRevision,
                canonicalProgress: isRecord(journey) ? journey.progress : null,
                toolResults,
              }) : null;
          const personalNavigationText = personalConversationTools.length === 0 && !offersPlaceSearch
            ? getSharedPersonalActionNavigationReply({
                userText: lastUserText, visibility, requestKind, questionScope: questionScope.scope,
                durable: isDurableUserMessageBound, isDemo, hasPriorityAction,
                hasAttachments: attachmentKind !== "none",
              }) : null;
          // 서버 정본 조회와 실제 화면 이동 안내는 모델의 옛 시각·없는 버튼 문장을 남기지 않는다.
          // 이 본문도 기존 개인정보 epoch·원자적 저장·최종 SSE 경계를 그대로 통과한다.
          const unsupportedScheduleFieldsText = !isDemo && requestKind === "chat" && isDurableUserMessageBound
            && visibility === "shared" && questionScope.scope === "W0_wedding_core"
            && !approvedPendingAction && !queuedProposal?.pendingAction && !storedActionQueue
            && attachmentKind === "none" && personalConversationTools.length === 0 && !offersPlaceSearch
            && toolResults.every(result => !isMutatingTool(result.toolName))
            ? getUnsupportedScheduleFieldsReply(lastUserText, afterSuggest) : null;
          const canonicalTerminalText = currentStoredStateText ?? personalNavigationText ?? unsupportedScheduleFieldsText;
          // 현재 사용자가 완결된 금액 목록을 직접 확정했으면 모델의 누락·임의 분할보다
          // 원문을 우선한다. 여전히 같은 범위/도구 스키마/카드 확인 경계를 통과한다.
          const budgetAssessment = canonicalTerminalText === null && !isDemo && requestKind === "chat" && isDurableUserMessageBound
            && visibility === "shared" && questionScope.scope === "W0_wedding_core"
            && !approvedPendingAction && !queuedProposal?.pendingAction && !storedActionQueue
            && attachmentKind === "none" && personalConversationTools.length === 0 && !offersPlaceSearch
            && toolResults.every(result => !isMutatingTool(result.toolName))
            ? assessAmoraBudgetChange({ userText: lastUserText, context: executionContext, sourceRevision: canonicalJourneyStateRevision })
            : null;
          const assessedBudgetAction = pendingOfferEnabled && budgetAssessment?.kind === "ready"
            && pendingProposalTools.some(tool => tool.name === budgetAssessment.action.tool)
            ? budgetAssessment.action : null;
          const blockedBudgetText = budgetAssessment && !assessedBudgetAction
            ? budgetAssessment.kind === "ready"
              ? "변경할 예산 항목과 금액을 확인할 수 있는 제안을 만들지 못했어요. 아직 반영하지 않았어요. 변경할 내용을 다시 확인해주세요."
              : budgetAssessment.text
            : null;
          const explicitBudgetPlan = canonicalTerminalText === null && !budgetAssessment && pendingOfferEnabled && !approvedPendingAction
            && pendingProposalTools.some(tool => tool.name === "apply_budget_plan")
            ? parseExplicitBudgetPlanRequest(lastUserText, resolvedWeddingContext.progress, resolvedWeddingContext.budget) : null;
          // 명시 목록에 담당·기한·비공개·취소 조건이 섞이면 모델 표식으로 우회하지 않는다.
          // 적용할 수 있는 원문 목록과 다시 확인할 요청을 구분해 같은 승인 경계로 보낸다.
          const taskAssessment = canonicalTerminalText === null && !budgetAssessment && !explicitBudgetPlan && !queuedProposal?.pendingAction
            && !isDemo && requestKind === "chat" && isDurableUserMessageBound
            && visibility === "shared" && questionScope.scope === "W0_wedding_core" && !approvedPendingAction
            ? assessExplicitTaskRequest(lastUserText, afterSuggest) : null;
          const assessedTaskActions = taskAssessment?.kind === "ready" && pendingOfferEnabled
            && pendingProposalTools.some(tool => tool.name === "add_amora_action")
            ? taskAssessment.actions : null;
          const blockedTaskText = taskAssessment && !assessedTaskActions
            ? taskAssessment.kind === "ready"
              ? "할 일의 확인 카드를 준비하지 못했어요. 아직 추가하지 않았어요. 제목·설명·예정일을 다시 확인해 주세요."
              : taskAssessment.text
            : null;
          const effectiveSuggestions = canonicalTerminalText !== null || blockedBudgetText !== null || blockedTaskText !== null
            ? [] : suggestions;
          const pendingExtractionOptions = {
            allowedTools: canonicalTerminalText === null && pendingOfferEnabled ? pendingProposalTools : [],
            now: Date.now(),
            createActionId: randomUUID,
            // 일정을 가리키는 제안은 저장된 일정 id 만 카드가 된다(지어낸 id 차단).
            knownScheduleEventIds: new Set(
              (scheduleEvents as ReadonlyArray<{ id?: unknown }>)
                .map((event) => event.id)
                .filter((id): id is string => typeof id === "string" && id.length > 0),
            ),
          };
          let modelPendingExtraction = extractAmoraPendingAction({
            ...pendingExtractionOptions,
            // 초과 시 저장 금지처럼 조건이 붙은 단일 변경은 실제 장부로 판정한다.
            // 거절의 근거 수치도 모델 산문에서 가져오지 않으며 확인/실행 경계는 유지한다.
            text: canonicalTerminalText ?? blockedBudgetText ?? blockedTaskText ?? (assessedBudgetAction
              ? `[pending_action]${JSON.stringify(assessedBudgetAction)}[/pending_action]`
              : explicitBudgetPlan
              ? `[pending_action]${JSON.stringify({ tool: "apply_budget_plan", input: explicitBudgetPlan })}[/pending_action]`
              : afterSuggest),
          });
          const explicitSchedules = canonicalTerminalText === null && !budgetAssessment && !explicitBudgetPlan && !taskAssessment && !queuedProposal?.pendingAction
            && pendingOfferEnabled && !approvedPendingAction
            && pendingProposalTools.some(tool => tool.name === "add_schedule_event")
            ? parseExplicitScheduleRequest(lastUserText, afterSuggest)
            : null;
          const explicitActions = assessedTaskActions ?? explicitSchedules;
          if (explicitActions) {
            // 완결된 원문 목록으로 대체한다. 모델 목록에 덧붙이면 같은 항목이 중복 저장된다.
            modelPendingExtraction = extractAmoraPendingAction({
              ...pendingExtractionOptions,
              text: explicitActions.map(action => `[pending_action]${JSON.stringify(action)}[/pending_action]`).join("\n"),
            });
          }
          const pendingExtraction = queuedProposal?.pendingAction ? queuedProposal : modelPendingExtraction;
          const emittedCarriedPendingCard = canonicalTerminalText === null && blockedBudgetText === null && blockedTaskText === null
            && awaitingPendingCard && shouldCarryPendingCard
            ? awaitingPendingCard : null;
          const proposalRevision = queuedProposal?.pendingAction ? nextActionRevision : canonicalJourneyStateRevision;
          const proposalQueue = nextActionQueue ?? (pendingExtraction.pendingAction
            ? createAmoraActionQueue(pendingExtraction.pendingAction, pendingExtraction.remainingActions) : null);
          if (
            pendingExtraction.pendingAction
            && proposalRevision === null
          ) {
            throw new Error("AMORA_JOURNEY_REVISION_UNAVAILABLE");
          }
          const pendingBudgetImpactPreview = pendingExtraction.pendingAction
            && proposalRevision !== null
            ? buildAmoraBudgetImpactPreview({
                action: pendingExtraction.pendingAction,
                sourceRevision: proposalRevision,
                context: queuedProposal?.pendingAction ? nextActionContext : executionContext,
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
          const mediation = isStructuredMediation
            && extractedMediation
            ? toUserRequestedMediationV2(extractedMediation)
            : null;
          // 서버가 이미 고위험으로 판정했으면 모델이 무엇을 어떤 모양으로 써 보냈든
          // 합의안은 나가지 않는다. 예전에는 이 대체가 "완전한 4필드 블록이 왔고 블록
          // 밖 텍스트가 비어 있을 때"만 발동해서, 필드 하나가 빠진 블록이나 마커 없는
          // 산문이면 '조금씩 양보하세요'가 그대로 상대에게까지 저장됐다. 안전이 모델
          // 출력 형식에 달려 있으면 그건 안전장치가 아니다.
          const providerCleanText = isHighRiskMediation
            ? "이 사안은 합의안으로 단정하기보다 안전과 권리·건강에 관련된 확인이 먼저예요. 확인된 사실만 정리하고, 해당 분야의 자격 있는 전문가나 공식 기관에 문의할 질문을 준비해 주세요."
            : !isStructuredMediation
              && extractedMediation
              && !extractedMediationText
                ? mediationBlockToOrdinaryText(extractedMediation)
                : extractedMediationText;
          // 꼬리에 붙는 한국어 웹 스팸을 걷어낸다. 2026-08-25 운영에서 예산 요약
          // 끝에 업소 광고 문구가 그대로 붙어 나갔다.
          //
          // **표식을 다 걷어낸 뒤에** 본다. 처음에는 원문에 바로 걸었는데,
          // 그러면 답변 끝에 [suggestions]·[pending_action] 블록이 붙는 턴에서는
          // 스팸이 문자열 끝이 아니라 그 블록 앞에 있어 통째로 놓친다 —
          // 하필 예산·일정 저장 제안 턴이 그 모양이고, 사고가 난 턴도 예산이었다.
          //
          // 2026-09-03: 같은 자리에서 위생 계층을 하나 더 돌린다. 스팸 어휘 차단은
          // 차단 목록이라 목록 밖은 전부 지나갔고, 그 구멍으로 벵골 문자 조각
          // (`মাস행사`)이 운영 답변에 그대로 나갔다(2차 감사 Minor 2).
          const outputHygiene = requiresW4AttachmentReuploadGuidance
            ? { text: "", actions: [] as AmoraOutputHygieneAction[] }
            : applyAmoraOutputHygiene(providerCleanText, { userText: lastUserText });
          const cleanText = requiresW4AttachmentReuploadGuidance
            ? "지금 요청만으로는 이 파일이 결혼 준비와 어떤 관련이 있는지 확인할 수 없어요. 결혼 준비 관련 파일이라면 관련성을 한 줄로 알려주시고, 파일을 다시 첨부해 주세요."
            : outputHygiene.text;
          const persistenceClaimGuard = composeAmoraPersistenceTerminal({
            text: cleanText,
            toolResults,
            privatePreferenceMemoryRequestText: !isDemo && requestKind === "chat" && isDurableUserMessageBound
              && visibility !== "shared" && !hasPriorityAction && !storedActionQueue
              && attachmentKind === "none" && personalConversationTools.length === 0 && !offersPlaceSearch
              && toolResults.length === 0
              && (questionScope.scope === "W0_wedding_core" || questionScope.scope === "W1_wedding_adjacent"
                || (questionScope.scope === "W4_out_of_scope" && questionScope.confidence === "low" && questionScope.needsClarification))
                ? lastUserText : undefined,
            hasPendingAction: pendingExtraction.pendingAction !== null,
            hasEmittedPendingAction: pendingExtraction.pendingAction !== null
              || emittedCarriedPendingCard !== null,
            persistenceMode: isDemo ? "demo" : "durable",
            demoUserText: lastUserText,
            // 이번 턴에 제안 도구가 하나도 안 열렸다면 사용자는 변경을 요청한 것이
            // 아니다. 그때 "다시 요청해주세요" 안내를 붙이면 요청하지도 않은
            // 변경의 실패를 사과받는 셈이 된다.
            // 도구가 열린 것과 사용자가 변경을 요청한 것은 다르다(amoraPersistenceClaims 주석).
            userRequestedChange: pendingOfferEnabled && isExplicitAmoraChangeRequest(lastUserText),
            // 모델이 표식을 냈는데 검증에서 버려졌으면 카드가 안 나온다.
            // 본문이 중립적으로 쓰여 있으면 지울 거짓 주장도 없어 **아무 말도
            // 안 나가고** 사용자는 아무것도 저장되지 않는다.
            // 지어낸 일정 id 로 버린 경우는 전용 안내가 이미 본문에 있다 — 일반
            // "다시 보내주세요" 안내를 덧붙이면 같은 요청이 같은 이유로 또 버려진다.
            droppedPendingActionTag:
              pendingExtraction.hadPendingActionTag
              && pendingExtraction.pendingAction === null
              && pendingExtraction.dropReason === undefined,
          });
          // 2026-09-03 이중 안전망. 여기가 비면 원장에도 스트리밍에도 아무 글자가
          // 안 나가 사용자는 침묵만 본다(8/24 '같은 식별자로 다시 이어갈 수 없어요'
          // 하드 실패의 원인 후보). 빈 문자열을 만들지 않게 하는 근본 수정은
          // `composeAmoraPersistenceTerminal` 쪽에 따로 있고, 이것은 그 뒤의 그물이다.
          // 원장 검증은 그대로 — 대체한 뒤의 문자열이 그대로 원장으로 간다.
          if (
            pendingExtraction.hadPendingActionTag
            && pendingExtraction.pendingAction === null
            && pendingExtraction.dropReason === undefined
          ) {
            // 모델 출력도 비공개 내용을 포함할 수 있다. 원문과 커플 ID 대신
            // 요청 해시·서버 도구 이름·파서가 정한 고정 실패 모양만 남긴다.
            console.warn("[chat] pending action tag dropped", {
              requestCorrelationId,
              offeredTools: pendingOfferEnabled
                ? pendingProposalTools.map((tool) => tool.name)
                : [],
              shapes: pendingExtraction.droppedShapes ?? [],
            });
          }
          const queueText = queuedProposal?.pendingAction && nextActionQueue
            ? `${nextActionQueue.totalCount}건 중 ${nextActionQueue.completedCount}건 반영했어요. 다음 항목을 확인해 주세요.\n\n${queuedProposal.pendingAction.confirmation}`
            : queueResumeNotice;
          const persistenceSafeText = ensureNonEmptyTerminalText(
            [persistenceClaimGuard.text, queueText].filter(Boolean).join("\n\n"),
          );
          const metadata: Record<string, unknown> = {
            toolResults: getPersistableToolResults(toolResults),
            ...(currentStoredStateText !== null ? { current_stored_state_summary: true } : {}),
            ...(personalNavigationText !== null ? { personal_action_navigation: true } : {}),
            ...(unsupportedScheduleFieldsText !== null ? { unsupported_schedule_fields: true } : {}),
            ...personalActionConversationMetadata(toolResults, personalConversationToolNames),
            toolsUsed,
            senderName: safeSenderName,
            ...(outputHygiene.actions.length > 0
              ? { output_hygiene: outputHygiene.actions }
              : {}),
            ...(persistenceSafeText !== persistenceClaimGuard.text
              ? { terminal_text_empty_fallback: true }
              : {}),
            // 2026-09-03 관측용. 모델이 표식을 냈는데 검증에서 버려진 턴을 원장에서
            // 셀 수 있어야 한다 — 카드 0건의 원인이 도구 선택인지 표식 형식인지
            // 지금은 사후에 가릴 방법이 없다. 정책은 그대로다(같은 조건으로
            // `droppedPendingActionTag` 가 이미 안내 문구를 붙인다).
            ...(pendingExtraction.hadPendingActionTag
              && pendingExtraction.pendingAction === null
              ? {
                  pending_action_dropped: true,
                  ...(pendingExtraction.dropReason
                    ? { pending_action_drop_reason: pendingExtraction.dropReason }
                    : {}),
                }
              : {}),
            question_scope: questionScope.scope,
            memory_eligible: questionScope.allowsLongTermMemory && personalConversationTools.length === 0,
            memory_enqueue_requested: memoryEnqueueRequested,
            ...(boundedContinuity
              ? {
                  context_mode: boundedContinuity.mode,
                  context_capabilities: boundedContinuity.capabilities,
                }
              : {}),
            ...(typeof bodyUserMessageId === "string"
              ? { in_reply_to_user_message_id: bodyUserMessageId }
              : {}),
            // `confirmed_amora_action_id`는 **사용자 확인 행의 표식**이다.
            //
            // 아모라 응답 행에 같은 키를 찍으면 DB 트리거가 그 행도 확인 행으로 보고
            // `role <> 'user'` 에서 거부한다(AMORA_SHARED_ACTION_CONFIRMATION_INVALID,
            // 22023). 그러면 **변경은 이미 적용됐는데 아모라 응답만 커밋되지 않아**
            // 사용자는 침묵과 오류를 본다 — 돈·날짜가 바뀐 턴에서 가장 나쁜 결과다.
            // 2026-08-22 스테이징에서 확인 턴 4/4 재현.
            //
            // 이 키를 응답 행에서 읽는 소비자는 없다. 웹·모바일 모두 사용자 행에서만
            // 읽고(`sender_role !== "ai"` 요구), 나머지는 `=== undefined` 로 일반
            // 메시지를 가려낸다. 응답과 확인의 연결은 `in_reply_to_user_message_id`가
            // 이미 갖고 있다.
            ...(visibleClientRequestKey !== clientRequestId
              ? { client_visible_request_id: visibleClientRequestKey }
              : {}),
            ...(effectiveSuggestions.length > 0 ? { suggestions: effectiveSuggestions } : {}),
            ...(mediation ? { mediation } : {}),
            ...(proposalQueue ? { pending_amora_action_queue: proposalQueue } : {}),
            ...(queueCompletion ? { completed_amora_action_queue: queueCompletion } : {}),
            ...(queueResumeNotice && storedActionQueue ? { deferred_amora_action_queue: {
              queueId: storedActionQueue.queueId, totalCount: storedActionQueue.totalCount,
              completedCount: storedActionQueue.completedCount + (queueStepSucceeded ? 1 : 0),
              remainingActions: queueStepSucceeded
                ? storedActionQueue.remainingActions
                : [{ tool: approvedPendingAction!.tool, input: approvedPendingAction!.input }, ...storedActionQueue.remainingActions],
            } } : {}),
            ...(pendingExtraction.pendingAction
              ? {
                  pending_amora_action: pendingExtraction.pendingAction,
                  pending_amora_action_journey_revision:
                    proposalRevision,
                  ...(pendingBudgetImpactPreview
                    ? {
                        pending_amora_action_impact_preview:
                          pendingBudgetImpactPreview,
                      }
                    : {}),
                }
              // **아직 안 누른 카드를 새 답변으로 옮긴다.**
              //
              // 화면은 카드가 **최신 공유 메시지**에 있을 때만 누를 수 있게 한다
              // (`getPendingActionDisabledReason` 의 `not_latest`). 그래서 사용자가
              // 버튼 대신 "응 그렇게 해줘" 라고 치는 순간 그 카드가 잠긴다 —
              // 그런데 오늘 넣은 안내는 바로 그 버튼을 누르라고 말한다.
              // 아모라가 "이대로 적용을 누르세요" 라고 하는데 버튼에는
              // "새 대화가 이어져 이 제안은 적용할 수 없어요" 가 떠 있었다.
              //
              // 새 권한을 만드는 것이 아니다. **같은 action_id·같은 만료·같은
              // 입력**을 최신 답변으로 옮기기만 한다. 실행은 여전히 서버가 발급한
              // id 를 받아야 하고, 저니 리비전도 원래 값을 그대로 들고 간다 —
              // 그 사이 계획이 바뀌었으면 적용은 정상적으로 거부된다.
              //
              // **끝이 있어야 한다(2026-09-02).** 이월에 상한도 범위 관문도
              // 없어서, 안 누른 카드 하나가 무관한 답변 8개를 43분간 따라다닌
              // 일이 운영에 있었다. 그리고 안전·위로 대화 턴에까지 결혼 카드가
              // 붙었다 — 그 자리에 있어서는 안 되는 것이다.
              //
              // 멈춘다고 카드가 사라지지는 않는다. **원본 메시지에는 그대로
              // 남아 있고**, 따라다니기만 그친다.
              : emittedCarriedPendingCard
                ? {
                    pending_amora_action: emittedCarriedPendingCard,
                    ...(storedActionQueue ? { pending_amora_action_queue: storedActionQueue } : {}),
                    pending_amora_action_carry_count: nextPendingCardCarries,
                    ...(carriedPendingActionOriginMessageId !== null
                      ? {
                          pending_amora_action_carry_origin_message_id:
                            carriedPendingActionOriginMessageId,
                        }
                      : {}),
                    ...(carriedPendingActionRevision !== null
                      ? {
                          pending_amora_action_journey_revision:
                            carriedPendingActionRevision,
                        }
                      : {}),
                    ...(carriedPendingActionImpactPreview
                      ? {
                          pending_amora_action_impact_preview:
                            carriedPendingActionImpactPreview,
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
            suggestions: effectiveSuggestions,
            pendingExtraction,
            persistenceClaimGuard,
            metadata,
          };
        };

        // 현재 저장값 요청에 필요한 읽기는 모델의 호출 여부·상태 필터에 맡기지 않는다.
        // 실제 기존 조회를 각 한 번 실행하며 민감 결과는 최종 원자적 커밋 전까지 버퍼에 둔다.
        for (const requiredRead of currentStoredStateReadRequest
          ? getRequiredCurrentStoredStateReads(currentStoredStateReadRequest) : []) {
          if (!questionScopeToolNameCeiling.has(requiredRead.tool) || !availableToolNameSet.has(requiredRead.tool)) continue;
          if (toolCallCount >= AMORA_MAX_TOOL_CALLS_PER_TURN) break;
          if (preMutationAbortController.signal.aborted) throw new DOMException("Chat request aborted before required read", "AbortError");
          await assertPrivacyContextStillCurrent();
          toolCallCount += 1;
          sendSensitiveToolEvent({
            type: "tool_start", toolName: requiredRead.tool,
            toolInput: getClientSafeToolInput(requiredRead.tool, requiredRead.input),
          });
          const readResult = await executeTool(requiredRead.tool, requiredRead.input, executionContext);
          await assertPrivacyContextStillCurrent();
          if (preMutationAbortController.signal.aborted) throw new DOMException("Chat request aborted after required read", "AbortError");
          requiredReadResults.set(requiredRead.tool, readResult);
          toolsUsed.push(requiredRead.tool);
          toolResults.push(readResult);
          sendSensitiveToolEvent({ type: "tool_result", result: getClientSafeToolResult(readResult) });
        }

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
              costGuard: {
                coupleId: dataCoupleId,
                isAdmin: userProfile?.is_admin === true,
                isQuotaExempt,
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
            async (reserveBeforeGeneration, reserveBeforeSideEffect) => {
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
                    }) ?? getPersonalActionDraftToolChoice({
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
                beforeProviderEgress: assertPrivacyContextStillCurrent,
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
              const storedSuggestions = getStoredSuggestions(insertResult);
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
              metadata: getDoneMetadata(insertResult),
            });

            if (insertResult.reused) {
              closeStream();
              return;
            }

            // D1: 성공 turn 로깅 (fire-and-forget)
            if (!isDemo) logAIInteractionAfterResponse({
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
                stage_tag: stageTag,
                question_scope: questionScope.scope,
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

          // UI 카드로 자동 렌더링되는 도구 목록.
          //
          // 이 판정이 클라이언트를 구분하지 않아서, 카드가 없는 앱에서도 모델에게
          // "텍스트로 나열하지 마세요" 라고 지시했다. 모바일에는 견적·계약 확인·
          // 하객 보증 카드가 없으므로 모델은 1~2문장만 남기고, 정작 누락 항목·확인
          // 질문·계산 결과는 **어디에도 나타나지 않았다.**
          //
          // 클라이언트가 자기가 그릴 수 있는 목록을 보내면 그것만 카드로 친다.
          // 헤더가 없으면(웹) 지금까지처럼 전부 카드로 본다.
          const WEB_RENDERED_TOOLS = [
            "search_vendors", "recommend_vendors", "get_vendor_detail",
            "get_available_slots", "create_booking", "cancel_booking", "search_nearby_places",
            "analyze_quote", "simulate_guest_guarantee",
          ] as const;
          const declaredRenderedTools = request.headers
            .get("x-hanbang-rendered-tools")
            ?.split(",")
            .map((name) => name.trim())
            // 클라이언트가 모르는 이름을 보내도 목록이 넓어지지 않는다.
            .filter((name): name is (typeof WEB_RENDERED_TOOLS)[number] =>
              (WEB_RENDERED_TOOLS as readonly string[]).includes(name),
            );
          const UI_RENDERED_TOOLS = new Set<string>(
            declaredRenderedTools && declaredRenderedTools.length > 0
              ? declaredRenderedTools
              : WEB_RENDERED_TOOLS,
          );

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
          // 유저가 보낸 canonical 마지막 메시지만 신뢰한다. Provider가 생성한
          // output item을 다시 훑어 태그 권한을 추론하지 않는다.
          const hasQuoteAnalysisTag = lastUserText.includes("[quote_analysis]");

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

            const completedRequiredRead = requiredReadResults.get(toolUse.name);
            if (completedRequiredRead) {
              // provider가 open만 요청해도 실제 all 조회의 출처를 바꾸거나 다시 실행하지 않는다.
              // 성공·실패 모두 같은 실제 조회 결과이며 가짜 function_call이나 새 실행 영수증을 만들지 않는다.
              await assertPrivacyContextStillCurrent();
              toolResultInputs.push(buildToolResultInput(toolUse.callId, boundAmoraToolResultJson({
                ...getModelSafeToolOutput(completedRequiredRead),
                actual_read_input: completedRequiredRead.toolInput,
                success: completedRequiredRead.success,
              }, Math.min(AMORA_MAX_TOOL_RESULT_CHARS,
                Math.floor(AMORA_MAX_TOOL_FEEDBACK_CHARS_PER_TURN / AMORA_MAX_TOOL_CALLS_PER_TURN)))));
              continue;
            }
            toolsUsed.push(toolUse.name);

            // analyze_quote 방어: [quote_analysis] 태그 없이 included_items가 있으면 강제로 비움
            if (toolUse.name === "analyze_quote" && !hasQuoteAnalysisTag) {
              const inp = toolUse.input as Record<string, unknown>;
              if (Array.isArray(inp.included_items) && (inp.included_items as string[]).length > 0) {
                inp.included_items = [];
              }
            }

            sendSensitiveToolEvent({
              type: "tool_start",
              toolName: toolUse.name,
              toolInput: getClientSafeToolInput(toolUse.name, toolUse.input),
            });
            const execResult = await executeTool(toolUse.name, toolUse.input, {
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
            costGuard: {
              coupleId: dataCoupleId,
              isAdmin: userProfile?.is_admin === true,
              isQuotaExempt,
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
          async (reserveBeforeGeneration) => {
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
              beforeProviderEgress: assertPrivacyContextStillCurrent,
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
          const storedSuggestions = getStoredSuggestions(insertResult2);
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
          metadata: getDoneMetadata(insertResult2),
        });

        if (insertResult2.reused) {
          closeStream();
          return;
        }

        // D1: MAX_TOOL_ROUNDS 초과 후 성공 turn 로깅 (fire-and-forget)
        if (!isDemo) logAIInteractionAfterResponse({
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
            stage_tag: stageTag,
            question_scope: questionScope.scope,
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
          )
        );
        // 2026-09-03: 생성이 시작된 뒤 실패하면 exactRetryAllowed 가 항상 false 라
        // 원인과 무관하게 "같은 식별자로 다시 이어갈 수 없어요"만 나갔다. 재시도
        // 허용 판정은 그대로 두고 문구만 원인별로 가른다. 프로바이더 오류는
        // normalizeOpenAIProviderError 가 메시지를 정규화해 timeout/abort 문자열이
        // 남지 않으므로, 취소 신호와 정규화된 category 로 판별한다.
        const providerErrorCategory = normalizeOpenAIProviderError(err).category;
        const endedByDeadlineOrAbort =
          deadlineAbortController.signal.aborted
          || providerErrorCategory === "timeout"
          || providerErrorCategory === "aborted";
        log.error("채팅 API 에러:", safeChatFailureLogError(err));
        if (requestClaimAcquired) {
          await failChatRequest({
            ...claimParams,
            failureCode: publicErrorCode ?? "CHAT_TURN_FAILED",
          }).catch((claimError) => {
            log.error("[chat] durable request failure marker failed", claimError);
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
              ? inputStreamError?.code === "AMORA_INPUT_TOO_LARGE"
                ? inputStreamError.message
                : privacyContextErrorCode
                  ? "개인정보 설정이 변경되었거나 안전하게 확인되지 않았어요. 최신 설정에서 새 메시지로 다시 보내주세요."
                  : endedByDeadlineOrAbort
                    ? "응답 시간이 초과되었습니다. 다시 시도해주세요."
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
        if (!isDemo) logAIInteractionAfterResponse({
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
            stage_tag: stageTag,
            question_scope: questionScope.scope,
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
