import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  chatWithToolsStream,
  buildToolResultInput,
  buildMultimodalContent,
  OpenAIInputTokenLimitError,
  OpenAIResponseError,
} from "@/lib/ai/openai";
import type {
  ChatMessageInput,
  ChatResponseInput,
  ImageAttachment,
  NormalizedOpenAIUsage,
} from "@/lib/ai/openai";
import {
  getWeddingPlannerSystemPrompt,
  getWeddingPlannerUntrustedContext,
} from "@/lib/ai/prompts";
import { loadFeedbackLessons } from "@/lib/ai/feedbackLessons";
import { WEDDING_TOOLS } from "@/lib/ai/tools";
import { executeTool } from "@/lib/ai/toolExecutor";
import { extractSuggestions } from "@/lib/ai/chatSuggestions";
import { countRecentConsecutiveDissatisfaction } from "@/lib/ai/dissatisfaction";
import {
  getRuntimeToolContract,
  serializeUntrustedToolResultForModel,
} from "@/lib/ai/runtimeToolContract";
import { selectAmoraToolsForTurn } from "@/lib/ai/toolSelection";
import { determineStage, routeSpecialist, getSpecialistPromptAddon } from "@/lib/ai/stage-router";
import { calcCostUsd, logAIInteraction, startLatencyClock, elapsedMs } from "@/lib/compliance/ai-log";
import { maybeSummarize } from "@/lib/ai/summarize";
import { maybeExtractDecision } from "@/lib/ai/extract-decision";
import { extractMediation } from "@/lib/ai/mediation";
import { maybeClassifyExcavation } from "@/lib/ai/classify-excavation";
import { maybeUpdateAmoraProfile } from "@/lib/ai/amora-profile";
import { VERIFIED_PARTNER_EXCLUDED_PROVENANCE } from "@/lib/ai/derivedMemoryPrivacy";
import {
  checkAmoraCostGuard,
  markAmoraProviderStarted,
  reserveAmoraProviderCall,
  reserveAmoraUserTurn,
  type CostGuardResult,
} from "@/lib/ai/costGuard";
import { createSafetyIdentifier } from "@/lib/ai/safetyIdentifier";
import { chooseAmoraChatModelRole, hasOpenAIConfig } from "@/lib/ai/modelConfig";
import {
  ChatExecutionClaimError,
  claimChatExecution,
  createChatRequestIdentity,
  markChatExecutionFailed,
} from "@/lib/ai/chatExecutionClaim";
import {
  ChatRequestError,
  assertChatContentLength,
  parseClientChatContext,
  parseInlineAttachment,
  readBoundedJsonBody,
  resolveChatContext,
  sanitizeTrustedDisplayName,
} from "@/lib/ai/chatRequest";
import { NextResponse } from "next/server";
import {
  hasImmediateKoreanCrisisSignal,
  KOREAN_CRISIS_SAFETY_RESPONSE,
} from "@/lib/ai/crisisSafety";
import {
  hasImmediateKoreanRelationshipViolenceSignal,
  KOREAN_RELATIONSHIP_VIOLENCE_SAFETY_RESPONSE,
} from "@/lib/ai/relationshipViolenceSafety";
import type { ToolExecutionResult } from "@/types/database.types";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import {
  buildCanonicalChatTranscript,
  CanonicalChatTranscriptError,
  type CanonicalChatRow,
} from "@/lib/ai/canonicalChatTranscript";
import { isUuid } from "@/utils/requestValidation";
import {
  sanitizeProviderImage,
  type ChatImageMediaType,
} from "@/lib/chat/providerImageSanitization";
import { attachmentProviderConsentVersion } from "@hanbang/shared";

// 웹 클라이언트 180초 제한보다 먼저 종료해 플랫폼 강제 종료와 유령 과금을 피한다.
export const maxDuration = 175;

// 비용 상한: 선택된 Luna/Terra 모델로 도구 선택 1회 + 결과 설명 1회가 최대다.
// 연쇄 도구 계획은 한 사용자 턴에 허용하지 않는다.
const MAX_TOOL_ROUNDS = 1;
const AMORA_USAGE_LIMIT_MODE =
  process.env.AMORA_USAGE_LIMITS_ENABLED === "true" ? "enforced" : "unlimited_test";
const CHAT_ROUTE_DEADLINE_MS = 170_000;
const MAX_CHAT_OUTPUT_TOKENS = 800;
function boundedIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}
// 배포 변수는 상한을 낮출 수만 있다. 이전 배포의 큰 값이 남아 있어도
// Luna/Terra 입력 비용이 다시 커지지 않도록 48K를 코드 상한으로 둔다.
const MAX_CHAT_INPUT_TOKENS = boundedIntegerEnv(
  "AMORA_MAX_INPUT_TOKENS",
  48_000,
  1_000,
  48_000
);

class AmoraCostGuardError extends Error {
  constructor(readonly result: CostGuardResult) {
    super(result.message ?? "아모라 비용 안전 한도에 도달했습니다.");
    this.name = "AmoraCostGuardError";
  }
}
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_ATTACHMENTS = 3;
const MAX_TOTAL_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 2 * 1024 * 1024;
const MAX_PDF_PAGES = 20;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_CONTEXT_MESSAGES = 20;
const MAX_SINGLE_MESSAGE_CHARS = 6_000;
const MAX_TOTAL_MESSAGE_CHARS = 24_000;
// Hidden post-response model jobs can outlive account/private deletion and add
// unpredictable Luna spend. Keep them code-hard-disabled until each write has
// the same lifecycle lock and durable job cancellation semantics as main chat.
const ENABLE_AUXILIARY_MEMORY = false;

// SECURITY LIMIT: the current request transcript is client supplied and does
// not carry a server-verifiable audience. The route therefore accepts only the
// current persisted message ID and rebuilds context from canonical DB rows.

// Service role 클라이언트 (RLS 우회 — 자동 피드백 저장용)
function getServiceClient() {
  return createAdminClient();
}

