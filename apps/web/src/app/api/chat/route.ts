import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildMultimodalContent,
  buildToolResultInput,
  chatWithToolsStream,
} from "@/lib/ai/openai";
import type { ChatInputItem, ImageAttachment } from "@/lib/ai/openai";
import { chooseAmoraChatModelRole } from "@/lib/ai/modelConfig";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { saveAutomaticDissatisfaction } from "@/lib/ai/automaticFeedback";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { executeTool } from "@/lib/ai/toolExecutor";
import { extractSuggestions } from "@/lib/ai/chatSuggestions";
import { detectDissatisfaction } from "@/lib/ai/dissatisfaction";
import { determineStage, routeSpecialist, getSpecialistPromptAddon } from "@/lib/ai/stage-router";
import { logAIInteraction, startLatencyClock, elapsedMs } from "@/lib/compliance/ai-log";
import { maybeSummarize } from "@/lib/ai/summarize";
import { maybeExtractDecision } from "@/lib/ai/extract-decision";
import { extractMediation } from "@/lib/ai/mediation";
import { maybeClassifyExcavation } from "@/lib/ai/classify-excavation";
import { loadAmoraProfiles, maybeUpdateAmoraProfile } from "@/lib/ai/amora-profile";
import { reserveAmoraTurn } from "@/lib/ai/costGuard";
import {
  AiMessagePersistenceError,
  findPersistedAiMessage,
  persistAiMessage,
  type PersistedAiMessage,
} from "@/lib/ai/chatMessagePersistence";
import {
  ChatRequestClaimError,
  claimChatRequest,
  completeChatRequest,
  failChatRequest,
} from "@/lib/ai/chatRequestClaim";
import { NextResponse } from "next/server";
import type { ToolExecutionResult } from "@/types/database.types";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";
import { createHash, randomUUID } from "node:crypto";
// mammoth는 필요할 때만 동적 import (Vercel 호환성)

// Vercel Pro: 최대 300초 (5분)
export const maxDuration = 300;

const MAX_TOOL_ROUNDS = 2;
// Auxiliary LLM memory jobs need a durable queue and their own budget ledger.
// Keep them off by default instead of silently losing/over-spending work after
// a serverless response has closed.
const AUXILIARY_MEMORY_ENABLED = process.env.AMORA_AUXILIARY_MEMORY_ENABLED === "true";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ATTACHMENTS = 5;
const MAX_EXTRACTED_TEXT_CHARS = 80_000;
const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;
const MAX_CONTEXT_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 20_000;
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

