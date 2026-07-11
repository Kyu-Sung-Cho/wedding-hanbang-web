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
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { loadFeedbackLessons } from "@/lib/ai/feedbackLessons";
import { BETA_SAFE_TOOLS, READ_ONLY_SAFE_TOOLS } from "@/lib/ai/tools";
import { executeTool } from "@/lib/ai/toolExecutor";
import { extractSuggestions } from "@/lib/ai/chatSuggestions";
import { countRecentConsecutiveDissatisfaction } from "@/lib/ai/dissatisfaction";
import { determineStage, routeSpecialist, getSpecialistPromptAddon } from "@/lib/ai/stage-router";
import { calcCostUsd, logAIInteraction, startLatencyClock, elapsedMs } from "@/lib/compliance/ai-log";
import { maybeSummarize } from "@/lib/ai/summarize";
import { maybeExtractDecision } from "@/lib/ai/extract-decision";
import { extractMediation } from "@/lib/ai/mediation";
import { maybeClassifyExcavation } from "@/lib/ai/classify-excavation";
import { loadAmoraProfiles, maybeUpdateAmoraProfile } from "@/lib/ai/amora-profile";
import {
  reserveAmoraProviderCall,
  reserveAmoraUserTurn,
  type CostGuardResult,
} from "@/lib/ai/costGuard";
import { createSafetyIdentifier } from "@/lib/ai/safetyIdentifier";
import { chooseAmoraChatModelRole, hasOpenAIConfig } from "@/lib/ai/modelConfig";
import {
  claimToolExecution,
  completeToolExecutionClaim,
  createToolExecutionKey,
  ToolExecutionClaimError,
} from "@/lib/ai/toolExecutionClaim";
import {
  ChatExecutionClaimError,
  claimChatExecution,
  completeChatExecutionWithoutReplay,
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
import type { ToolExecutionResult } from "@/types/database.types";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
// mammoth는 필요할 때만 동적 import (Vercel 호환성)

// 웹 클라이언트 180초 제한보다 먼저 종료해 플랫폼 강제 종료와 유령 과금을 피한다.
export const maxDuration = 175;

// 비용 상한: 도구 선택 Terra 1회 + 결과 설명 Terra 1회가 최대다.
// 연쇄 도구 계획은 한 사용자 턴에 허용하지 않는다.
const MAX_TOOL_ROUNDS = 1;
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
const MAX_DOCX_BYTES = 2 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 200;
const MAX_DOCX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_DOCX_COMPRESSION_RATIO = 100;
const MAX_EXTRACTED_TEXT_CHARS = 10_000;
const MAX_TOTAL_ATTACHMENT_TEXT_CHARS = 15_000;
const MAX_CONTEXT_MESSAGES = 20;
const MAX_SINGLE_MESSAGE_CHARS = 6_000;
const MAX_TOTAL_MESSAGE_CHARS = 24_000;
// Hidden post-response model jobs can outlive account/private deletion and add
// unpredictable Luna spend. Keep them code-hard-disabled until each write has
// the same lifecycle lock and durable job cancellation semantics as main chat.
const ENABLE_AUXILIARY_MEMORY = false;

interface IncomingChatMessage {
  role: "user" | "assistant";
  content: string;
  id?: string;
}

// Service role 클라이언트 (RLS 우회 — 자동 피드백 저장용)
function getServiceClient() {
  return createAdminClient();
}

// request claim 완료와 AI 메시지 INSERT를 한 DB 트랜잭션에서 확정한다.
// private 응답은 삭제 세대가 바뀌지 않았을 때만 같은 profile row lock 안에서 저장된다.
async function completeAiMessage(params: {
  isDemo: boolean;
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
  if (params.isDemo) {
    await logAIInteraction({
      userId: params.userId,
      coupleId: params.coupleId,
      interactionType: "chat_turn",
      specialistType: params.specialistType as Parameters<typeof logAIInteraction>[0]["specialistType"],
      userInput: params.audit.userInput,
      aiOutput: params.audit.aiOutput,
      latencyMs: params.audit.latencyMs,
      success: true,
      model: params.audit.model,
      tokensInput: params.audit.tokensInput,
      tokensOutput: params.audit.tokensOutput,
      costUsd: params.audit.costUsd,
      metadata: params.audit.metadata,
      required: true,
    });
    await completeChatExecutionWithoutReplay(admin, params.requestKey, params.requestHash);
    return { id: null, createdAt: null };
  }
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
  return new Response(`data: ${JSON.stringify(event)}\n\n`, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// DOCX에서 텍스트 추출 (동적 import)
async function extractDocxText(base64: string): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const mammoth = await import("mammoth");
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength > MAX_DOCX_BYTES) throw new Error("DOCX 크기 초과");

  const archive = await JSZip.loadAsync(buffer);
  const entries = Object.values(archive.files);
  if (entries.length > MAX_DOCX_ENTRIES) throw new Error("DOCX 내부 파일 수 초과");
  let totalUncompressed = 0;
  for (const entry of entries) {
    const data = (entry as unknown as {
      _data?: { compressedSize?: number; uncompressedSize?: number };
    })._data;
    const compressed = Math.max(data?.compressedSize ?? 0, 1);
    const uncompressed = data?.uncompressedSize ?? 0;
    totalUncompressed += uncompressed;
    if (uncompressed / compressed > MAX_DOCX_COMPRESSION_RATIO) {
      throw new Error("DOCX 압축률이 안전 한도를 초과합니다.");
    }
  }
  if (totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) {
    throw new Error("DOCX 압축 해제 크기 초과");
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("DOCX 처리 시간 초과")), 5_000);
  });
  let result: Awaited<ReturnType<typeof mammoth.extractRawText>>;
  try {
    result = await Promise.race([mammoth.extractRawText({ buffer }), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return result.value.trim();
}

// 첨부파일 처리: OpenAI Responses API에 보낼 형태로 변환
interface ProcessedAttachment {
  visionAttachments: ImageAttachment[]; // 이미지/PDF → OpenAI image/file input
  textAttachments: string[]; // DOCX/XLSX → 추출된 텍스트
}

const VISION_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
const WORD_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
];
const UNSUPPORTED_SPREADSHEET_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.ms-excel", // xls
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

function limitExtractedText(text: string): string {
  return text.length > MAX_EXTRACTED_TEXT_CHARS
    ? `${text.slice(0, MAX_EXTRACTED_TEXT_CHARS)}\n\n[첨부문서가 길어 일부만 분석합니다.]`
    : text;
}

async function assertSupportedVisionBuffer(buffer: Buffer, mediaType: string): Promise<void> {
  if (mediaType === "application/pdf") {
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
    return;
  }

  const sharp = (await import("sharp")).default;
  const metadata = await sharp(buffer, { animated: true }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height || width * height > MAX_IMAGE_PIXELS) {
    throw new Error("이미지 해상도가 너무 큽니다.");
  }
  if (mediaType === "image/gif" && (metadata.pages ?? 1) > 1) {
    throw new Error("애니메이션 GIF는 지원되지 않습니다. 정지 이미지로 변환해주세요.");
  }
}

async function processAttachments(
  attachments: unknown[],
  signal: AbortSignal
): Promise<ProcessedAttachment> {
  const visionAttachments: ImageAttachment[] = [];
  const textAttachments: string[] = [];
  let totalAttachmentBytes = 0;

  for (const att of (attachments || []).slice(0, MAX_ATTACHMENTS)) {
    signal.throwIfAborted();
    const item = parseInlineAttachment(att);

    if (VISION_TYPES.includes(item.mediaType)) {
      const base64 = assertBase64UnderLimit(item.base64);
      const buffer = Buffer.from(base64, "base64");
      await assertSupportedVisionBuffer(buffer, item.mediaType);
      signal.throwIfAborted();
      totalAttachmentBytes += buffer.byteLength;
      if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error("첨부파일 합계 크기 초과");
      visionAttachments.push({
        base64,
        mediaType: item.mediaType as ImageAttachment["mediaType"],
        fileName: safeFileName(
          item.fileName,
          item.mediaType === "application/pdf" ? "attachment.pdf" : "attachment"
        ),
      });
    } else if (WORD_TYPES.includes(item.mediaType)) {
      const base64 = assertBase64UnderLimit(item.base64);
      totalAttachmentBytes += Buffer.from(base64, "base64").byteLength;
      if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error("첨부파일 합계 크기 초과");
      const text = await extractDocxText(base64);
      signal.throwIfAborted();
      if (!text) {
        throw new Error("DOCX 문서에서 읽을 텍스트를 찾지 못했습니다.");
      }
      textAttachments.push(`[첨부문서: ${safeFileName(item.fileName, "document.docx")}]\n${limitExtractedText(text)}`);
    } else if (UNSUPPORTED_SPREADSHEET_TYPES.includes(item.mediaType)) {
      textAttachments.push(
        `[첨부스프레드시트: ${safeFileName(item.fileName, "spreadsheet.xlsx")}]\n` +
        "보안상의 이유로 Excel 파일 분석은 현재 비활성화되어 있습니다. PDF 또는 DOCX로 변환해 업로드해주세요."
      );
    } else {
      throw new Error("지원하지 않는 첨부파일 형식입니다.");
    }
  }

  let remainingTextChars = MAX_TOTAL_ATTACHMENT_TEXT_CHARS;
  const boundedTextAttachments: string[] = [];
  for (const text of textAttachments) {
    if (remainingTextChars <= 0) break;
    const bounded = text.slice(0, remainingTextChars);
    boundedTextAttachments.push(
      bounded.length < text.length
        ? `${bounded}\n\n[첨부문서 합계가 길어 일부만 분석합니다.]`
        : bounded
    );
    remainingTextChars -= bounded.length;
  }

  return { visionAttachments, textAttachments: boundedTextAttachments };
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

  // 인증 체크 (웹: 쿠키, 앱: Bearer 토큰)
  const supabase = await createClientFromRequest(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const limited = await checkRateLimitPersistent(rateLimitKey("chat", request, user.id), {
    maxRequests: 60,
    windowMs: 60 * 60 * 1000,
  });
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = await readBoundedJsonBody(request, { signal: routeSignal });
  } catch (error) {
    return chatRequestErrorResponse(error, routeSignal);
  }

  let clientContext: ReturnType<typeof parseClientChatContext>;
  try {
    clientContext = parseClientChatContext(body);
  } catch (error) {
    return chatRequestErrorResponse(error, routeSignal);
  }

  const {
    messages: rawMessages,
    coupleId,
    attachments,
    isDemo: bodyIsDemo,
    clientRequestId: bodyClientRequestId,
    visibility: bodyVisibility,
  } = body;
  const isDemo =
    bodyIsDemo === true &&
    hasSignedDemoSessionFromCookieHeader(request.headers.get("cookie"));
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

  if (!Array.isArray(rawMessages) || typeof coupleId !== "string" || !coupleId) {
    return NextResponse.json(
      { error: "메시지와 커플 ID가 필요합니다." },
      { status: 400 }
    );
  }

  if (rawMessages.length === 0 || rawMessages.length > MAX_CONTEXT_MESSAGES) {
    return NextResponse.json(
      { error: `대화는 최근 ${MAX_CONTEXT_MESSAGES}개 메시지만 보내주세요.` },
      { status: 413 }
    );
  }

  const messages: IncomingChatMessage[] = [];
  let totalMessageChars = 0;
  for (const value of rawMessages) {
    if (
      !value ||
      typeof value !== "object" ||
      (value.role !== "user" && value.role !== "assistant") ||
      typeof value.content !== "string" ||
      value.content.length === 0
    ) {
      return NextResponse.json({ error: "메시지 형식이 올바르지 않습니다." }, { status: 400 });
    }
    if (value.content.length > MAX_SINGLE_MESSAGE_CHARS) {
      return NextResponse.json({ error: "메시지 한 개가 너무 깁니다." }, { status: 413 });
    }
    totalMessageChars += value.content.length;
    if (totalMessageChars > MAX_TOTAL_MESSAGE_CHARS) {
      return NextResponse.json({ error: "대화 내용이 너무 깁니다. 새 대화를 시작해주세요." }, { status: 413 });
    }
    messages.push({
      role: value.role,
      content: value.content,
      ...(typeof value.id === "string" ? { id: value.id.slice(0, 120) } : {}),
    });
  }

  if (messages[messages.length - 1]?.role !== "user") {
    return NextResponse.json({ error: "마지막 메시지는 사용자 메시지여야 합니다." }, { status: 400 });
  }

  const requestAttachments = attachments ?? body.images ?? [];
  if (!Array.isArray(requestAttachments)) {
    return NextResponse.json({ error: "첨부파일 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (requestAttachments.length > MAX_ATTACHMENTS) {
    return NextResponse.json(
      { error: `첨부파일은 최대 ${MAX_ATTACHMENTS}개까지 보낼 수 있습니다.` },
      { status: 413 }
    );
  }

  // coupleId 소유 검증: 해당 커플에 속하는 사용자인지 확인
  const { data: userProfile, error: userProfileError } = await supabase
    .from("profiles")
    .select("name, couple_id, role, is_admin, private_chat_cleared_at, private_chat_deleting_at, account_deleting_at, amora_membership_resetting_at, amora_membership_generation")
    .eq("id", user.id)
    .single();

  if (userProfileError) {
    console.error("채팅 사용자 프로필 조회 실패:", userProfileError.message);
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
  if (requestedVisibility !== "shared" && userProfile.private_chat_deleting_at) {
    return NextResponse.json({ error: "비공개 상담 삭제가 진행 중입니다. 잠시 후 다시 시도해 주세요." }, { status: 409 });
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

  const safetyIdentifier = createSafetyIdentifier(user.id);

  // 첨부파일 처리
  let processedAttachments: ProcessedAttachment;
  try {
    processedAttachments = await processAttachments(requestAttachments, routeSignal);
  } catch (err) {
    if (err instanceof ChatRequestError || routeSignal.aborted) {
      return chatRequestErrorResponse(err, routeSignal);
    }
    const message = err instanceof Error ? err.message : "첨부파일 처리 실패";
    const tooLarge = message.includes("크기 초과") || message.includes("해상도") || message.includes("페이지");
    const safeMessage = tooLarge
      ? message
      : message.includes("애니메이션 GIF") || message.includes("지원하지 않는")
        ? message
        : "첨부파일을 안전하게 읽지 못했습니다. 파일을 확인해 다시 올려주세요.";
    return NextResponse.json({ error: safeMessage }, { status: tooLarge ? 413 : 400 });
  }
  const { visionAttachments, textAttachments } = processedAttachments;

  // 전체 요청을 provider/tool 실행 전에 원자 선점한다. payload는 저장하지 않고
  // 서버 전용 HMAC으로 보호된 해시만 남긴다.
  const serviceClient = getServiceClient();
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
  const ownsInitialSlot = userProfile.role === "bride"
    ? initialCouple?.bride_id === user.id
    : userProfile.role === "groom"
      ? initialCouple?.groom_id === user.id
      : false;
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
      .select("couple_id, role, private_chat_cleared_at, private_chat_deleting_at, account_deleting_at, amora_membership_resetting_at, amora_membership_generation")
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
  let requestKey: string;
  let requestHash: string;
  try {
    ({ requestKey, requestHash } = createChatRequestIdentity({
      userId: user.id,
      coupleId,
      clientRequestId,
      payload: {
        messages,
        attachments: requestAttachments,
        visibility,
      },
    }));
  } catch (error) {
    console.error("채팅 요청 HMAC 설정 오류:", error);
    return NextResponse.json({ error: "채팅 안전 설정을 확인하지 못했습니다." }, { status: 503 });
  }
  try {
    await assertRequestStillAuthorized();
  } catch (error) {
    console.error("채팅 초기 회원 상태 검증 실패:", error);
    return NextResponse.json({ error: "현재 커플 연결 상태로 상담을 시작할 수 없습니다." }, { status: 409 });
  }
  // 병렬로 커플 관련 데이터 전체 조회
  const [journeyResult, profilesResult, bookingsResult, summariesResult, decisionsResult, conflictsResult, feedbackLessons, amoraProfiles] = await Promise.all([
    // 1. 웨딩 저니
    supabase.from("wedding_journeys").select("*").eq("couple_id", coupleId).single(),
    // 2. 커플 프로필 (신부/신랑 이름, 역할)
    serviceClient.from("profiles").select("name, role").eq("couple_id", coupleId),
    // 3. 예약 내역 (취소 제외)
    supabase.from("vendor_bookings")
      .select("id, vendor_id, booking_date, booking_time, status, amount, contracted_amount, actual_amount, memo, vendors(name, category)")
      .eq("couple_id", coupleId)
      .neq("status", "cancelled")
      .order("booking_date", { ascending: true }),
    // 4. 대화 요약 (최근 3개) — visibility 격리 (2026-05-04)
    //    shared turn → shared summary만 / private turn → shared + 본인 visibility
    (() => {
      const q = supabase.from("chat_summaries")
        .select("summary, created_at, message_count, to_message_id")
        .eq("couple_id", coupleId)
        .order("created_at", { ascending: false })
        .limit(3);
      return (
        visibility === "shared"
          ? q.eq("visibility", "shared")
          : q.in("visibility", ["shared", visibility])
      );
    })(),
    // 5. Memory Step C: 의사결정 히스토리 (최근 50개, AI 추출 + manual/booking/onboarding 포함)
    //    "6개월 전 결정도 기억" 마케팅 약속 실현 — 활성 사용자도 충분히 소화.
    //    RLS가 visibility 자동 필터: 본인 private + shared만 SELECT 됨. 파트너 private은 안 옴.
    supabase.from("decision_nodes")
      .select("category, decision_type, title, chosen_value, reasoning, confidence, stage_tag, source, visibility, created_at")
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: false })
      .limit(50),
    // 6. Mediation 강화: 갈등→합의 히스토리 (최근 5개) — visibility 격리용으로 컬럼도 select
    supabase.from("decision_nodes")
      .select("title, chosen_value, reasoning, stage_tag, visibility, created_at")
      .eq("couple_id", coupleId)
      .eq("category", "conflict_resolution")
      .order("created_at", { ascending: false })
      .limit(5),
    // 7. 피드백 학습 내용 (AI 품질 개선용)
    loadFeedbackLessons(coupleId),
    // 8. 아모라 장기 개인화 프로필 (shared + 본인 private만)
    loadAmoraProfiles(coupleId, visibility),
  ]);

  if (routeSignal.aborted) {
    return chatRequestErrorResponse(routeSignal.reason, routeSignal);
  }

  const journey = journeyResult.data;
  if (journeyResult.error) {
    console.error("Journey 조회 에러:", journeyResult.error.message);
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

  // 예약 내역 정리
  const toAmount = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) {
      const amount = Number(value);
      return Number.isFinite(amount) ? amount : null;
    }
    return null;
  };

  const bookings = (bookingsResult.data ?? []).map((b) => {
    const vendor = b.vendors as unknown as { name: string; category: string } | null;
    return {
      vendorName: vendor?.name ?? "알 수 없는 업체",
      category: vendor?.category ?? "",
      date: b.booking_date as string,
      time: b.booking_time as string,
      status: b.status as string,
      amount: toAmount(b.amount),
      contractedAmount: toAmount(b.contracted_amount),
      actualAmount: toAmount(b.actual_amount),
    };
  });

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

  // 대화 요약은 visibility별 RLS 정책을 통해 shared/bride/groom 범위가 분리된다.
  const summariesData = (summariesResult.data ?? []) as Array<{
    summary: string;
    created_at: string;
    message_count: number | null;
    to_message_id: string | null;
  }>;
  const chatSummaries = summariesData.map((s) => s.summary);

  // Memory Step A: 마지막 요약 watermark (trigger용)
  const lastSummary = summariesData[0] ?? null;
  const lastCoveredCount = lastSummary?.message_count ?? 0;
  const lastToMessageId = lastSummary?.to_message_id ?? null;

  // Memory Step C: 의사결정 히스토리 정리 — 프라이버시 가드
  // RLS는 partner private을 막지만 본인 private은 응답에 포함됨.
  // shared 응답엔 shared decision만, private 응답엔 shared + 같은 visibility만.
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
  const lastUserMsg = [...typedMessages].reverse().find((m) => m.role === "user");
  const lastUserText = lastUserMsg?.content ?? "";

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

  const systemPrompt = cautionPrefix + privacyPrefix + getWeddingPlannerSystemPrompt({
    weddingDate: weddingDateForStage,
    budget: trustedWeddingContext.budget,
    venue: trustedWeddingContext.venue,
    progress,
    brideName,
    groomName,
    senderName,
    bookings,
    scheduleEvents,
    chatSummaries,
    preferences: preferences ?? undefined,
    amoraProfiles,
    feedbackLessons,
    pastDecisions,
    pastConflicts,
  }) + specialistAddon;

  // 메시지 포맷팅
  const formattedMessages: ChatMessageInput[] = messages.map(
    (m: { role: string; content: string }, index: number) => {
      const role = m.role === "assistant" ? ("assistant" as const) : ("user" as const);
      const isLastUserMessage = role === "user" && index === messages.length - 1;

      if (isLastUserMessage) {
        // 문서 텍스트가 있으면 메시지에 포함
        let enrichedText = m.content;
        if (textAttachments.length > 0) {
          enrichedText = `${textAttachments.join("\n\n")}\n\n${m.content}`;
        }

        // 이미지/PDF 첨부가 있으면 멀티모달로
        if (visionAttachments.length > 0) {
          return {
            role,
            content: buildMultimodalContent(enrichedText, visionAttachments),
          };
        }

        return { role, content: enrichedText };
      }

      return { role, content: m.content };
    }
  );

  const executionContext: ToolExecutionContext = {
    coupleId,
    currentUserId: user.id,
    currentUserText: lastUserText,
    signal: routeSignal,
    // 모델 기반 상태 변경은 서버 발급 exact-action 확인 토큰과 각 mutation의
    // 회원 상태 잠금 RPC가 완성될 때까지 실행기에서도 이중 차단한다.
    allowMutations: false,
    weddingContext: {
      weddingDate: trustedWeddingContext.weddingDate,
      budget: trustedWeddingContext.budget,
      venue: trustedWeddingContext.venue,
      progress: trustedWeddingContext.progress as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
  const canUseExternalSearch = visibility === "shared" && requestAttachments.length === 0;
  const toolsForTurn = canUseExternalSearch
    ? BETA_SAFE_TOOLS
    : READ_ONLY_SAFE_TOOLS;

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
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "요청 상태를 안전하게 확인하지 못했습니다." }, { status: 503 });
  }

  // 토큰 사전 계산을 통과한 실제 generation만 예약한다. 상한 초과 입력이
  // 커플/전역 쿼터를 태우지 않도록 예약은 chatWithToolsStream.beforeCreate에서 수행한다.
  const reservationParams = {
    coupleId,
    isAdmin: userProfile?.is_admin === true,
  };

  // 숨은 Luna 후처리도 각각 원자 예약한다. 메인 채팅만 예약하고 요약·분류·
  // 프로필 호출이 전역 비용 상한을 우회하는 경로를 남기지 않는다.
  const reserveAuxiliaryLLMCall = async (): Promise<boolean> => {
    if (routeSignal.aborted) return false;
    await assertRequestStillAuthorized();
    const reservation = await reserveAmoraProviderCall(serviceClient, reservationParams);
    return reservation.allowed && !routeSignal.aborted;
  };
  const reserveProviderCallOrThrow = async (): Promise<CostGuardResult> => {
    routeSignal.throwIfAborted();
    const reservation = await reserveAmoraProviderCall(serviceClient, reservationParams);
    if (!reservation.allowed) {
      throw new AmoraCostGuardError(reservation);
    }
    routeSignal.throwIfAborted();
    return reservation;
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
      const toolOccurrenceCounts = new Map<string, number>();
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
        let currentTools = toolsForTurn;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          routeSignal.throwIfAborted();
          // 실시간 스트리밍: 모든 라운드에서 텍스트 토큰을 즉시 클라이언트로 전송
          // tool_use가 발견되면 text_clear로 리셋 후 도구 실행
          const result = await chatWithToolsStream({
            systemPrompt,
            input: currentInput,
            tools: currentTools,
            maxOutputTokens: MAX_CHAT_OUTPUT_TOKENS,
            maxInputTokens: MAX_CHAT_INPUT_TOKENS,
            beforeInputCount: assertRequestStillAuthorized,
            beforeCreate: async () => {
              await assertRequestStillAuthorized();
              if (round === 0) {
                routeSignal.throwIfAborted();
                const reservation = await reserveAmoraUserTurn(serviceClient, reservationParams);
                if (!reservation.allowed) throw new AmoraCostGuardError(reservation);
                if (typeof reservation.remaining === "number" && reservation.remaining <= 15) {
                  send({ type: "quota", remaining: reservation.remaining });
                }
              } else {
                await reserveProviderCallOrThrow();
              }
            },
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

            if (suggestions.length > 0) {
              send({ type: "suggestions", suggestions });
            }

            // 서버 사이드 INSERT (with 10s idempotency)
            // 모바일 retry / 중복 fetch 시 동일 내용을 또 INSERT하지 않음.
            await assertRequestStillAuthorized();
            const insertResult = await completeAiMessage({
              isDemo,
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
                  quota_class: "user_turn",
                  cache_write_input_tokens: totalCacheWriteTokens,
                  cache_read_input_tokens: totalCacheReadTokens,
                },
              },
            });
            const serverMessageId: string | null = insertResult.id;
            const serverCreatedAt: string | null = insertResult.createdAt;

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

          // tool use 감지 → 스트리밍된 텍스트 클리어 후 도구 실행
          send({ type: "text_clear" });

          // UI 카드로 자동 렌더링되는 도구 목록
          const UI_RENDERED_TOOLS = new Set([
            "search_vendors", "recommend_vendors", "get_vendor_detail",
            "get_available_slots", "create_booking", "cancel_booking", "search_nearby_places",
            "analyze_quote", "analyze_contract_readiness", "simulate_guest_guarantee",
          ]);

          const toolResultInputs: ChatResponseInput = [];
          // 최초 사용자 메시지의 서버 생성 태그만 신뢰한다.
          const hasQuoteAnalysisTag = lastUserText.includes("[quote_analysis]");

          for (const toolCall of result.toolCalls) {
            routeSignal.throwIfAborted();
            await assertRequestStillAuthorized();
            toolsUsed.push(toolCall.name);

            // analyze_quote 방어: [quote_analysis] 태그 없이 included_items가 있으면 강제로 비움
            if (!toolCall.parseError && toolCall.name === "analyze_quote" && !hasQuoteAnalysisTag) {
              const inp = toolCall.input;
              if (Array.isArray(inp.included_items) && (inp.included_items as string[]).length > 0) {
                inp.included_items = [];
              }
            }

            send({ type: "tool_start", toolName: toolCall.name, toolInput: toolCall.input });
            const toolStartedAt = startLatencyClock();
            let idempotencyKey: string | null = null;
            let idempotencyReused = false;
            let execResult: ToolExecutionResult;

            if (toolCall.parseError) {
              execResult = {
                toolName: toolCall.name,
                toolInput: {},
                toolOutput: { error: "invalid_arguments" },
                success: false,
                displayMessage: "도구 요청 형식이 올바르지 않아 실행하지 않았습니다.",
              };
            } else if (executionContext.allowMutations === false) {
              // 비공개/첨부 턴은 읽기 전용이므로 전체 request claim만으로 충분하다.
              // 민감할 수 있는 검색 인자를 별도 tool claim 장부에 복제하지 않는다.
              execResult = await executeTool(toolCall.name, toolCall.input, executionContext);
            } else {
              const occurrenceFingerprint = createToolExecutionKey({
                userId: user.id,
                coupleId,
                clientRequestId,
                visibility,
                toolName: toolCall.name,
                toolInput: toolCall.input,
                occurrence: 0,
              });
              const occurrence = toolOccurrenceCounts.get(occurrenceFingerprint) ?? 0;
              toolOccurrenceCounts.set(occurrenceFingerprint, occurrence + 1);
              idempotencyKey = createToolExecutionKey({
                userId: user.id,
                coupleId,
                clientRequestId,
                visibility,
                toolName: toolCall.name,
                toolInput: toolCall.input,
                occurrence,
              });

              const claimBase = {
                key: idempotencyKey,
                userId: user.id,
                coupleId,
                clientRequestId,
                callId: toolCall.callId,
                toolName: toolCall.name,
                toolInput: toolCall.input,
                visibility,
              };
              const claim = await claimToolExecution(serviceClient, claimBase);
              if (claim.action === "reuse") {
                execResult = claim.result;
                idempotencyReused = true;
              } else {
                execResult = await executeTool(toolCall.name, toolCall.input, executionContext);
                await completeToolExecutionClaim(serviceClient, {
                  ...claimBase,
                  claimId: claim.claimId,
                  result: execResult,
                  latencyMs: elapsedMs(toolStartedAt),
                });
              }
            }
            toolResults.push(execResult);
            // 도구 mutation이 성공한 뒤 최종 모델 라운드가 실패해도 정확한
            // call_id·입력·결과를 남긴다. private 삭제는 visibility로 함께 redact된다.
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
                : typeof execResult.toolOutput.error === "string"
                  ? execResult.toolOutput.error
                  : "tool_execution_failed",
              metadata: {
                call_id: toolCall.callId,
                visibility,
                client_request_id: clientRequestId,
                parse_error: toolCall.parseError ?? null,
                tool_idempotency_key: idempotencyKey,
                idempotency_reused: idempotencyReused,
              },
            });

            routeSignal.throwIfAborted();
            send({ type: "tool_result", result: execResult });
            // UI 카드로 렌더링되는 도구는 텍스트 중복 방지 리마인더 추가
            const outputJson = JSON.stringify(execResult.toolOutput);
            const reminder = UI_RENDERED_TOOLS.has(toolCall.name)
              ? "\n[SYSTEM: 이 결과는 프론트엔드에서 인터랙티브 카드/버튼으로 자동 표시됩니다. 텍스트 응답에서 업체 목록, 상품 목록, 시간표, 가격표를 절대 나열하지 마세요. 간단한 안내 1~2문장만 작성하세요.]"
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
          // DB/vendor/Naver/tool 결과는 신뢰할 수 없는 입력이다. 한 번이라도 tool
          // output이 컨텍스트에 들어간 뒤에는 후속 mutation/external search를 제거한다.
          currentTools = READ_ONLY_SAFE_TOOLS;
        }

        // 최대 라운드 초과 시 도구를 비활성화하고 사용자에게 최종 텍스트만 생성한다.
        const finalResult = await chatWithToolsStream({
          systemPrompt,
          input: currentInput,
          tools: [],
          maxOutputTokens: MAX_CHAT_OUTPUT_TOKENS,
          maxInputTokens: MAX_CHAT_INPUT_TOKENS,
          beforeInputCount: assertRequestStillAuthorized,
          beforeCreate: async () => {
            await assertRequestStillAuthorized();
            await reserveProviderCallOrThrow();
          },
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

        if (suggestions.length > 0) {
          send({ type: "suggestions", suggestions });
        }

        // 서버 사이드 INSERT (MAX_TOOL_ROUNDS 초과 분기 — idempotency 포함)
        await assertRequestStillAuthorized();
        const insertResult2 = await completeAiMessage({
          isDemo,
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
              quota_class: "user_turn",
              cache_write_input_tokens: totalCacheWriteTokens,
              cache_read_input_tokens: totalCacheReadTokens,
            },
          },
        });

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
        console.error("채팅 API 에러:", errMsg);
        await markChatExecutionFailed(serviceClient, requestKey, requestHash);
        // 내부 에러 원문(모델명·스택·DB 제약 등)을 클라이언트에 노출하지 않는다.
        // 원문은 위 console.error·아래 logAIInteraction에만 남긴다.
        const clientErrorMessage = err instanceof AmoraCostGuardError
          ? err.message
          : err instanceof OpenAIInputTokenLimitError
            ? "대화나 첨부 문서가 너무 길어요. 첨부를 줄이거나 새 대화에서 다시 시도해 주세요."
          : err instanceof ToolExecutionClaimError
            ? err.code === "claim_in_progress"
              ? "같은 요청이 이미 처리 중입니다. 잠시 후 화면을 새로고침해 결과를 확인해 주세요."
              : "변경 작업의 결과를 안전하게 확인하지 못했습니다. 같은 작업을 다시 실행하지 말고 화면을 새로고침해 주세요."
          : routeSignal.aborted || normalizedErrMsg.includes("timeout") || normalizedErrMsg.includes("abort")
            ? "응답 시간이 초과되었거나 연결이 취소되었습니다."
            : "AI 응답 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.";
        send({
          type: "error",
          message: clientErrorMessage,
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
          errorMessage: errMsg,
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
            console.error("아모라 provider lease 해제 실패:", releaseError.message);
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