// request claim 완료와 AI 메시지 INSERT를 한 DB 트랜잭션에서 확정한다.
// private 응답은 삭제 세대가 바뀌지 않았을 때만 같은 profile row lock 안에서 저장된다.
async function completeAiMessage(params: {
  userId: string;
  coupleId: string;
  cleanText: string;
  clientRequestId: string;
  requestKey: string;
  requestHash: string;
  expectedPrivateClearedAt: string | null;
  expectedMembershipGeneration: number;
  expectedCoupleContextGeneration: number;
  metadata: Record<string, unknown>;
  stageTag: string | null;
  specialistType: string | null;
  visibility: "shared" | "bride_private" | "groom_private";
  audit: {
    userInput: string | null;
    aiOutput: string | null;
    latencyMs: number;
    model: string | null;
    tokensInput: number | null;
    tokensOutput: number | null;
    costUsd: number | null;
    metadata: Record<string, unknown>;
  };
}): Promise<{ id: string | null; createdAt: string | null }> {
  const admin = getServiceClient();
  if (!params.cleanText) {
    throw new Error("완료할 AI 메시지 내용이 없습니다.");
  }

  const { data, error } = await admin.rpc("complete_amora_chat_request", {
    p_user_id: params.userId,
    p_couple_id: params.coupleId,
    p_request_key: params.requestKey,
    p_request_hash: params.requestHash,
    p_content: params.cleanText,
    p_metadata: { ...params.metadata, client_request_id: params.clientRequestId },
    p_stage_tag: params.stageTag,
    p_specialist_type: params.specialistType,
    p_visibility: params.visibility,
    p_expected_private_cleared_at: params.expectedPrivateClearedAt,
    p_expected_membership_generation: params.expectedMembershipGeneration,
    p_expected_couple_context_generation: params.expectedCoupleContextGeneration,
    p_audit_user_input: params.audit.userInput,
    p_audit_ai_output: params.audit.aiOutput,
    p_audit_latency_ms: params.audit.latencyMs,
    p_audit_model: params.audit.model,
    p_audit_tokens_input: params.audit.tokensInput,
    p_audit_tokens_output: params.audit.tokensOutput,
    p_audit_cost_usd: params.audit.costUsd,
    p_audit_metadata: params.audit.metadata,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.message_id !== "string" || typeof row.created_at !== "string") {
    throw new Error("complete_amora_chat_request returned an invalid result");
  }
  return { id: row.message_id, createdAt: row.created_at };
}

async function replayCompletedChatMessage(
  admin: ReturnType<typeof getServiceClient>,
  coupleId: string,
  messageId: string
): Promise<Response | null> {
  const event = await loadCompletedChatEvent(admin, coupleId, messageId);
  if (!event) return null;

  return new Response(`data: ${JSON.stringify(event)}\n\n`, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

async function loadCompletedChatEvent(
  admin: ReturnType<typeof getServiceClient>,
  coupleId: string,
  messageId: string
): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from("chat_messages")
    .select("id, content, metadata, stage_tag, specialist_type, created_at")
    .eq("id", messageId)
    .eq("couple_id", coupleId)
    .maybeSingle();
  if (error || !data || typeof data.content !== "string") return null;

  const storedMetadata =
    data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? data.metadata as Record<string, unknown>
      : {};
  const event = {
    type: "done",
    fullContent: data.content,
    metadata: {
      ...storedMetadata,
      stageTag: data.stage_tag,
      specialistType: data.specialist_type,
      serverMessageId: data.id,
      serverCreatedAt: data.created_at,
      idempotencyReplayed: true,
    },
  };
  return event;
}

async function reconcileChatRequestFinalState(
  admin: ReturnType<typeof getServiceClient>,
  params: {
    requestKey: string;
    requestHash: string;
    reason:
      | "preflight_denied"
      | "provider_limit"
      | "aborted"
      | "timeout"
      | "input_too_large"
      | "provider_error"
      | "tool_error"
      | "authorization_changed"
      | "request_failed"
      | "completed";
  }
): Promise<{ finalStatus: "completed" | "failed"; messageId: string | null; visibleRefunded: boolean }> {
  const { data, error } = await admin.rpc("fail_amora_chat_request", {
    p_request_key: params.requestKey,
    p_request_hash: params.requestHash,
    p_reason: params.reason,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || (row.final_status !== "completed" && row.final_status !== "failed")) {
    throw new Error("fail_amora_chat_request returned an invalid result");
  }
  return {
    finalStatus: row.final_status,
    messageId: typeof row.message_id === "string" ? row.message_id : null,
    visibleRefunded: row.visible_refunded === true,
  };
}

function classifyAmoraFailureForLedger(error: unknown):
  | "provider_limit"
  | "aborted"
  | "timeout"
  | "input_too_large"
  | "provider_error"
  | "tool_error"
  | "authorization_changed"
  | "request_failed" {
  if (error instanceof AmoraCostGuardError) return "provider_limit";
  if (error instanceof OpenAIInputTokenLimitError) return "input_too_large";
  if (error instanceof OpenAIResponseError) return "provider_error";
  const name = error instanceof Error ? error.name.toLowerCase() : "";
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (name === "aborterror" || message.includes("abort")) return "aborted";
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (message.includes("authorization") || message.includes("membership") || message.includes("account deleting")) {
    return "authorization_changed";
  }
  if (message.includes("tool")) return "tool_error";
  return "request_failed";
}

function safeChatErrorCode(error: unknown): string {
  if (error instanceof AmoraCostGuardError) {
    return `cost_guard_${error.result.reason ?? "denied"}`;
  }
  if (error instanceof OpenAIInputTokenLimitError) return "openai_input_token_limit";
  if (error instanceof OpenAIResponseError) return "openai_response_error";
  if (error instanceof Error && error.name === "AbortError") return "request_aborted";

  const record = error && typeof error === "object"
    ? error as { name?: unknown; status?: unknown; code?: unknown }
    : {};
  const cleanToken = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
    return cleaned || null;
  };
  const parts = ["chat_request_failed"];
  const name = cleanToken(record.name);
  const code = cleanToken(record.code);
  const status = typeof record.status === "number" && Number.isSafeInteger(record.status)
    ? record.status
    : null;
  if (name) parts.push(`name_${name}`);
  if (status !== null) parts.push(`status_${status}`);
  if (code) parts.push(`code_${code}`);
  return parts.join(":").slice(0, 240);
}

function safeToolErrorCode(toolOutput: Record<string, unknown>): string {
  const error = toolOutput.error;
  return typeof error === "string" && /^[a-z][a-z0-9_]{0,63}$/i.test(error)
    ? error
    : "tool_execution_failed";
}

// 첨부파일 처리: OpenAI Responses API에 보낼 형태로 변환
interface ProcessedAttachment {
  visionAttachments: ImageAttachment[]; // 이미지/PDF → OpenAI image/file input
}

const IMAGE_TYPES: readonly ChatImageMediaType[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];
function getCleanBase64(value: string): string {
  const commaIndex = value.indexOf(",");
  const isDataUrl = value.startsWith("data:") && commaIndex > -1 && value.slice(0, commaIndex).includes(";base64");
  return (isDataUrl ? value.slice(commaIndex + 1) : value).replace(/\s/g, "");
}

function getBase64ByteLength(value: string): number {
  const clean = getCleanBase64(value);
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function assertBase64UnderLimit(value: string): string {
  const clean = getCleanBase64(value);
  if (getBase64ByteLength(clean) > MAX_FILE_SIZE) {
    throw new Error("첨부파일 크기 초과");
  }
  return clean;
}

function safeFileName(value: string | undefined, fallback: string): string {
  return (value ?? fallback).replace(/[^\w .()[\]\-가-힣]/g, "").slice(0, 120) || fallback;
}

function isChatImageMediaType(mediaType: string): mediaType is ChatImageMediaType {
  return (IMAGE_TYPES as readonly string[]).includes(mediaType);
}

function assertSupportedPdfBuffer(buffer: Buffer): void {
  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new Error("PDF 크기 초과");
  }
  if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("PDF 파일 형식이 올바르지 않습니다.");
  }
  const source = buffer.toString("latin1");
  const directPages = source.match(/\/Type\s*\/Page(?!s)\b/g)?.length ?? 0;
  const declaredCounts = [...source.matchAll(/\/Count\s+(\d+)/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  const pageCount = Math.max(directPages, ...declaredCounts, 0);
  if (pageCount === 0) {
    throw new Error("PDF 페이지 수를 확인할 수 없습니다.");
  }
  if (pageCount > MAX_PDF_PAGES) {
    throw new Error(`PDF는 ${MAX_PDF_PAGES}페이지 이하만 지원합니다.`);
  }
}

async function processAttachments(
  attachments: unknown[],
  signal: AbortSignal
): Promise<ProcessedAttachment> {
  const visionAttachments: ImageAttachment[] = [];
  let totalAttachmentBytes = 0;

  for (const att of (attachments || []).slice(0, MAX_ATTACHMENTS)) {
    signal.throwIfAborted();
    const item = parseInlineAttachment(att);

    if (isChatImageMediaType(item.mediaType)) {
      const base64 = assertBase64UnderLimit(item.base64);
      const buffer = Buffer.from(base64, "base64");
      const sanitizedImage = await sanitizeProviderImage({
        buffer,
        declaredMediaType: item.mediaType,
        maxOutputBytes: MAX_FILE_SIZE,
        maxPixels: MAX_IMAGE_PIXELS,
      });
      signal.throwIfAborted();
      totalAttachmentBytes += sanitizedImage.byteLength;
      if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error("첨부파일 합계 크기 초과");
      visionAttachments.push({
        base64: sanitizedImage.buffer.toString("base64"),
        mediaType: sanitizedImage.mediaType,
        fileName: safeFileName(item.fileName, "attachment"),
      });
    } else if (item.mediaType === "application/pdf") {
      const base64 = assertBase64UnderLimit(item.base64);
      const buffer = Buffer.from(base64, "base64");
      assertSupportedPdfBuffer(buffer);
      signal.throwIfAborted();
      totalAttachmentBytes += buffer.byteLength;
      if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error("첨부파일 합계 크기 초과");
      visionAttachments.push({
        base64,
        mediaType: "application/pdf",
        fileName: safeFileName(item.fileName, "attachment.pdf"),
      });
    } else {
      throw new Error("지원하지 않는 첨부파일 형식입니다.");
    }
  }

  return { visionAttachments };
}

function chatRequestErrorResponse(error: unknown, signal?: AbortSignal): NextResponse {
  if (error instanceof ChatRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (signal?.aborted) {
    return NextResponse.json(
      { error: "요청 시간이 초과되었거나 연결이 취소되었습니다." },
      { status: 408 }
    );
  }
  return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
}

function createCrisisSafetySseResponse(): Response {
  return new Response(
    `data: ${JSON.stringify({
      type: "done",
      fullContent: KOREAN_CRISIS_SAFETY_RESPONSE,
      metadata: {
        safetyResponse: true,
        providerCalled: false,
      },
    })}\n\n`,
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    }
  );
}

function createRelationshipViolenceSafetySseResponse(): Response {
  return new Response(
    `data: ${JSON.stringify({
      type: "done",
      fullContent: KOREAN_RELATIONSHIP_VIOLENCE_SAFETY_RESPONSE,
      metadata: {
        safetyResponse: true,
        safetyKind: "relationship_violence",
        providerCalled: false,
      },
    })}\n\n`,
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    },
  );
}

export async function POST(request: Request) {
  const responseAbortController = new AbortController();
  const routeSignal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(CHAT_ROUTE_DEADLINE_MS),
    responseAbortController.signal,
  ]);

  // 인증/DB 조회 전에 명시된 대용량 요청을 거부한다. chunked 요청은 아래 스트림 리더가 다시 제한한다.
  try {
    assertChatContentLength(request.headers);
  } catch (error) {
    return chatRequestErrorResponse(error, routeSignal);
  }

  let body: Record<string, unknown>;
  try {
    body = await readBoundedJsonBody(request, { signal: routeSignal });
  } catch (error) {
    return chatRequestErrorResponse(error, routeSignal);
  }

  // 레거시 images 입력은 동의 계약을 우회할 수 있어 빈 배열이어도 받지 않는다.
  if (Object.prototype.hasOwnProperty.call(body, "images")) {
    return NextResponse.json(
      {
        error: "구버전 이미지 입력은 지원하지 않습니다. 최신 첨부 전송 방식으로 다시 시도해 주세요.",
        code: "legacy_chat_images_rejected",
      },
      { status: 400 }
    );
  }

  const requestAttachments = body.attachments ?? [];
  if (!Array.isArray(requestAttachments)) {
    return NextResponse.json({ error: "첨부파일 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (requestAttachments.length > MAX_ATTACHMENTS) {
    return NextResponse.json(
      { error: `첨부파일은 최대 ${MAX_ATTACHMENTS}개까지 보낼 수 있습니다.` },
      { status: 413 }
    );
  }
  if (
    requestAttachments.length > 0 &&
    body.attachmentProviderConsentVersion !== attachmentProviderConsentVersion
  ) {
    return NextResponse.json(
      {
        error: "첨부파일을 OpenAI로 전송하기 전에 현재 개인정보 안내를 확인해 주세요.",
        code: "attachment_provider_consent_required",
        requiredVersion: attachmentProviderConsentVersion,
      },
      { status: 428 }
    );
  }

  // 첨부 동의 경계를 통과한 뒤에만 인증 또는 DB 접근을 시작한다.
  const supabase = await createClientFromRequest(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  let clientContext: ReturnType<typeof parseClientChatContext>;
  try {
    clientContext = parseClientChatContext(body);
  } catch (error) {
    return chatRequestErrorResponse(error, routeSignal);
  }

  const {
    coupleId,
    currentUserMessageId: rawCurrentUserMessageId,
    isDemo: bodyIsDemo,
    clientRequestId: bodyClientRequestId,
    visibility: bodyVisibility,
  } = body;
  const rawClientCapabilities = body.clientCapabilities;
  const supportsToolCards = !(
    rawClientCapabilities &&
    typeof rawClientCapabilities === "object" &&
    "toolCards" in rawClientCapabilities &&
    rawClientCapabilities.toolCards === false
  );
  const isDemo =
    bodyIsDemo === true &&
    hasSignedDemoSessionFromCookieHeader(request.headers.get("cookie"));
  // 예시 앱의 채팅은 정적 샘플만 보여준다. UI뿐 아니라 서버에서도 차단해
  // 공개 데모 세션이 OpenAI 비용이나 복구 불가능한 완료 claim을 만들지 못하게 한다.
  if (isDemo) {
    return NextResponse.json(
      {
        error: "예시 앱에서는 저장·전송 없는 샘플 상담만 볼 수 있습니다.",
        code: "demo_chat_disabled",
      },
      { status: 403 }
    );
  }
  const normalizedClientRequestId =
    typeof bodyClientRequestId === "string" ? bodyClientRequestId.trim() : "";
  const clientRequestId: string | null = /^[A-Za-z0-9._:-]{1,120}$/.test(normalizedClientRequestId)
    ? normalizedClientRequestId
    : null;
  if (!clientRequestId) {
    return NextResponse.json(
      { error: "안전한 중복 실행 방지를 위한 요청 ID가 필요합니다." },
      { status: 400 }
    );
  }
  if (
    bodyVisibility !== undefined &&
    bodyVisibility !== "shared" &&
    bodyVisibility !== "bride_private" &&
    bodyVisibility !== "groom_private"
  ) {
    return NextResponse.json({ error: "채팅 공개 범위 값이 올바르지 않습니다." }, { status: 400 });
  }
  const requestedVisibility: "shared" | "bride_private" | "groom_private" =
    bodyVisibility === "bride_private" || bodyVisibility === "groom_private"
      ? bodyVisibility
      : "shared";
  let visibility: "shared" | "bride_private" | "groom_private" = requestedVisibility;

  if (!isUuid(coupleId) || !isUuid(rawCurrentUserMessageId)) {
    return NextResponse.json(
      { error: "저장된 현재 메시지와 커플 ID가 필요합니다." },
      { status: 400 }
    );
  }
  const currentUserMessageId = rawCurrentUserMessageId;

  // coupleId 소유 검증: 해당 커플에 속하는 사용자인지 확인
  const serviceClient = getServiceClient();
  const { data: userProfile, error: userProfileError } = await serviceClient
    .from("profiles")
    .select("name, couple_id, role, is_admin, shared_chat_cleared_at, private_chat_cleared_at, private_chat_deleting_at, account_deleting_at, amora_membership_resetting_at, amora_membership_generation")
    .eq("id", user.id)
    .single();

  if (userProfileError) {
    console.error("채팅 사용자 프로필 조회 실패:", safeChatErrorCode(userProfileError));
    return NextResponse.json({ error: "사용자 상태를 안전하게 확인하지 못했습니다." }, { status: 503 });
  }
  if (userProfile?.couple_id !== coupleId) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }
  if (userProfile.account_deleting_at) {
    return NextResponse.json({ error: "계정 삭제가 진행 중이라 새 상담을 시작할 수 없습니다." }, { status: 409 });
  }
  if (userProfile.amora_membership_resetting_at) {
    return NextResponse.json({ error: "커플 연결 초기화가 진행 중이라 새 상담을 시작할 수 없습니다." }, { status: 409 });
  }
  const currentUserRole = userProfile.role;
  if (currentUserRole !== "bride" && currentUserRole !== "groom") {
    return NextResponse.json({ error: "역할이 설정되지 않았습니다." }, { status: 409 });
  }
  if (requestedVisibility !== "shared" && userProfile.private_chat_deleting_at) {
    return NextResponse.json({ error: "비공개 상담 삭제가 진행 중입니다. 잠시 후 다시 시도해 주세요." }, { status: 409 });
  }

  if (requestedVisibility !== "shared") {
    const allowedPrivateVisibility = currentUserRole === "groom" ? "groom_private" : "bride_private";
    if (requestedVisibility !== allowedPrivateVisibility) {
      return NextResponse.json({ error: "비공개 채팅 권한이 없습니다." }, { status: 403 });
    }
    visibility = allowedPrivateVisibility;
  }

  const safetyIdentifier = createSafetyIdentifier(user.id);

  // 전체 요청을 provider/tool 실행 전에 원자 선점한다. payload는 저장하지 않고
  // 서버 전용 HMAC으로 보호된 해시만 남긴다.
  const expectedSharedClearedAt = userProfile.shared_chat_cleared_at ?? null;
  const expectedPrivateClearedAt = userProfile.private_chat_cleared_at ?? null;
  const expectedMembershipGeneration = Number(userProfile.amora_membership_generation);
  if (!Number.isSafeInteger(expectedMembershipGeneration) || expectedMembershipGeneration < 0) {
    return NextResponse.json({ error: "사용자 상태 세대를 확인하지 못했습니다." }, { status: 503 });
  }
  const { data: initialCouple, error: initialCoupleError } = await serviceClient
    .from("couples")
    .select("bride_id, groom_id, amora_shared_resetting_at, amora_context_generation")
    .eq("id", coupleId)
    .maybeSingle();
  const ownsInitialSlot = currentUserRole === "bride"
    ? initialCouple?.bride_id === user.id
    : initialCouple?.groom_id === user.id;
  const expectedCoupleContextGeneration = Number(initialCouple?.amora_context_generation);
  if (initialCoupleError || !ownsInitialSlot || initialCouple?.amora_shared_resetting_at) {
    return NextResponse.json({ error: "현재 커플 연결 상태로 상담을 시작할 수 없습니다." }, { status: 409 });
  }
  if (!Number.isSafeInteger(expectedCoupleContextGeneration)
    || expectedCoupleContextGeneration < 0) {
    return NextResponse.json({ error: "커플 상태 세대를 확인하지 못했습니다." }, { status: 503 });
  }
  const assertRequestStillAuthorized = async (): Promise<void> => {
    routeSignal.throwIfAborted();
    const { data: currentProfile, error: currentProfileError } = await serviceClient
      .from("profiles")
      .select("couple_id, role, shared_chat_cleared_at, private_chat_cleared_at, private_chat_deleting_at, account_deleting_at, amora_membership_resetting_at, amora_membership_generation")
      .eq("id", user.id)
      .maybeSingle();

    if (currentProfileError) {
      throw new Error(`chat authorization recheck failed: ${currentProfileError.message}`);
    }
    if (
      !currentProfile ||
      currentProfile.couple_id !== coupleId ||
      currentProfile.account_deleting_at ||
      currentProfile.amora_membership_resetting_at
    ) {
      throw new Error("chat authorization changed while the request was running");
    }
    if (Number(currentProfile.amora_membership_generation) !== expectedMembershipGeneration) {
      throw new Error("chat membership changed while the request was running");
    }
    if ((currentProfile.shared_chat_cleared_at ?? null) !== expectedSharedClearedAt) {
      throw new Error("shared chat was cleared while the request was running");
    }

    const { data: currentCouple, error: currentCoupleError } = await serviceClient
      .from("couples")
      .select("bride_id, groom_id, amora_shared_resetting_at, amora_context_generation")
      .eq("id", coupleId)
      .maybeSingle();
    if (currentCoupleError) {
      throw new Error(`chat couple authorization recheck failed: ${currentCoupleError.message}`);
    }
    const ownsCurrentSlot = currentProfile.role === "bride"
      ? currentCouple?.bride_id === user.id
      : currentProfile.role === "groom"
        ? currentCouple?.groom_id === user.id
        : false;
    if (!ownsCurrentSlot || currentCouple?.amora_shared_resetting_at
      || Number(currentCouple?.amora_context_generation) !== expectedCoupleContextGeneration) {
      throw new Error("chat couple slot changed while the request was running");
    }

    const expectedVisibility = currentProfile.role === "bride"
      ? "bride_private"
      : currentProfile.role === "groom"
        ? "groom_private"
        : null;
    if (visibility !== "shared" && visibility !== expectedVisibility) {
      throw new Error("private chat authorization changed while the request was running");
    }
    if (
      visibility !== "shared" &&
      currentProfile.private_chat_deleting_at
    ) {
      throw new Error("private chat deletion started while the request was running");
    }
    if (
      visibility !== "shared" &&
      (currentProfile.private_chat_cleared_at ?? null) !== expectedPrivateClearedAt
    ) {
      throw new Error("private chat was cleared while the request was running");
    }
    routeSignal.throwIfAborted();
  };
  const canonicalRowSelect = "id, couple_id, sender_id, sender_type, sender_role, role, content, metadata, visibility, created_at";
  const { data: currentMessageRow, error: currentMessageError } = await serviceClient
    .from("chat_messages")
    .select(canonicalRowSelect)
    .eq("couple_id", coupleId)
    .eq("id", currentUserMessageId)
    .maybeSingle();
  if (currentMessageError || !currentMessageRow || typeof currentMessageRow.created_at !== "string"
    || !Number.isFinite(Date.parse(currentMessageRow.created_at))) {
    console.error("채팅 현재 메시지 정본 조회 실패:", safeChatErrorCode(currentMessageError));
    return NextResponse.json({ error: "저장된 현재 질문을 안전하게 확인하지 못했습니다." }, { status: 409 });
  }

  const allowedVisibilities = visibility === "shared"
    ? ["shared"]
    : ["shared", visibility];
  const { data: canonicalHistoryRows, error: canonicalHistoryError } = await serviceClient
    .from("chat_messages")
    .select(canonicalRowSelect)
    .eq("couple_id", coupleId)
    .in("visibility", allowedVisibilities)
    .lte("created_at", currentMessageRow.created_at)
    .order("created_at", { ascending: false })
    .limit(100);
  if (canonicalHistoryError) {
    console.error("채팅 정본 기록 조회 실패:", safeChatErrorCode(canonicalHistoryError));
    return NextResponse.json({ error: "대화 기록을 안전하게 확인하지 못했습니다." }, { status: 503 });
  }

  let canonicalTranscript: ReturnType<typeof buildCanonicalChatTranscript>;
  try {
    canonicalTranscript = buildCanonicalChatTranscript({
      rows: [currentMessageRow, ...(canonicalHistoryRows ?? [])] as CanonicalChatRow[],
      coupleId,
      currentUserId: user.id,
      currentUserRole,
      brideId: initialCouple?.bride_id ?? null,
      groomId: initialCouple?.groom_id ?? null,
      visibility,
      currentUserMessageId,
      sharedClearedAt: expectedSharedClearedAt,
      privateClearedAt: expectedPrivateClearedAt,
      maxMessages: MAX_CONTEXT_MESSAGES,
      maxSingleMessageChars: MAX_SINGLE_MESSAGE_CHARS,
      maxTotalMessageChars: MAX_TOTAL_MESSAGE_CHARS,
    });
  } catch (error) {
    const tooLarge = error instanceof CanonicalChatTranscriptError
      && error.code === "current_message_too_large";
    return NextResponse.json(
      { error: tooLarge ? "현재 질문이 너무 깁니다." : "저장된 현재 질문의 소유권과 공개 범위를 확인하지 못했습니다." },
      { status: tooLarge ? 413 : 409 }
    );
  }
  const messages = canonicalTranscript.messages;

  // 위기 안전 응답도 브라우저가 주장한 텍스트가 아니라 서버 정본의 현재 질문만 본다.
  if (hasImmediateKoreanCrisisSignal(canonicalTranscript.currentUserText)) {
    return createCrisisSafetySseResponse();
  }
  if (
    hasImmediateKoreanRelationshipViolenceSignal(canonicalTranscript.currentUserText)
  ) {
    return createRelationshipViolenceSafetySseResponse();
  }

  const limited = await checkRateLimitPersistent(rateLimitKey("chat", request, user.id), {
    maxRequests: 60,
    windowMs: 60 * 60 * 1000,
  }, user.id);
  if (limited) return limited;

  // 정본 질문이 확인된 뒤에만 비용이 큰 첨부 파싱을 수행한다.
  let processedAttachments: ProcessedAttachment;
  try {
    processedAttachments = await processAttachments(requestAttachments, routeSignal);
  } catch (err) {
    if (err instanceof ChatRequestError || routeSignal.aborted) {
      return chatRequestErrorResponse(err, routeSignal);
    }
    const message = err instanceof Error ? err.message : "첨부파일 처리 실패";
    const tooLarge = message.includes("크기 초과")
      || message.includes("용량을 초과")
      || message.includes("해상도")
      || message.includes("페이지");
    const safeMessage = tooLarge
      ? message
      : message.includes("애니메이션 GIF") || message.includes("지원하지 않는")
        ? message
        : "첨부파일을 안전하게 읽지 못했습니다. 파일을 확인해 다시 올려주세요.";
    return NextResponse.json({ error: safeMessage }, { status: tooLarge ? 413 : 400 });
  }
  const { visionAttachments } = processedAttachments;

  let requestKey: string;
  let requestHash: string;
  try {
    ({ requestKey, requestHash } = createChatRequestIdentity({
      userId: user.id,
      coupleId,
      clientRequestId,
      payload: {
        currentUserMessageId,
        attachments: requestAttachments,
        ...(requestAttachments.length > 0 ? { attachmentProviderConsentVersion } : {}),
        visibility,
      },
    }));
  } catch (error) {
    console.error("채팅 요청 HMAC 설정 오류:", safeChatErrorCode(error));
    return NextResponse.json({ error: "채팅 안전 설정을 확인하지 못했습니다." }, { status: 503 });
  }
  try {
    await assertRequestStillAuthorized();
  } catch (error) {
    console.error("채팅 초기 회원 상태 검증 실패:", safeChatErrorCode(error));
    return NextResponse.json({ error: "현재 커플 연결 상태로 상담을 시작할 수 없습니다." }, { status: 409 });
  }
  // 병렬로 커플 관련 데이터 전체 조회
  const [journeyResult, profilesResult, summariesResult, decisionsResult, conflictsResult, feedbackLessons, amoraProfiles] = await Promise.all([
    // 1. 웨딩 저니
    supabase.from("wedding_journeys").select("*").eq("couple_id", coupleId).single(),
    // 2. 커플 프로필 (신부/신랑 이름, 역할)
    serviceClient.from("profiles").select("name, role").eq("couple_id", coupleId),
    // 3. 기존 대화 요약에는 상대방 전용 메시지를 배제했다는 provenance가 없다.
    // 검증 가능한 context policy 컬럼이 생기기 전까지 읽거나 프롬프트에 넣지 않는다.
    Promise.resolve({ data: [], error: null }),
    // 4. 상대방 전용 메시지 배제를 서버가 증명한 의사결정만 읽는다.
    // visibility 격리만으로는 파생 transcript의 audience를 증명할 수 없다.
    supabase.from("decision_nodes")
      .select("category, decision_type, title, chosen_value, reasoning, confidence, stage_tag, source, visibility, metadata, created_at")
      .eq("couple_id", coupleId)
      .contains("metadata", VERIFIED_PARTNER_EXCLUDED_PROVENANCE)
      .order("created_at", { ascending: false })
      .limit(50),
    // 5. 갈등→합의 기록도 같은 provenance가 있을 때만 읽는다.
    supabase.from("decision_nodes")
      .select("title, chosen_value, reasoning, stage_tag, visibility, metadata, created_at")
      .eq("couple_id", coupleId)
      .eq("category", "conflict_resolution")
      .contains("metadata", VERIFIED_PARTNER_EXCLUDED_PROVENANCE)
      .order("created_at", { ascending: false })
      .limit(5),
    // 6. 피드백 학습 내용 (AI 품질 개선용)
    loadFeedbackLessons(coupleId),
    // 기존 장기 프로필도 어떤 transcript에서 파생됐는지 증명할 수 없다.
    // 안전한 provenance가 도입되기 전까지 개인화보다 비공개 대화 보호를 우선한다.
    Promise.resolve({ shared: null, private: null }),
  ]);

  if (routeSignal.aborted) {
    return chatRequestErrorResponse(routeSignal.reason, routeSignal);
  }

  const journey = journeyResult.data;
  if (journeyResult.error) {
    console.error("Journey 조회 에러:", safeChatErrorCode(journeyResult.error));
  }

  // 실서비스에서는 시스템 프롬프트·도구 컨텍스트를 DB 정본으로만 구성한다.
  // 클라이언트 weddingContext/senderName/senderRole은 서명된 데모에서만 사용한다.
  const resolvedChatContext = resolveChatContext({
    isDemo,
    client: clientContext,
    profile: userProfile,
    journey,
  });
  const senderName = resolvedChatContext.senderName;
  const trustedWeddingContext = resolvedChatContext.weddingContext;

  // 프로필에서 신부/신랑 이름 추출
  const profiles = profilesResult.data ?? [];
  const brideName = sanitizeTrustedDisplayName(
    profiles.find((p) => p.role === "bride")?.name
  );
  const groomName = sanitizeTrustedDisplayName(
    profiles.find((p) => p.role === "groom")?.name
  );

  // progress에서 일정 이벤트 추출
  const progress = trustedWeddingContext.progress;
  const scheduleEvents = ((progress as Record<string, unknown>).__events as Array<{
    date: string;
    title: string;
    memo?: string;
    categoryKey?: string;
  }>) ?? [];

  // progress에서 사용자 선호도 추출
  const rawPreferences = (progress as Record<string, unknown>).__preferences as {
    weddingStyle?: string | null;
    priorities?: string[];
    budgetAttitude?: string | null;
    budgetTendency?: string | null;
    guestCount?: string | null;
  } | undefined;

  // budgetTendency → budgetAttitude 호환 (웹 온보딩은 budgetTendency, 프롬프트는 budgetAttitude)
  const preferences = rawPreferences ? {
    weddingStyle: rawPreferences.weddingStyle ?? null,
    priorities: rawPreferences.priorities ?? [],
    budgetAttitude: rawPreferences.budgetAttitude ?? rawPreferences.budgetTendency ?? null,
    guestCount: rawPreferences.guestCount ?? null,
  } : null;

  // 기존 요약은 provenance를 증명할 수 없어 현재 항상 빈 배열이다.
  const summariesData = (summariesResult.data ?? []) as Array<{
    summary: string;
    created_at: string;
    message_count: number | null;
    to_message_id: string | null;
  }>;
  const chatSummaries = summariesData.map((s) => s.summary);

  // 향후 안전한 요약 schema가 생겼을 때 사용할 watermark. 현재는 항상 비어 있다.
  const lastSummary = summariesData[0] ?? null;
  const lastCoveredCount = lastSummary?.message_count ?? 0;
  const lastToMessageId = lastSummary?.to_message_id ?? null;

  // 서버가 partner exclusion provenance를 확인한 기록에 visibility 격리를 추가 적용한다.
  const rawDecisions = (decisionsResult.data ?? []) as Array<{
    category: string;
    decision_type: string;
    title: string;
    chosen_value: { value?: string } | null;
    reasoning: string | null;
    confidence: number | null;
    stage_tag: string | null;
    source: string;
    visibility: "shared" | "bride_private" | "groom_private";
    created_at: string;
  }>;
  const decisionsData =
    visibility === "shared"
      ? rawDecisions.filter((d) => d.visibility === "shared")
      : rawDecisions.filter((d) => d.visibility === "shared" || d.visibility === visibility);
  const pastDecisions = decisionsData.map((d) => ({
    category: d.category,
    decisionType: d.decision_type,
    title: d.title,
    value: d.chosen_value?.value ?? null,
    reasoning: d.reasoning,
    confidence: d.confidence ?? 0.5,
    source: d.source,
    createdAt: d.created_at,
  }));

  // Mediation 강화: 갈등→합의 히스토리 정리 — 같은 visibility 격리 적용
  const rawConflicts = (conflictsResult.data ?? []) as Array<{
    title: string;
    chosen_value: { value?: string } | null;
    reasoning: string | null;
    stage_tag: string | null;
    visibility: "shared" | "bride_private" | "groom_private";
    created_at: string;
  }>;
  const conflictsData =
    visibility === "shared"
      ? rawConflicts.filter((c) => c.visibility === "shared")
      : rawConflicts.filter((c) => c.visibility === "shared" || c.visibility === visibility);
  const pastConflicts = conflictsData.map((c) => ({
    title: c.title,
    resolution: c.chosen_value?.value ?? null,
    reasoning: c.reasoning,
    stageTag: c.stage_tag,
    createdAt: c.created_at,
  }));

  // --- Part 2 & 3: 불만족 자동 감지 + 세션 수준 실수 추적 ---
  // 현재 사용자 메시지 (마지막 user 메시지)
  const typedMessages = messages;
  const recentUserMessages = typedMessages.filter((message) => message.role === "user");
  const lastUserText = canonicalTranscript.currentUserText;
  const previousUserText = recentUserMessages.at(-2)?.content ?? "";

  // 오래된 불만은 누적하지 않고, 최근에 연속된 교정·불만만 승격 근거로 쓴다.
  const correctionCount = countRecentConsecutiveDissatisfaction(typedMessages);

  // Part 3: 세션 내 2회 이상 수정 시 신중 모드 프리픽스
  const cautionPrefix = correctionCount >= 2
    ? "[CONTEXT: 최근 답변에 교정이나 불만이 2번 이상 연속되었습니다. 더 신중하게, 확인하며 답변하세요.]\n\n"
    : "";

  // D3: stage + specialist 계산
  const weddingDateForStage = trustedWeddingContext.weddingDate;
  const stageTag = determineStage(weddingDateForStage);
  const specialistType = routeSpecialist(lastUserText, stageTag);
  const chatModelRole = chooseAmoraChatModelRole({
    specialistType,
    userText: lastUserText,
    correctionCount,
  });
  const specialistAddon = getSpecialistPromptAddon(specialistType);

  // Private 모드 안내 (신부/신랑이 단독으로 아모라에게 털어놓는 채팅)
  const privacyPrefix = visibility === "bride_private" || visibility === "groom_private"
    ? `[PRIVATE_MODE] 이 메시지는 ${visibility === "bride_private" ? "신부" : "신랑"} 분이 **상대방 모르게** 아모라에게만 털어놓는 비공개 대화입니다.\n` +
      `- 상대방을 비난하거나 편드는 발언 금지. 객관적·공감적으로.\n` +
      `- 이 대화 내용은 절대 상대방의 채팅(shared/상대방의 private)에서 언급·인용하지 마세요. 시스템이 격리하지만 아모라도 의식적으로 분리.\n` +
      `- 그러나 이 대화에서 드러난 인사이트는 본인의 향후 private 대화에서는 자연스럽게 이어가도 됩니다.\n` +
      `- 답변은 평소처럼 따뜻하고 실용적으로. 비공개라고 톤을 어둡게 하지 마세요.\n\n`
    : "";

  const amoraPromptContext = {
    weddingDate: weddingDateForStage,
    budget: trustedWeddingContext.budget,
    venue: trustedWeddingContext.venue,
    progress,
    brideName,
    groomName,
    senderName,
    scheduleEvents,
    chatSummaries,
    preferences: preferences ?? undefined,
    amoraProfiles,
    feedbackLessons,
    pastDecisions,
    pastConflicts,
  };
  let systemPrompt = cautionPrefix + privacyPrefix
    + getWeddingPlannerSystemPrompt(amoraPromptContext)
    + specialistAddon;
  const untrustedContextInput = getWeddingPlannerUntrustedContext(amoraPromptContext);

  // 메시지 포맷팅
  const formattedMessages: ChatMessageInput[] = [
    { role: "user", content: untrustedContextInput },
    ...messages.map(
    (m: { role: string; content: string }, index: number) => {
      const role = m.role === "assistant" ? ("assistant" as const) : ("user" as const);
      const isLastUserMessage = role === "user" && index === messages.length - 1;

      if (isLastUserMessage) {
        // 이미지/PDF 첨부가 있으면 멀티모달로
        if (visionAttachments.length > 0) {
          return {
            role,
            content: buildMultimodalContent(m.content, visionAttachments),
          };
        }

        return { role, content: m.content };
      }

      return { role, content: m.content };
    }
    ),
  ];

  const executionContext: ToolExecutionContext = {
    coupleId,
    currentUserId: user.id,
    signal: routeSignal,
    // 조회 도구에는 인증된 서버 컨텍스트만 전달한다.
    weddingContext: {
      weddingDate: trustedWeddingContext.weddingDate,
      budget: trustedWeddingContext.budget,
      venue: trustedWeddingContext.venue,
      progress: trustedWeddingContext.progress as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
  let toolsForTurn = selectAmoraToolsForTurn(WEDDING_TOOLS, {
    userText: lastUserText,
    previousUserText,
    hasDocumentAttachments: visionAttachments.some(
      (attachment) => attachment.mediaType === "application/pdf"
    ),
    hasImageAttachments: visionAttachments.some(
      (attachment) => attachment.mediaType !== "application/pdf"
    ),
  });

  if (!hasOpenAIConfig(chatModelRole)) {
    return NextResponse.json(
      { error: "AI 설정을 확인하지 못해 아모라를 잠시 사용할 수 없습니다." },
      { status: 503 }
    );
  }

  if (routeSignal.aborted) {
    return chatRequestErrorResponse(routeSignal.reason, routeSignal);
  }

  try {
    await assertRequestStillAuthorized();
    const requestClaim = await claimChatExecution(serviceClient, {
      requestKey,
      requestHash,
      visibility,
    });
    if (requestClaim.action === "replay") {
      const replay = await replayCompletedChatMessage(
        serviceClient,
        coupleId,
        requestClaim.messageId
      );
      if (replay) return replay;
      return NextResponse.json(
        { error: "완료된 요청의 응답이 이미 삭제되어 다시 표시할 수 없습니다." },
        { status: 409 }
      );
    }
  } catch (error) {
    if (error instanceof ChatExecutionClaimError) {
      const status = error.code === "claim_unavailable" ? 503 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ error: "요청 상태를 안전하게 확인하지 못했습니다." }, { status: 503 });
  }

  // Exact token count도 원문을 보내는 OpenAI provider 요청이다. 각 count와
  // generation 쌍을 하나의 원자 slot으로 기록하고 count 직전 started로 표시한다.
  // 테스트 단계에는 횟수 차단이 없지만 재시도·실패·불명확한 provider 시도 장부는 유지한다.
  const reservationParams = {
    coupleId,
    isAdmin: userProfile?.is_admin === true,
  };
  const preflight = await checkAmoraCostGuard(serviceClient, reservationParams);
  if (!preflight.allowed) {
    try {
      await reconcileChatRequestFinalState(serviceClient, {
        requestKey,
        requestHash,
        reason: "preflight_denied",
      });
    } catch (error) {
      console.error("아모라 사전 한도 차단 상태 기록 실패:", safeChatErrorCode(error));
      await markChatExecutionFailed(serviceClient, requestKey, requestHash);
    }
    return NextResponse.json(
      {
        error: preflight.message ?? "아모라 이용 한도를 확인하지 못했습니다.",
        code: preflight.reason ?? "guard_unavailable",
      },
      { status: preflight.reason === "guard_unavailable" ? 503 : 429 }
    );
  }

  // 향후 사용량 제한을 다시 켠 경우 한 자리만 남았으면 첫 호출부터 도구 없이
  // 답하게 해, 도구 결과 뒤의 필수 설명 호출이 막히는 경계를 없앤다.
  if (typeof preflight.providerRemaining === "number" && preflight.providerRemaining <= 1) {
    toolsForTurn = [];
  }
  systemPrompt += getRuntimeToolContract(toolsForTurn, { toolCards: supportsToolCards });

  let nextProviderOrdinal = 0;
  let pendingProviderStartOrdinal: 0 | 1 | null = null;
  const currentReservationIdentity = () => {
    if (nextProviderOrdinal !== 0 && nextProviderOrdinal !== 1) {
      throw new Error("아모라 provider 호출 순번이 안전 상한을 초과했습니다.");
    }
    return {
      requestKey,
      requestHash,
      providerOrdinal: nextProviderOrdinal as 0 | 1,
    };
  };

  // 숨은 Luna 후처리도 각각 계량한다. 현재는 횟수로 차단하지 않지만 메인 채팅과
  // 보조 호출의 실제 provider 시도를 같은 운영 지표로 관찰한다.
  const reserveAuxiliaryLLMCall = async (): Promise<boolean> => {
    if (routeSignal.aborted) return false;
    await assertRequestStillAuthorized();
    const reservation = await reserveAmoraProviderCall(serviceClient, reservationParams);
    return reservation.allowed && !routeSignal.aborted;
  };
  const reserveProviderCallOrThrow = async (): Promise<CostGuardResult> => {
    routeSignal.throwIfAborted();
    await assertRequestStillAuthorized();
    const reservation = await reserveAmoraProviderCall(serviceClient, {
      ...reservationParams,
      reservation: currentReservationIdentity(),
    });
    if (!reservation.allowed) {
      throw new AmoraCostGuardError(reservation);
    }
    pendingProviderStartOrdinal = nextProviderOrdinal as 0 | 1;
    nextProviderOrdinal += 1;
    routeSignal.throwIfAborted();
    return reservation;
  };
  const markReservedProviderStarted = async (): Promise<void> => {
    if (pendingProviderStartOrdinal === null) {
      throw new Error("아모라 provider 시작 대상 예약이 없습니다.");
    }
    const ordinal = pendingProviderStartOrdinal;
    await markAmoraProviderStarted(serviceClient, {
      requestKey,
      requestHash,
      providerOrdinal: ordinal,
    });
    pendingProviderStartOrdinal = null;
  };

  // SSE 스트림 응답 생성
  const encoder = new TextEncoder();

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

      // D1: 로깅 집계 버퍼 (한 turn = 1 row)
      const turnStartedAt = startLatencyClock();
      let totalTokensIn = 0;
      let totalTokensOut = 0;
      // OpenAI cache write/read 토큰을 별도 집계해 비용을 정확히 계산한다.
      let totalCacheWriteTokens = 0;
      let totalCacheReadTokens = 0;
      let lastGeneratedCleanText = "";
      let lastModel: string | undefined;
      const requestUsage: Array<{
        model: string;
        input_tokens: number;
        output_tokens: number;
        cache_write_input_tokens: number;
        cache_read_input_tokens: number;
      }> = [];

      const recordRequestUsage = (
        model: string | undefined,
        usage: NormalizedOpenAIUsage | undefined
      ) => {
        if (!usage) return;
        totalTokensIn += usage.input_tokens;
        totalTokensOut += usage.output_tokens;
        totalCacheWriteTokens += usage.cache_write_input_tokens ?? 0;
        totalCacheReadTokens += usage.cache_read_input_tokens ?? 0;
        if (model) {
          requestUsage.push({
            model,
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cache_write_input_tokens: usage.cache_write_input_tokens ?? 0,
            cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
          });
        }
      };
      const closeStream = () => {
        try {
          controller.close();
        } catch {
          // 응답 소비자가 이미 연결을 닫은 경우
        }
      };
      const getTurnCostUsd = (): number | null => {
        if (requestUsage.length === 0) return null;
        let total = 0;
        for (const usage of requestUsage) {
          const cost = calcCostUsd(
            usage.model,
            usage.input_tokens,
            usage.output_tokens,
            usage.cache_write_input_tokens,
            usage.cache_read_input_tokens
          );
          if (cost == null) return null;
          total += cost;
        }
        return total;
      };

      const toolResults: ToolExecutionResult[] = [];
      const toolsUsed: string[] = [];
      let providerLeaseId: string | null = null;
      try {
        const { data: leaseId, error: leaseError } = await serviceClient.rpc(
          "acquire_amora_provider_lease",
          {
            p_user_id: user.id,
            p_couple_id: coupleId,
            p_expected_membership_generation: expectedMembershipGeneration,
            p_expected_couple_context_generation: expectedCoupleContextGeneration,
            p_visibility: visibility,
            p_expected_private_cleared_at: expectedPrivateClearedAt,
          }
        );
        if (leaseError || typeof leaseId !== "string") {
          throw new Error(`provider lease acquisition failed: ${leaseError?.message ?? "invalid result"}`);
        }
        providerLeaseId = leaseId;

        let currentInput: ChatResponseInput = [...formattedMessages];
        const currentTools = toolsForTurn;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          routeSignal.throwIfAborted();
          // 실시간 스트리밍: 모든 라운드에서 텍스트 토큰을 즉시 클라이언트로 전송
          // tool_use가 발견되면 text_clear로 리셋 후 도구 실행
          let providerBoundaryOverride:
            | { tools: typeof currentTools; systemPromptSuffix: string }
            | undefined;
          const result = await chatWithToolsStream({
            systemPrompt,
            input: currentInput,
            tools: currentTools,
            maxOutputTokens: MAX_CHAT_OUTPUT_TOKENS,
            maxInputTokens: MAX_CHAT_INPUT_TOKENS,
            // Exact counting is itself an OpenAI request. Persist its slot and
            // mark it started at the immediate provider boundary. Test-stage
            // metering does not reject the request by a daily count.
            beforeInputCount: async () => {
              await assertRequestStillAuthorized();
              if (round === 0) {
                routeSignal.throwIfAborted();
                const reservation = await reserveAmoraUserTurn(serviceClient, {
                  ...reservationParams,
                  reservation: currentReservationIdentity(),
                });
                if (!reservation.allowed) throw new AmoraCostGuardError(reservation);
                pendingProviderStartOrdinal = nextProviderOrdinal as 0 | 1;
                nextProviderOrdinal += 1;
                if (reservation.providerRemaining === 0 && currentTools.length > 0) {
                  providerBoundaryOverride = {
                    tools: [],
                    systemPromptSuffix:
                      "\n[PROVIDER_BOUNDARY] 이번 턴은 비용 안전 한도상 단일 응답만 가능합니다. 도구를 호출하지 말고 확인된 현재 문맥만으로 솔직하게 답하세요.",
                  };
                }
              } else {
                await reserveProviderCallOrThrow();
              }
            },
            beforeInputCountRequest: markReservedProviderStarted,
            beforeCreate: async () => {
              await assertRequestStillAuthorized();
              return providerBoundaryOverride;
            },
            beforeProviderRequest: assertRequestStillAuthorized,
            safetyIdentifier,
            modelRole: chatModelRole,
            signal: routeSignal,
            onTextDelta: (token) => {
              send({ type: "text_delta", content: token });
            },
          });

          // 라운드별 토큰/모델 집계
          recordRequestUsage(result.model, result.usage);
          if (result.model) lastModel = result.model;
          routeSignal.throwIfAborted();

          // tool use가 없으면 최종 응답 (이미 토큰별로 스트리밍됨)
            if (result.toolCalls.length === 0) {
            const { cleanText: afterSuggest, suggestions } = extractSuggestions(
              result.fullText
            );
            // 갈등 중재 마커 추출 — 본문에서 [mediation]...[/mediation] 제거 + 4필드 metadata로
            const { cleanText, mediation } = extractMediation(afterSuggest);
            lastGeneratedCleanText = cleanText;

            if (suggestions.length > 0) {
              send({ type: "suggestions", suggestions });
            }

            // 서버 사이드 INSERT (with 10s idempotency)
            // 모바일 retry / 중복 fetch 시 동일 내용을 또 INSERT하지 않음.
            await assertRequestStillAuthorized();
            const insertResult = await completeAiMessage({
              userId: user.id,
              coupleId,
              cleanText,
              clientRequestId,
              requestKey,
              requestHash,
              expectedPrivateClearedAt,
              expectedMembershipGeneration,
              expectedCoupleContextGeneration,
              metadata: { toolResults, toolsUsed, ...(mediation ? { mediation } : {}) },
              stageTag,
              specialistType,
              visibility,
              audit: {
                // 비용/운영 장부에는 원문을 복제하지 않는다. 사용자에게 보이는
                // canonical 메시지만 chat_messages에 저장한다.
                userInput: null,
                aiOutput: null,
                latencyMs: elapsedMs(turnStartedAt),
                model: lastModel ?? null,
                tokensInput: totalTokensIn || null,
                tokensOutput: totalTokensOut || null,
                costUsd: getTurnCostUsd(),
                metadata: {
                  stage_tag: stageTag,
                  tools_used: toolsUsed,
                  tool_rounds: round + 1,
                  correction_count: correctionCount,
                  visibility,
                  client_request_id: clientRequestId,
                  request_usage: requestUsage,
                  usage_limit_mode: AMORA_USAGE_LIMIT_MODE,
                  quota_class: reservationParams.isAdmin ? "admin_turn" : "user_turn",
                  request_key: requestKey,
                  provider_reservation_count: nextProviderOrdinal,
                  cache_write_input_tokens: totalCacheWriteTokens,
                  cache_read_input_tokens: totalCacheReadTokens,
                },
              },
            });
            const completionState = await reconcileChatRequestFinalState(serviceClient, {
              requestKey,
              requestHash,
              reason: "completed",
            });
            if (completionState.finalStatus !== "completed") {
              throw new Error("완료된 아모라 요청의 비용 장부를 확정하지 못했습니다.");
            }
            const serverMessageId: string | null = insertResult.id;
            const serverCreatedAt: string | null = insertResult.createdAt;

            // 완료 메시지와 provider 장부 상태를 함께 확정한 뒤에만 성공을 보낸다.
            send({
              type: "done",
              fullContent: cleanText,
              metadata: {
                toolResults,
                toolsUsed,
                senderName,
                stageTag,
                specialistType,
                serverMessageId,
                serverCreatedAt,
                ...(mediation ? { mediation } : {}),
              },
            });

            // Memory Step A: 10 메시지+ 누적 시 요약 생성 (fire-and-forget)
            const messagesWithLatest = [
              ...typedMessages.map((m) => ({ role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant", content: m.content, id: m.id })),
              { role: "assistant" as const, content: cleanText },
            ];
            // private 삭제와 후처리 write가 경합하지 않도록 private 턴은 파생 메모리를
            // 만들지 않는다. private 원문은 완성 메시지 한 곳에만 보관한다.
            if (visibility === "shared" && ENABLE_AUXILIARY_MEMORY) {
              void maybeSummarize({
              coupleId,
              userId: user.id,
              messages: messagesWithLatest,
              lastCoveredCount,
              lastToMessageId,
              visibility,
              signal: routeSignal,
              reserveLLMCall: reserveAuxiliaryLLMCall,
            });

            // Memory Step B: 이번 턴 decision/preference 추출 (fire-and-forget)
              void maybeExtractDecision({
              coupleId,
              userId: user.id,
              messages: messagesWithLatest,
              stageTag,
              lastUserText,
              visibility,
              signal: routeSignal,
              reserveLLMCall: reserveAuxiliaryLLMCall,
            });

            // Excavation 기법 사용 분류 (fire-and-forget)
              void maybeClassifyExcavation({
              coupleId,
              userId: user.id,
              lastUserText,
              aiResponseText: cleanText,
              stageTag,
              visibility,
              signal: routeSignal,
              reserveLLMCall: reserveAuxiliaryLLMCall,
            });

            // 아모라 장기 개인화 프로필 갱신 (fire-and-forget)
              void maybeUpdateAmoraProfile({
              coupleId,
              userId: user.id,
              visibility,
              messages: messagesWithLatest,
              lastUserText,
              aiResponseText: cleanText,
              currentProfile: amoraProfiles.shared,
              stageTag,
              isDemo,
              signal: routeSignal,
              reserveLLMCall: reserveAuxiliaryLLMCall,
              });
            }

            return;
          }

          // Claim the one possible follow-up slot before any tool I/O. This
          // avoids doing tool I/O only to discover at final generation
          // time that another concurrent request consumed the last slot.
          await reserveProviderCallOrThrow();

          // tool use 감지 → 스트리밍된 텍스트 클리어 후 도구 실행
          send({ type: "text_clear" });

          // UI 카드로 자동 렌더링되는 도구 목록
          const toolResultInputs: ChatResponseInput = [];

          for (const toolCall of result.toolCalls) {
            routeSignal.throwIfAborted();
            await assertRequestStillAuthorized();
            toolsUsed.push(toolCall.name);

            send({ type: "tool_start", toolName: toolCall.name, toolInput: toolCall.input });
            const toolStartedAt = startLatencyClock();
            let execResult: ToolExecutionResult;

            if (toolCall.parseError) {
              execResult = {
                toolName: toolCall.name,
                toolInput: {},
                toolOutput: { error: "invalid_arguments" },
                success: false,
                displayMessage: "도구 요청 형식이 올바르지 않아 실행하지 않았습니다.",
              };
            } else {
              execResult = await executeTool(toolCall.name, toolCall.input, executionContext);
            }
            toolResults.push(execResult);
            // 최종 모델 라운드가 실패해도 호출 결과의 최소 감사 정보는 남긴다.
            // 실제 입력·출력은 저장하지 않고 private 범위는 visibility로 구분한다.
            await logAIInteraction({
              userId: null,
              coupleId: null,
              interactionType: "tool_result",
              required: true,
              specialistType,
              toolName: toolCall.name,
              toolInput: null,
              toolOutput: null,
              latencyMs: elapsedMs(toolStartedAt),
              success: execResult.success,
              errorMessage: execResult.success
                ? null
                : safeToolErrorCode(execResult.toolOutput),
              metadata: {
                call_id: toolCall.callId,
                visibility,
                client_request_id: clientRequestId,
                parse_error: toolCall.parseError ?? null,
              },
            });

            routeSignal.throwIfAborted();
            send({ type: "tool_result", result: execResult });
            // UI 카드로 렌더링되는 도구는 텍스트 중복 방지 리마인더 추가
            const outputJson = serializeUntrustedToolResultForModel(execResult.toolOutput, {
              success: execResult.success,
              displayMessage: execResult.displayMessage,
            });
            const reminder = !supportsToolCards
              ? "\n[SYSTEM: 이 클라이언트는 결과 카드를 렌더링하지 못합니다. 도구의 성공/실패와 사용자가 알아야 할 핵심 결과를 최종 텍스트에 반드시 요약하세요.]"
              : "";
            toolResultInputs.push(buildToolResultInput(toolCall.callId, outputJson + reminder));
          }

          // store:false 상태에서도 reasoning/function call item을 순서대로 재전송해야
          // 다음 라운드의 도구 결과가 원래 호출과 안전하게 연결된다.
          currentInput = [
            ...currentInput,
            ...result.outputItems,
            ...toolResultInputs,
          ];
        }

        // 최대 라운드 초과 시 도구를 비활성화하고 사용자에게 최종 텍스트만 생성한다.
        const finalResult = await chatWithToolsStream({
          systemPrompt,
          input: currentInput,
          tools: [],
          maxOutputTokens: MAX_CHAT_OUTPUT_TOKENS,
          maxInputTokens: MAX_CHAT_INPUT_TOKENS,
          beforeInputCount: assertRequestStillAuthorized,
          beforeInputCountRequest: markReservedProviderStarted,
          beforeCreate: assertRequestStillAuthorized,
          beforeProviderRequest: assertRequestStillAuthorized,
          safetyIdentifier,
          modelRole: chatModelRole,
          signal: routeSignal,
          onTextDelta: (token) => {
            send({ type: "text_delta", content: token });
          },
        });

        // 마지막 호출 토큰/모델 집계
        recordRequestUsage(finalResult.model, finalResult.usage);
        if (finalResult.model) lastModel = finalResult.model;
        routeSignal.throwIfAborted();

        const { cleanText: afterSuggest2, suggestions } = extractSuggestions(
          finalResult.fullText
        );
        const { cleanText, mediation } = extractMediation(afterSuggest2);
        lastGeneratedCleanText = cleanText;

        if (suggestions.length > 0) {
          send({ type: "suggestions", suggestions });
        }

        // 서버 사이드 INSERT (MAX_TOOL_ROUNDS 초과 분기 — idempotency 포함)
        await assertRequestStillAuthorized();
        const insertResult2 = await completeAiMessage({
          userId: user.id,
          coupleId,
          cleanText,
          clientRequestId,
          requestKey,
          requestHash,
          expectedPrivateClearedAt,
          expectedMembershipGeneration,
          expectedCoupleContextGeneration,
          metadata: { toolResults, toolsUsed, ...(mediation ? { mediation } : {}) },
          stageTag,
          specialistType,
          visibility,
          audit: {
            userInput: null,
            aiOutput: null,
            latencyMs: elapsedMs(turnStartedAt),
            model: lastModel ?? null,
            tokensInput: totalTokensIn || null,
            tokensOutput: totalTokensOut || null,
            costUsd: getTurnCostUsd(),
            metadata: {
              stage_tag: stageTag,
              tools_used: toolsUsed,
              tool_rounds: MAX_TOOL_ROUNDS,
              exceeded_max_rounds: true,
              correction_count: correctionCount,
              visibility,
              client_request_id: clientRequestId,
              request_usage: requestUsage,
              usage_limit_mode: AMORA_USAGE_LIMIT_MODE,
              quota_class: reservationParams.isAdmin ? "admin_turn" : "user_turn",
              request_key: requestKey,
              provider_reservation_count: nextProviderOrdinal,
              cache_write_input_tokens: totalCacheWriteTokens,
              cache_read_input_tokens: totalCacheReadTokens,
            },
          },
        });
        const completionState2 = await reconcileChatRequestFinalState(serviceClient, {
          requestKey,
          requestHash,
          reason: "completed",
        });
        if (completionState2.finalStatus !== "completed") {
          throw new Error("완료된 아모라 요청의 비용 장부를 확정하지 못했습니다.");
        }

        // Memory Step A + B: 요약 생성 + decision/preference 추출 (fire-and-forget)
        const messagesWithLatest = [
          ...typedMessages.map((m) => ({ role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant", content: m.content, id: m.id })),
          { role: "assistant" as const, content: cleanText },
        ];
        if (visibility === "shared" && ENABLE_AUXILIARY_MEMORY) {
          void maybeSummarize({
          coupleId,
          userId: user.id,
          messages: messagesWithLatest,
          lastCoveredCount,
          lastToMessageId,
          visibility,
          signal: routeSignal,
          reserveLLMCall: reserveAuxiliaryLLMCall,
        });
          void maybeExtractDecision({
          coupleId,
          userId: user.id,
          messages: messagesWithLatest,
          stageTag,
          lastUserText,
          visibility,
          signal: routeSignal,
          reserveLLMCall: reserveAuxiliaryLLMCall,
        });
          void maybeClassifyExcavation({
          coupleId,
          userId: user.id,
          lastUserText,
          aiResponseText: cleanText,
          stageTag,
          visibility,
          signal: routeSignal,
          reserveLLMCall: reserveAuxiliaryLLMCall,
        });

        // 아모라 장기 개인화 프로필 갱신 (fire-and-forget)
          void maybeUpdateAmoraProfile({
          coupleId,
          userId: user.id,
          visibility,
          messages: messagesWithLatest,
          lastUserText,
          aiResponseText: cleanText,
          currentProfile: amoraProfiles.shared,
          stageTag,
          isDemo,
          signal: routeSignal,
          reserveLLMCall: reserveAuxiliaryLLMCall,
          });
        }

        send({
          type: "done",
          fullContent: cleanText,
          metadata: {
            toolResults,
            toolsUsed,
            senderName,
            stageTag,
            specialistType,
            serverMessageId: insertResult2.id,
            serverCreatedAt: insertResult2.createdAt,
            ...(mediation ? { mediation } : {}),
          },
        });
      } catch (err) {
        if (err instanceof OpenAIResponseError) {
          recordRequestUsage(err.model, err.usage);
          if (err.model) lastModel = err.model;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        const normalizedErrMsg = errMsg.toLowerCase();
        const safeErrorCode = safeChatErrorCode(err);
        // Provider/SDK/DB messages can reflect request fragments. Keep free
        // text out of both persistent audit rows and server logs.
        console.error("채팅 API 에러:", safeErrorCode);
        let visibleRefunded = false;
        try {
          const reconciliation = await reconcileChatRequestFinalState(serviceClient, {
            requestKey,
            requestHash,
            reason: classifyAmoraFailureForLedger(err),
          });
          visibleRefunded = reconciliation.visibleRefunded;
          if (reconciliation.finalStatus === "completed") {
            const completedEvent = reconciliation.messageId
              ? await loadCompletedChatEvent(serviceClient, coupleId, reconciliation.messageId)
              : {
                  type: "done",
                  fullContent: lastGeneratedCleanText,
                  metadata: { idempotencyReplayed: true },
                };
            if (completedEvent) {
              send(completedEvent);
            }
            return;
          }
        } catch (reconciliationError) {
          console.error(
            "채팅 실패/완료 원자 조정 실패:",
            safeChatErrorCode(reconciliationError)
          );
          await markChatExecutionFailed(serviceClient, requestKey, requestHash);
        }
        // 내부 에러 원문(모델명·스택·DB 제약 등)을 클라이언트·로그·감사행에 노출하지 않는다.
        const clientErrorMessage = err instanceof AmoraCostGuardError
          ? err.message
          : err instanceof OpenAIInputTokenLimitError
            ? "대화나 첨부 문서가 너무 길어요. 첨부를 줄이거나 새 대화에서 다시 시도해 주세요."
          : routeSignal.aborted || normalizedErrMsg.includes("timeout") || normalizedErrMsg.includes("abort")
            ? "응답 시간이 초과되었거나 연결이 취소되었습니다."
            : "AI 응답 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.";
        send({
          type: "error",
          message: clientErrorMessage,
          ...(err instanceof AmoraCostGuardError
            ? { code: err.result.reason ?? "guard_unavailable" }
            : {}),
        });

        // D1: 실패 turn 로깅
        await logAIInteraction({
          userId: null,
          coupleId: null,
          interactionType: "chat_turn",
          specialistType,
          userInput: null,
          aiOutput: null,
          latencyMs: elapsedMs(turnStartedAt),
          success: false,
          errorMessage: safeErrorCode,
          model: lastModel,
          tokensInput: totalTokensIn || null,
          tokensOutput: totalTokensOut || null,
          cacheWriteTokens: totalCacheWriteTokens || null,
          cacheReadTokens: totalCacheReadTokens || null,
          costUsd: getTurnCostUsd(),
          metadata: {
            stage_tag: stageTag,
            visibility,
            client_request_id: clientRequestId,
            request_key: requestKey,
            usage_limit_mode: AMORA_USAGE_LIMIT_MODE,
            quota_class: "failed_attempt",
            provider_reservation_count: nextProviderOrdinal,
            visible_quota_refunded: visibleRefunded,
            request_usage: requestUsage,
            tools_used: toolsUsed,
            tool_results: toolResults.map((result) => ({
              tool_name: result.toolName,
              success: result.success,
            })),
          },
        });
      } finally {
        if (providerLeaseId) {
          const { error: releaseError } = await serviceClient.rpc(
            "release_amora_provider_lease",
            { p_lease_id: providerLeaseId }
          );
          if (releaseError) {
            console.error("아모라 provider lease 해제 실패:", safeChatErrorCode(releaseError));
          }
        }
        clearInterval(heartbeat);
        closeStream();
      }
    },
    cancel(reason) {
      if (!responseAbortController.signal.aborted) {
        responseAbortController.abort(
          reason instanceof Error
            ? reason
            : new DOMException("Response stream cancelled", "AbortError")
        );
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