function getDoneMetadata(message: PersistedAiMessage): Record<string, unknown> {
  const metadata = { ...(message.metadata ?? {}) };
  delete metadata.client_request_id;
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
  const mammoth = await import("mammoth");
  const buffer = Buffer.from(base64, "base64");
  const result = await mammoth.extractRawText({ buffer });
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
  "application/msword", // doc
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

async function processAttachments(attachments: unknown[]): Promise<ProcessedAttachment> {
  const visionAttachments: ImageAttachment[] = [];
  const textAttachments: string[] = [];

  for (const att of (attachments || []).slice(0, MAX_ATTACHMENTS)) {
    const item = att as { base64?: string; url?: string; mediaType?: string; fileName?: string };
    if (!item.mediaType) continue;

    if (VISION_TYPES.includes(item.mediaType)) {
      if (item.url) {
        // Never fetch an arbitrary client URL from the server. DNS validation
        // followed by fetch is vulnerable to rebinding; clients send bounded
        // base64 or use the message-authorized signing endpoint instead.
        console.warn("Remote attachment URLs are not accepted");
      } else if (item.base64) {
        try {
          visionAttachments.push({
            base64: assertBase64UnderLimit(item.base64),
            mediaType: item.mediaType as ImageAttachment["mediaType"],
            fileName:
              item.mediaType === "application/pdf"
                ? safeFileName(item.fileName, "attachment.pdf")
                : undefined,
          });
        } catch (err) {
          console.error("base64 첨부 거부:", err);
        }
      }
    } else if (item.base64 && WORD_TYPES.includes(item.mediaType)) {
      try {
        const text = await extractDocxText(assertBase64UnderLimit(item.base64));
        if (text) {
          textAttachments.push(`[첨부문서: ${safeFileName(item.fileName, "document.docx")}]\n${limitExtractedText(text)}`);
        }
      } catch (err) {
        console.error("DOCX 파싱 에러:", err);
      }
    } else if (UNSUPPORTED_SPREADSHEET_TYPES.includes(item.mediaType)) {
      textAttachments.push(
        `[첨부스프레드시트: ${safeFileName(item.fileName, "spreadsheet.xlsx")}]\n` +
        "보안상의 이유로 Excel 파일 분석은 현재 비활성화되어 있습니다. PDF 또는 DOCX로 변환해 업로드해주세요."
      );
    }
  }

  return { visionAttachments, textAttachments };
}

export async function POST(request: Request) {
  if (isBodyTooLarge(request, MAX_REQUEST_BODY_BYTES)) {
    return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
  }
  // 인증 체크 (웹: 쿠키, 앱: Bearer 토큰)
  let body: Record<string, unknown>;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BODY_BYTES) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }
    const parsed = JSON.parse(rawBody) as unknown;
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
    requestKind: bodyRequestKind,
    visibility: bodyVisibility,
  } = body;
  const isDemo =
    bodyIsDemo === true &&
    hasSignedDemoSessionFromCookieHeader(request.headers.get("cookie"));

  // Real users authenticate with Supabase. The public demo is authorized by a
  // separate signed, HttpOnly session cookie and never receives database write access.
  const supabase = await createClientFromRequest(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isDemo) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const actorId = user?.id ?? DEMO_ACTOR_ID;
  const limited = await checkRateLimitPersistent(
    isDemo
      ? rateLimitKey("chat-demo", request)
      : rateLimitKey("chat", request, actorId),
    {
      maxRequests: 60,
      windowMs: 60 * 60 * 1000,
    },
  );
  if (limited) return limited;

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
      !conflictContext.trim() ||
      conflictContext.length > 2_000)
  ) {
    return NextResponse.json({ error: "중재 맥락 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const attachmentInput = attachments ?? body.images ?? [];
  if (!Array.isArray(attachmentInput) || attachmentInput.length > MAX_ATTACHMENTS) {
    return NextResponse.json({ error: "첨부파일 형식이 올바르지 않습니다." }, { status: 400 });
  }
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
      }
    : (
        await getServiceClient()
          .from("profiles")
          .select("couple_id, role, is_admin, name")
          .eq("id", actorId)
          .single()
      ).data;

  if (userProfile?.couple_id !== coupleId) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }
  const dataCoupleId = isDemo ? DEMO_COST_GUARD_COUPLE_ID : coupleId;
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
    requestKind === "chat" && typeof bodyUserMessageId === "string"
      ? deriveBoundRequestId(rawClientRequestId, bodyUserMessageId)
      : rawClientRequestId;
  const clientRequestId = requestKind === "initial_greeting"
    ? `greeting:${actorId}`
    : `chat:${actorId}:${durableClientRequestUuid}`;

  // A completed retry must not reserve cost, rerun the model, or replay tools.
  if (!isDemo) {
    try {
      const existing = await findPersistedAiMessage({
        coupleId,
        clientRequestId,
        visibility,
      });
      if (existing) return replayPersistedMessage(existing);
    } catch (error) {
      console.warn("[chat] completed-request replay lookup failed", error);
    }
  }

  const claimParams = {
    coupleId,
    requestKey: clientRequestId,
    userId: actorId,
    visibility,
  } as const;
  let requestClaimAcquired = false;

  if (!isDemo) {
    try {
      const claim = await claimChatRequest(claimParams);
      if (claim.action === "completed") {
        const completed = await findPersistedAiMessage({
          coupleId,
          clientRequestId,
          visibility,
        });
        if (completed?.id === claim.messageId) return replayPersistedMessage(completed);
        return NextResponse.json(
          { error: "저장된 답변을 확인하지 못했습니다.", code: "CHAT_REPLAY_INCONSISTENT" },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
      if (claim.action === "in_progress") {
        return NextResponse.json(
          {
            error: "같은 답변을 아직 만들고 있어요. 잠시 후 다시 확인해주세요.",
            code: "CHAT_REQUEST_IN_PROGRESS",
            retryAfterMs: claim.retryAfterMs,
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
          { error: "요청 식별자가 다른 대화와 충돌했습니다.", code: "CHAT_REQUEST_CONFLICT" },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
      requestClaimAcquired = true;
    } catch (error) {
      console.error("[chat] durable request claim failed", error);
      return NextResponse.json(
        { error: "대화를 안전하게 시작하지 못했습니다. 잠시 후 다시 시도해주세요.", code: "CHAT_REQUEST_CLAIM_FAILED" },
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
  };

  // 첨부파일 처리
  const { visionAttachments, textAttachments } = await processAttachments(attachmentInput);

  // 병렬로 커플 관련 데이터 전체 조회
  const [
    journeyResult,
    profilesResult,
    bookingsResult,
    summariesResult,
    decisionsResult,
    conflictsResult,
    messagesResult,
    amoraProfiles,
  ] = await Promise.all([
    // 1. 웨딩 저니
    supabase.from("wedding_journeys").select("*").eq("couple_id", dataCoupleId).single(),
    // 2. 커플 프로필 (신부/신랑 이름, 역할)
    supabase
      .from("couple_profile_directory")
      .select("name, role")
      .eq("couple_id", dataCoupleId),
    // 3. 예약 내역 (취소 제외)
    supabase.from("vendor_bookings")
      .select("id, vendor_id, booking_date, booking_time, status, amount, contracted_amount, actual_amount, memo, vendors(name, category)")
      .eq("couple_id", dataCoupleId)
      .neq("status", "cancelled")
      .order("booking_date", { ascending: true }),
    // 4. 대화 요약 (최근 3개) — visibility 격리 (2026-05-04)
    //    shared turn → shared summary만 / private turn → shared + 본인 visibility
    (() => {
      const q = supabase.from("chat_summaries")
        .select("summary, created_at, message_count, to_message_id")
        .eq("couple_id", dataCoupleId)
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
      .eq("couple_id", dataCoupleId)
      .order("created_at", { ascending: false })
      .limit(50),
    // 6. Mediation 강화: 갈등→합의 히스토리 (최근 5개) — visibility 격리용으로 컬럼도 select
    supabase.from("decision_nodes")
      .select("title, chosen_value, reasoning, stage_tag, visibility, created_at")
      .eq("couple_id", dataCoupleId)
      .eq("category", "conflict_resolution")
      .order("created_at", { ascending: false })
      .limit(5),
    // 7. canonical 대화 컨텍스트. 클라이언트가 보낸 assistant/history는
    // prompt source로 신뢰하지 않으며 사용자 RLS를 한 번 더 적용한다.
    (() => {
      const q = supabase
        .from("chat_messages")
        .select("id, sender_id, sender_type, role, content, metadata, visibility, created_at")
        .eq("couple_id", dataCoupleId)
        // 상대에게 직접 보낸 메시지는 커플이 공유해서 보는 데이터여도
        // Amora/OpenAI 입력은 아니다. DB에서 먼저 제외하고 아래에서 한 번 더
        // 걸러 PostgREST 필터 회귀가 생겨도 provider 경계를 넘지 않게 한다.
        .or("metadata->>target.is.null,metadata->>target.neq.partner")
        .order("created_at", { ascending: false })
        .limit(MAX_CONTEXT_MESSAGES);
      return visibility === "shared"
        ? q.eq("visibility", "shared")
        : q.in("visibility", ["shared", visibility]);
    })(),
    // 8. 아모라 장기 개인화 프로필 (shared + 본인 private만)
    loadAmoraProfiles(dataCoupleId, visibility),
  ]);

  const journey = journeyResult.data;
  if (!isDemo && journeyResult.error) {
    console.error("Journey 조회 에러:", journeyResult.error.message);
  }

  // 프로필에서 신부/신랑 이름 추출
  const profiles = profilesResult.data ?? [];
  const brideName = profiles.find((p) => p.role === "bride")?.name ?? null;
  const groomName = profiles.find((p) => p.role === "groom")?.name ?? null;

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
  const progress = journey?.progress ?? weddingContext?.progress ?? {};
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

  type CanonicalChatRow = {
    id: string;
    sender_id: string | null;
    sender_type: "bride" | "groom" | "ai";
    role: "user" | "assistant";
    content: string;
    metadata: { target?: string } | null;
    visibility: "shared" | "bride_private" | "groom_private";
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

  let canonicalRows = ((messagesResult.data ?? []) as CanonicalChatRow[])
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
    canonicalRows = canonicalRows.slice(0, requestedIndex + 1);
    isDurableUserMessageBound = true;
  }

  const canonicalMessages = canonicalRows.map((row) => {
    if (row.sender_type === "ai" || row.role === "assistant") {
      return { role: "assistant" as const, content: row.content, id: row.id };
    }
    const roleLabel = row.sender_type === "bride" ? "신부" : "신랑";
    const targetLabel = row.metadata?.target === "partner" ? "→상대방" : "";
    return {
      role: "user" as const,
      content: `[${roleLabel}${targetLabel}] ${row.content}`,
      id: row.id,
    };
  });

  // Signed demo만 DB가 없으므로 client history를 사용한다. 실제 사용자 턴은
  // canonical DB history만 prompt source로 허용한다.
  let typedMessages: Array<{ role: "user" | "assistant"; content: string; id?: string }> =
    isDemo
      ? (messages as Array<{ role: "user" | "assistant"; content: string; id?: string }>)
      : canonicalMessages;
  let lastUserText: string;

  if (requestKind === "initial_greeting") {
    const roleLabel =
      userProfile.role === "groom"
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
    const roleLabel =
      userProfile.role === "groom"
        ? "신랑"
        : userProfile.role === "bride"
          ? "신부"
          : "사용자";
    lastUserText = `[MEDIATION_REQUEST] ${String(conflictContext).trim()}`;
    typedMessages = [
      ...typedMessages,
      {
        role: "user",
        content: `[${roleLabel}] [MEDIATION_REQUEST] 커플 대화의 의견 차이를 중립적으로 중재해주세요. 최근 맥락: ${String(conflictContext).trim()}`,
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

  // Reserve cost only after canonical history/authz/idempotent replay checks.
  const costGuard = await reserveAmoraTurn(getServiceClient(), {
    coupleId: dataCoupleId,
    isAdmin: userProfile?.is_admin === true,
  });
  if (!costGuard.allowed) {
    await releaseClaimBeforeStream("COST_GUARD_REJECTED");
    return NextResponse.json({ error: costGuard.message }, { status: 429 });
  }

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
  if (!isDemo && dissatisfaction?.detected) {
    autoSaveDissatisfaction({
      userId: actorId,
      coupleId,
      signal: dissatisfaction.signal,
      visibility,
    });
  }

  // Part 3: 세션 내 2회 이상 수정 시 신중 모드 프리픽스
  const cautionPrefix = correctionCount >= 2
    ? "[CONTEXT: 이 세션에서 사용자가 2번 이상 수정했습니다. 더 신중하게, 확인하며 답변하세요.]\n\n"
    : "";

  // D3: stage + specialist 계산
  const weddingDateForStage = journey?.wedding_date ?? weddingContext?.weddingDate ?? null;
  const stageTag = determineStage(weddingDateForStage);
  const specialistType = routeSpecialist(lastUserText, stageTag);
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
    budget: journey?.total_budget ?? weddingContext?.budget ?? 0,
    venue: journey?.venue ?? weddingContext?.venue ?? null,
    progress,
    brideName,
    groomName,
    senderName: safeSenderName,
    bookings,
    scheduleEvents,
    chatSummaries,
    preferences: preferences ?? undefined,
    amoraProfiles,
    pastDecisions,
    pastConflicts,
  }) + specialistAddon;

  // 메시지 포맷팅
  const formattedMessages: ChatInputItem[] = typedMessages.map(
    (m: { role: string; content: string }, index: number) => {
      const role = m.role === "assistant" ? ("assistant" as const) : ("user" as const);
      const isLastUserMessage = role === "user" && index === typedMessages.length - 1;

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
          } as ChatInputItem;
        }

        return { role, content: enrichedText } as ChatInputItem;
      }

      return { role, content: m.content } as ChatInputItem;
    }
  );

  const modelRole =
    requestKind === "mediation"
      ? ("primary" as const)
      : chooseAmoraChatModelRole({
          specialistType,
          userText: lastUserText,
          correctionCount,
        });
  // Old deployed clients do not send userMessageId. They remain answer-compatible,
  // but may not execute a mutation because the intent is not bound to one DB row.
  const availableTools =
    requestKind === "chat" && isDurableUserMessageBound ? BETA_SAFE_TOOLS : [];

  const executionContext = {
    coupleId,
    requestKey: clientRequestId,
    currentUserText: lastUserText,
    weddingContext: {
      weddingDate: journey?.wedding_date ?? weddingContext?.weddingDate ?? null,
      budget: journey?.total_budget ?? weddingContext?.budget ?? 0,
      venue: journey?.venue ?? weddingContext?.venue ?? null,
      progress: journey?.progress ?? weddingContext?.progress ?? {},
    },
  };

  // SSE 스트림 응답 생성
  const encoder = new TextEncoder();
  const turnAbortController = new AbortController();
  let toolExecutionCompleted = false;
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

      // 쿼터 소진 예고 — 절벽(갑작스런 429)을 예고된 언덕으로.
      // 잔여가 임계 이하일 때만 이벤트를 보내 클라가 배너로 안내한다.
      if (typeof costGuard.remaining === "number" && costGuard.remaining <= 15) {
        send({ type: "quota", remaining: costGuard.remaining });
      }

      // D1: 로깅 집계 버퍼 (한 turn = 1 row)
      const turnStartedAt = startLatencyClock();
      let totalTokensIn = 0;
      let totalTokensOut = 0;
      // Prompt caching: cache_write / cache_read 토큰도 별도 집계 — 비용 정확 계산용
      let totalCacheCreationTokens = 0;
      let totalCacheReadTokens = 0;
      let lastModel: string | undefined;

      try {
        let currentMessages = [...formattedMessages];
        const toolResults: ToolExecutionResult[] = [];
        const toolsUsed: string[] = [];

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          // 실시간 스트리밍: 모든 라운드에서 텍스트 토큰을 즉시 클라이언트로 전송
          // tool_use가 발견되면 text_clear로 리셋 후 도구 실행
          const result = await chatWithToolsStream({
            systemPrompt,
            input: currentMessages,
            tools: availableTools,
            onTextDelta: (token) => {
              send({ type: "text_delta", content: token });
            },
            modelRole,
            safetyIdentifierScope: actorId,
            signal: toolExecutionCompleted ? undefined : turnAbortController.signal,
          });

          // 라운드별 토큰/모델 집계
          if (result.usage) {
            totalTokensIn += result.usage.input_tokens ?? 0;
            totalTokensOut += result.usage.output_tokens ?? 0;
            totalCacheCreationTokens += result.usage.cache_write_input_tokens ?? 0;
            totalCacheReadTokens += result.usage.cache_read_input_tokens ?? 0;
          }
          if (result.model) lastModel = result.model;

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
            const insertResult = await persistAiMessage({
              isDemo,
              coupleId,
              cleanText,
              clientRequestId,
              metadata: {
                toolResults,
                toolsUsed,
                senderName: safeSenderName,
                ...(visibleClientRequestKey !== clientRequestId
                  ? { client_visible_request_id: visibleClientRequestKey }
                  : {}),
                ...(suggestions.length > 0 ? { suggestions } : {}),
                ...(mediation ? { mediation } : {}),
              },
              stageTag,
              specialistType,
              visibility,
            });
            if (!isDemo) {
              if (!insertResult.id) {
                throw new AiMessagePersistenceError("Persisted AI message id was missing");
              }
              await completeChatRequest({
                ...claimParams,
                messageId: insertResult.id,
              });
              requestClaimAcquired = false;
            }
            if (insertResult.reused) {
              send({ type: "text_clear" });
              const storedSuggestions = getStoredSuggestions(insertResult);
              if (storedSuggestions.length > 0) {
                send({ type: "suggestions", suggestions: storedSuggestions });
              }
            }

            send({
              type: "done",
              fullContent: insertResult.content ?? cleanText,
              metadata: getDoneMetadata(insertResult),
            });

            if (insertResult.reused) {
              clearInterval(heartbeat);
              controller.close();
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
              model: lastModel,
              tokensInput: totalTokensIn || null,
              tokensOutput: totalTokensOut || null,
              cacheCreationTokens: totalCacheCreationTokens || null,
              cacheReadTokens: totalCacheReadTokens || null,
              metadata: {
                stage_tag: stageTag,
                tools_used: toolsUsed,
                tool_rounds: round + 1,
                correction_count: correctionCount,
                request_key: clientRequestId,
                user_message_id: typeof bodyUserMessageId === "string" ? bodyUserMessageId : null,
                user_input_sha256: createHash("sha256").update(lastUserText).digest("hex"),
                ai_output_sha256: createHash("sha256").update(cleanText).digest("hex"),
              },
            });

            // Memory Step A: 10 메시지+ 누적 시 요약 생성 (fire-and-forget)
            const messagesWithLatest = [
              ...typedMessages.map((m) => ({ role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant", content: m.content, id: m.id })),
              { role: "assistant" as const, content: cleanText },
            ];
            if (!isDemo && AUXILIARY_MEMORY_ENABLED) void maybeSummarize({
              coupleId,
              userId: actorId,
              messages: messagesWithLatest,
              lastCoveredCount,
              lastToMessageId,
              visibility,
            });

            // Memory Step B: 이번 턴 decision/preference 추출 (fire-and-forget)
            if (!isDemo && AUXILIARY_MEMORY_ENABLED) void maybeExtractDecision({
              coupleId,
              userId: actorId,
              messages: messagesWithLatest,
              stageTag,
              lastUserText,
              visibility,
            });

            // Excavation 기법 사용 분류 (fire-and-forget)
            if (!isDemo && AUXILIARY_MEMORY_ENABLED) void maybeClassifyExcavation({
              coupleId,
              userId: actorId,
              lastUserText,
              aiResponseText: cleanText,
              stageTag,
            });

            // 아모라 장기 개인화 프로필 갱신 (fire-and-forget)
            if (!isDemo && AUXILIARY_MEMORY_ENABLED) void maybeUpdateAmoraProfile({
              coupleId,
              userId: actorId,
              visibility,
              messages: messagesWithLatest,
              lastUserText,
              aiResponseText: cleanText,
              currentProfile: visibility === "shared" ? amoraProfiles.shared : amoraProfiles.private,
              stageTag,
              isDemo,
            });

            clearInterval(heartbeat);
            controller.close();
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

          const toolResultInputs: ChatInputItem[] = [];
          // 유저가 보낸 canonical 마지막 메시지만 신뢰한다. Provider가 생성한
          // output item을 다시 훑어 태그 권한을 추론하지 않는다.
          const hasQuoteAnalysisTag = lastUserText.includes("[quote_analysis]");

          for (const toolUse of result.toolCalls) {
            if (!toolExecutionCompleted && turnAbortController.signal.aborted) {
              throw new DOMException("Chat request aborted before tool execution", "AbortError");
            }

            if (toolUse.parseError) {
              const invalidResult = JSON.stringify({
                success: false,
                error_code: "INVALID_TOOL_INPUT",
                error: "도구 입력 형식이 올바르지 않습니다. 정의된 스키마에 맞게 다시 시도하세요.",
              });
              send({
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

            toolsUsed.push(toolUse.name);

            // analyze_quote 방어: [quote_analysis] 태그 없이 included_items가 있으면 강제로 비움
            if (toolUse.name === "analyze_quote" && !hasQuoteAnalysisTag) {
              const inp = toolUse.input as Record<string, unknown>;
              if (Array.isArray(inp.included_items) && (inp.included_items as string[]).length > 0) {
                inp.included_items = [];
              }
            }

            send({ type: "tool_start", toolName: toolUse.name, toolInput: toolUse.input });
            const execResult = await executeTool(toolUse.name, toolUse.input, executionContext);
            // Once a tool has returned, finish and persist this claimed turn even
            // if the client disconnects. Retrying a mutating tool is less safe.
            toolExecutionCompleted = true;
            toolResults.push(execResult);
            send({ type: "tool_result", result: execResult });
            // UI 카드로 렌더링되는 도구는 텍스트 중복 방지 리마인더 추가
            const outputJson = JSON.stringify(execResult.toolOutput);
            const reminder = UI_RENDERED_TOOLS.has(toolUse.name)
              ? "\n[SYSTEM: 이 결과는 프론트엔드에서 인터랙티브 카드/버튼으로 자동 표시됩니다. 텍스트 응답에서 업체 목록, 상품 목록, 시간표, 가격표를 절대 나열하지 마세요. 간단한 안내 1~2문장만 작성하세요.]"
              : "";
            toolResultInputs.push(
              buildToolResultInput(toolUse.callId, outputJson + reminder)
            );
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
        const finalResult = await chatWithToolsStream({
          systemPrompt,
          input: currentMessages,
          // MAX_TOOL_ROUNDS 이후에는 새 mutation 요청을 받지 않고 기존 결과를
          // 사용자용 문장으로 정리하게 한다.
          tools: [],
          onTextDelta: (token) => {
            send({ type: "text_delta", content: token });
          },
          modelRole,
          safetyIdentifierScope: actorId,
          signal: toolExecutionCompleted ? undefined : turnAbortController.signal,
        });

        // 마지막 호출 토큰/모델 집계
        if (finalResult.usage) {
          totalTokensIn += finalResult.usage.input_tokens ?? 0;
          totalTokensOut += finalResult.usage.output_tokens ?? 0;
          totalCacheCreationTokens += finalResult.usage.cache_write_input_tokens ?? 0;
          totalCacheReadTokens += finalResult.usage.cache_read_input_tokens ?? 0;
        }
        if (finalResult.model) lastModel = finalResult.model;

        const { cleanText: afterSuggest2, suggestions } = extractSuggestions(
          finalResult.fullText
        );
        const { cleanText, mediation } = extractMediation(afterSuggest2);

        if (suggestions.length > 0) {
          send({ type: "suggestions", suggestions });
        }

        // 서버 사이드 INSERT (MAX_TOOL_ROUNDS 초과 분기 — idempotency 포함)
        const insertResult2 = await persistAiMessage({
          isDemo,
          coupleId,
          cleanText,
          clientRequestId,
          metadata: {
            toolResults,
            toolsUsed,
            senderName: safeSenderName,
            ...(visibleClientRequestKey !== clientRequestId
              ? { client_visible_request_id: visibleClientRequestKey }
              : {}),
            ...(suggestions.length > 0 ? { suggestions } : {}),
            ...(mediation ? { mediation } : {}),
          },
          stageTag,
          specialistType,
          visibility,
        });
        if (!isDemo) {
          if (!insertResult2.id) {
            throw new AiMessagePersistenceError("Persisted AI message id was missing");
          }
          await completeChatRequest({
            ...claimParams,
            messageId: insertResult2.id,
          });
          requestClaimAcquired = false;
        }

        if (insertResult2.reused) {
          send({ type: "text_clear" });
          const storedSuggestions = getStoredSuggestions(insertResult2);
          if (storedSuggestions.length > 0) {
            send({ type: "suggestions", suggestions: storedSuggestions });
          }
        }

        send({
          type: "done",
          fullContent: insertResult2.content ?? cleanText,
          metadata: getDoneMetadata(insertResult2),
        });

        if (insertResult2.reused) {
          clearInterval(heartbeat);
          controller.close();
          return;
        }

        // Memory Step A + B: 요약 생성 + decision/preference 추출 (fire-and-forget)
        const messagesWithLatest = [
          ...typedMessages.map((m) => ({ role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant", content: m.content, id: m.id })),
          { role: "assistant" as const, content: cleanText },
        ];
        if (!isDemo && AUXILIARY_MEMORY_ENABLED) void maybeSummarize({
          coupleId,
          userId: actorId,
          messages: messagesWithLatest,
          lastCoveredCount,
          lastToMessageId,
          visibility,
        });
        if (!isDemo && AUXILIARY_MEMORY_ENABLED) void maybeExtractDecision({
          coupleId,
          userId: actorId,
          messages: messagesWithLatest,
          stageTag,
          lastUserText,
          visibility,
        });
        if (!isDemo && AUXILIARY_MEMORY_ENABLED) void maybeClassifyExcavation({
          coupleId,
          userId: actorId,
          lastUserText,
          aiResponseText: cleanText,
          stageTag,
        });

        // 아모라 장기 개인화 프로필 갱신 (fire-and-forget)
        if (!isDemo && AUXILIARY_MEMORY_ENABLED) void maybeUpdateAmoraProfile({
          coupleId,
          userId: actorId,
          visibility,
          messages: messagesWithLatest,
          lastUserText,
          aiResponseText: cleanText,
          currentProfile: visibility === "shared" ? amoraProfiles.shared : amoraProfiles.private,
          stageTag,
          isDemo,
        });

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
          model: lastModel,
          tokensInput: totalTokensIn || null,
          tokensOutput: totalTokensOut || null,
          cacheCreationTokens: totalCacheCreationTokens || null,
          cacheReadTokens: totalCacheReadTokens || null,
          metadata: {
            stage_tag: stageTag,
            tools_used: toolsUsed,
            tool_rounds: MAX_TOOL_ROUNDS,
            exceeded_max_rounds: true,
            correction_count: correctionCount,
            request_key: clientRequestId,
            user_message_id: typeof bodyUserMessageId === "string" ? bodyUserMessageId : null,
            user_input_sha256: createHash("sha256").update(lastUserText).digest("hex"),
            ai_output_sha256: createHash("sha256").update(cleanText).digest("hex"),
          },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("채팅 API 에러:", errMsg);
        if (requestClaimAcquired) {
          await failChatRequest({
            ...claimParams,
            failureCode:
              err instanceof AiMessagePersistenceError
                ? err.code
                : err instanceof ChatRequestClaimError
                  ? err.code
                  : "CHAT_TURN_FAILED",
          }).catch((claimError) => {
            console.error("[chat] durable request failure marker failed", claimError);
          });
          requestClaimAcquired = false;
        }
        // 내부 에러 원문(모델명·스택·DB 제약 등)을 클라이언트에 노출하지 않는다.
        // 원문은 위 console.error·아래 logAIInteraction에만 남긴다.
        send({
          type: "error",
          code:
            err instanceof AiMessagePersistenceError || err instanceof ChatRequestClaimError
              ? err.code
              : undefined,
          message: err instanceof AiMessagePersistenceError || err instanceof ChatRequestClaimError
            ? "답변 저장을 완료하지 못했어요. 같은 요청으로 다시 시도해주세요."
            : errMsg.includes("timeout") || errMsg.includes("abort")
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
          errorMessage: errMsg,
          model: lastModel,
          tokensInput: totalTokensIn || null,
          tokensOutput: totalTokensOut || null,
          cacheCreationTokens: totalCacheCreationTokens || null,
          cacheReadTokens: totalCacheReadTokens || null,
          metadata: {
            stage_tag: stageTag,
            request_key: clientRequestId,
            user_message_id: typeof bodyUserMessageId === "string" ? bodyUserMessageId : null,
            user_input_sha256: createHash("sha256").update(lastUserText).digest("hex"),
          },
        });
      }

      clearInterval(heartbeat);
      controller.close();
    },
    cancel() {
      abortBeforeDurableTool();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
