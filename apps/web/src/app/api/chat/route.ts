import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { chatWithToolsStream, buildToolResultContent, buildMultimodalContent } from "@/lib/ai/claude";
import type { ImageAttachment } from "@/lib/ai/claude";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { loadFeedbackLessons } from "@/lib/ai/feedbackLessons";
import { WEDDING_TOOLS } from "@/lib/ai/tools";
import { executeTool } from "@/lib/ai/toolExecutor";
import { determineStage, routeSpecialist, getSpecialistPromptAddon } from "@/lib/ai/stage-router";
import { logAIInteraction, startLatencyClock, elapsedMs } from "@/lib/compliance/ai-log";
import { maybeSummarize } from "@/lib/ai/summarize";
import { maybeExtractDecision } from "@/lib/ai/extract-decision";
import { maybeClassifyExcavation } from "@/lib/ai/classify-excavation";
import { NextResponse } from "next/server";
import type { MessageParam, ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutionResult } from "@/types/database.types";
// mammoth, xlsx는 필요할 때만 동적 import (Vercel 호환성)

// Vercel Pro: 최대 300초 (5분)
export const maxDuration = 300;

const MAX_TOOL_ROUNDS = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Service role 클라이언트 (RLS 우회 — 자동 피드백 저장용)
function getServiceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// AI 메시지를 chat_messages에 INSERT — client_request_id 기반 idempotency
// 모바일 retry / 중복 fetch 시 동일 클라이언트 요청 ID 사용.
// UNIQUE INDEX (couple_id, metadata->>'client_request_id') 가 race도 막아줌.
// 중복 INSERT는 unique violation 발생 → catch 후 SELECT로 기존 row 반환.
async function insertAiMessageWithIdempotency(params: {
  isDemo: boolean;
  coupleId: string;
  cleanText: string;
  clientRequestId: string | null;
  metadata: Record<string, unknown>;
  stageTag: string | null;
  specialistType: string | null;
  visibility: "shared" | "bride_private" | "groom_private";
}): Promise<{ id: string | null; createdAt: string | null }> {
  if (params.isDemo || !params.cleanText) {
    return { id: null, createdAt: null };
  }
  const admin = getServiceClient();

  // client_request_id를 metadata에 포함하여 UNIQUE INDEX가 작동하게 함
  const metadataWithRid = params.clientRequestId
    ? { ...params.metadata, client_request_id: params.clientRequestId }
    : params.metadata;

  // 1) clientRequestId 있으면 먼저 조회 (race 전 빠른 path)
  if (params.clientRequestId) {
    try {
      const { data: existing } = await admin
        .from("chat_messages")
        .select("id, created_at")
        .eq("couple_id", params.coupleId)
        .eq("metadata->>client_request_id", params.clientRequestId)
        .limit(1);
      if (existing && existing.length > 0) {
        return {
          id: existing[0].id as string,
          createdAt: existing[0].created_at as string,
        };
      }
    } catch {
      // SELECT 실패는 무시 — 아래 INSERT 시도로 진행
    }
  }

  // 2) INSERT 시도
  try {
    const { data: inserted, error: insertErr } = await admin
      .from("chat_messages")
      .insert({
        couple_id: params.coupleId,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: params.cleanText,
        metadata: metadataWithRid,
        stage_tag: params.stageTag,
        specialist_type: params.specialistType,
        visibility: params.visibility,
      })
      .select("id, created_at")
      .single();

    if (inserted) {
      return {
        id: inserted.id as string,
        createdAt: inserted.created_at as string,
      };
    }

    // 3) UNIQUE 충돌 — race로 다른 요청이 먼저 INSERT 했음. 그 row를 가져옴.
    if (insertErr && (insertErr.code === "23505" || /duplicate|unique/i.test(insertErr.message)) && params.clientRequestId) {
      const { data: conflicted } = await admin
        .from("chat_messages")
        .select("id, created_at")
        .eq("couple_id", params.coupleId)
        .eq("metadata->>client_request_id", params.clientRequestId)
        .limit(1);
      if (conflicted && conflicted.length > 0) {
        return {
          id: conflicted[0].id as string,
          createdAt: conflicted[0].created_at as string,
        };
      }
    }

    console.error("AI 메시지 서버 INSERT 실패:", insertErr);
    return { id: null, createdAt: null };
  } catch (err) {
    console.error("AI 메시지 서버 INSERT 예외:", err);
    return { id: null, createdAt: null };
  }
}

// --- Part 2: 불만족 자동 감지 ---
interface DissatisfactionResult {
  detected: boolean;
  signal: string;
}

function detectDissatisfaction(
  userMessage: string,
  previousAiMessage?: string
): DissatisfactionResult | null {
  const msg = userMessage.trim();

  // 수정 시그널: "아니", "아닌데", "그게 아니라", "아 그게 아니고"
  if (/^아니[요.]?$|아닌데|그게\s*아니라|아\s*그게\s*아니고|아니거든/.test(msg)) {
    return { detected: true, signal: "correction" };
  }

  // 재시도 시그널: "다시", "다시 해줘", "다시 말해줘"
  if (/다시\s*(해|말해|알려|설명|해줘|해봐|말해줘)/.test(msg) || /^다시$/.test(msg)) {
    return { detected: true, signal: "retry" };
  }

  // 좌절 시그널: "이해를 못하네", "말을 못 알아듣네"
  if (/이해를?\s*못\s*(하|알아듣)|말을?\s*못\s*알아듣|알아듣지?\s*못/.test(msg)) {
    return { detected: true, signal: "frustration" };
  }

  // 부정 시그널: "쓸모없", "도움이 안", "별로"
  if (/쓸모\s*없|도움이?\s*안\s*(되|됨|돼)|별로|소용\s*없/.test(msg)) {
    return { detected: true, signal: "negative" };
  }

  // 혼란 시그널: 이전 AI 응답이 길었는데(100자+) 사용자가 "?"만 보낸 경우
  if (msg === "?" && previousAiMessage && previousAiMessage.length > 100) {
    return { detected: true, signal: "confusion" };
  }

  // 이탈 시그널: AI가 상세 답변(200자+) 했는데 매우 짧은 응답("ㅇㅇ", "ㅋ", "아" 등)
  const shortDisengagePatterns = /^(ㅇㅇ|ㅋ+|ㅎ+|아|응|넵|네|음|흠|그래|ok|ㅇ|아하)$/i;
  if (
    shortDisengagePatterns.test(msg) &&
    previousAiMessage &&
    previousAiMessage.length > 200
  ) {
    return { detected: true, signal: "disengagement" };
  }

  return null;
}

// 자동 피드백 저장 (비동기, 에러 무시 — 채팅 흐름 방해 금지)
async function autoSaveDissatisfaction(params: {
  userId: string;
  coupleId: string;
  signal: string;
  userMessage: string;
  previousAiMessageId?: string;
}) {
  try {
    const admin = getServiceClient();
    await admin.from("chat_feedback").insert({
      user_id: params.userId,
      couple_id: params.coupleId,
      message_id: params.previousAiMessageId || null,
      rating: "bad",
      category: params.signal,
      correction: params.userMessage,
      message_content: null,
    });
  } catch (err) {
    console.error("자동 불만족 피드백 저장 실패 (무시됨):", err);
  }
}

// Claude 응답에서 [suggestions] 블록 추출 (백틱 있든 없든 모두 처리)
function extractSuggestions(text: string): { cleanText: string; suggestions: string[] } {
  const patterns = [
    /```\n?\[suggestions\]\n([\s\S]*?)\[\/suggestions\]\n?```/,
    /\[suggestions\]\n([\s\S]*?)\[\/suggestions\]/,
  ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (match) {
      const suggestions = match[1]
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const cleanText = text.replace(regex, "").trim();
      return { cleanText, suggestions };
    }
  }

  return { cleanText: text, suggestions: [] };
}

// DOCX에서 텍스트 추출 (동적 import)
async function extractDocxText(base64: string): Promise<string> {
  const mammoth = await import("mammoth");
  const buffer = Buffer.from(base64, "base64");
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

// XLSX에서 텍스트 추출 (동적 import)
async function extractXlsxText(base64: string): Promise<string> {
  const XLSX = await import("xlsx");
  const buffer = Buffer.from(base64, "base64");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheets: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) {
      sheets.push(`[시트: ${sheetName}]\n${csv}`);
    }
  }

  return sheets.join("\n\n");
}

// 첨부파일 처리: Claude에 보낼 형태로 변환
interface ProcessedAttachment {
  visionAttachments: ImageAttachment[]; // 이미지/PDF → Claude vision/document
  textAttachments: string[]; // DOCX/XLSX → 추출된 텍스트
}

const VISION_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
const DOC_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/msword", // doc
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.ms-excel", // xls
];

async function processAttachments(attachments: unknown[]): Promise<ProcessedAttachment> {
  const visionAttachments: ImageAttachment[] = [];
  const textAttachments: string[] = [];

  for (const att of (attachments || []).slice(0, 5)) {
    const item = att as { base64?: string; url?: string; mediaType?: string; fileName?: string };
    if (!item.mediaType) continue;

    if (VISION_TYPES.includes(item.mediaType)) {
      if (item.url) {
        // URL 기반: 서버에서 fetch → base64 변환
        try {
          const imgRes = await fetch(item.url);
          if (imgRes.ok) {
            const buffer = Buffer.from(await imgRes.arrayBuffer());
            visionAttachments.push({
              base64: buffer.toString("base64"),
              mediaType: item.mediaType as ImageAttachment["mediaType"],
            });
          }
        } catch (err) {
          console.error("이미지 다운로드 에러:", err);
        }
      } else if (item.base64) {
        // base64 직접 전달 (호환)
        visionAttachments.push({
          base64: item.base64,
          mediaType: item.mediaType as ImageAttachment["mediaType"],
        });
      }
    } else if (item.base64 && (item.mediaType.includes("wordprocessingml") || item.mediaType === "application/msword")) {
      try {
        const text = await extractDocxText(item.base64);
        if (text) {
          textAttachments.push(`[첨부문서: ${item.fileName || "document.docx"}]\n${text}`);
        }
      } catch (err) {
        console.error("DOCX 파싱 에러:", err);
      }
    } else if (item.base64 && (item.mediaType.includes("spreadsheetml") || item.mediaType.includes("ms-excel"))) {
      try {
        const text = await extractXlsxText(item.base64);
        if (text) {
          textAttachments.push(`[첨부스프레드시트: ${item.fileName || "spreadsheet.xlsx"}]\n${text}`);
        }
      } catch (err) {
        console.error("XLSX 파싱 에러:", err);
      }
    }
  }

  return { visionAttachments, textAttachments };
}

export async function POST(request: Request) {
  // 인증 체크 (웹: 쿠키, 앱: Bearer 토큰)
  const supabase = await createClientFromRequest(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { messages, coupleId, senderName, weddingContext, attachments, isDemo: bodyIsDemo, clientRequestId: bodyClientRequestId, visibility: bodyVisibility } = body;
  const isDemo = bodyIsDemo === true;
  const clientRequestId: string | null = typeof bodyClientRequestId === "string" && bodyClientRequestId.length > 0
    ? bodyClientRequestId
    : null;
  const visibility: "shared" | "bride_private" | "groom_private" =
    bodyVisibility === "bride_private" || bodyVisibility === "groom_private" ? bodyVisibility : "shared";

  if (!messages || !coupleId) {
    return NextResponse.json(
      { error: "메시지와 커플 ID가 필요합니다." },
      { status: 400 }
    );
  }

  // coupleId 소유 검증: 해당 커플에 속하는 사용자인지 확인
  const { data: userProfile } = await supabase
    .from("profiles")
    .select("couple_id")
    .eq("id", user.id)
    .single();

  if (userProfile?.couple_id !== coupleId) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  // 첨부파일 처리
  const { visionAttachments, textAttachments } = await processAttachments(attachments || body.images || []);

  // 병렬로 커플 관련 데이터 전체 조회
  const [journeyResult, profilesResult, bookingsResult, summariesResult, decisionsResult, conflictsResult, feedbackLessons] = await Promise.all([
    // 1. 웨딩 저니
    supabase.from("wedding_journeys").select("*").eq("couple_id", coupleId).single(),
    // 2. 커플 프로필 (신부/신랑 이름, 역할)
    supabase.from("profiles").select("name, role").eq("couple_id", coupleId),
    // 3. 예약 내역 (취소 제외)
    supabase.from("vendor_bookings")
      .select("id, vendor_id, booking_date, booking_time, status, amount, memo, vendors(name, category)")
      .eq("couple_id", coupleId)
      .neq("status", "cancelled")
      .order("booking_date", { ascending: true }),
    // 4. 대화 요약 (최근 3개) — message_count + to_message_id도 함께 (Memory Step A trigger용)
    supabase.from("chat_summaries")
      .select("summary, created_at, message_count, to_message_id")
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: false })
      .limit(3),
    // 5. Memory Step C: 의사결정 히스토리 (최근 50개, AI 추출 + manual/booking/onboarding 포함)
    //    "6개월 전 결정도 기억" 마케팅 약속 실현 — 활성 사용자도 충분히 소화.
    //    RLS가 visibility 자동 필터: 본인 private + shared만 SELECT 됨. 파트너 private은 안 옴.
    supabase.from("decision_nodes")
      .select("category, decision_type, title, chosen_value, reasoning, confidence, stage_tag, source, visibility, created_at")
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: false })
      .limit(50),
    // 6. Mediation 강화: 갈등→합의 히스토리 (최근 5개)
    supabase.from("decision_nodes")
      .select("title, chosen_value, reasoning, stage_tag, created_at")
      .eq("couple_id", coupleId)
      .eq("category", "conflict_resolution")
      .order("created_at", { ascending: false })
      .limit(5),
    // 7. 피드백 학습 내용 (AI 품질 개선용)
    loadFeedbackLessons(coupleId),
  ]);

  const journey = journeyResult.data;
  if (journeyResult.error) {
    console.error("Journey 조회 에러:", journeyResult.error.message);
  }

  // 프로필에서 신부/신랑 이름 추출
  const profiles = profilesResult.data ?? [];
  const brideName = profiles.find((p) => p.role === "bride")?.name ?? null;
  const groomName = profiles.find((p) => p.role === "groom")?.name ?? null;

  // 예약 내역 정리
  const bookings = (bookingsResult.data ?? []).map((b) => {
    const vendor = b.vendors as unknown as { name: string; category: string } | null;
    return {
      vendorName: vendor?.name ?? "알 수 없는 업체",
      category: vendor?.category ?? "",
      date: b.booking_date as string,
      time: b.booking_time as string,
      status: b.status as string,
      amount: b.amount as number,
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

  // 대화 요약
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

  // Memory Step C: 의사결정 히스토리 정리
  const decisionsData = (decisionsResult.data ?? []) as Array<{
    category: string;
    decision_type: string;
    title: string;
    chosen_value: { value?: string } | null;
    reasoning: string | null;
    confidence: number | null;
    stage_tag: string | null;
    source: string;
    created_at: string;
  }>;
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

  // Mediation 강화: 갈등→합의 히스토리 정리
  const conflictsData = (conflictsResult.data ?? []) as Array<{
    title: string;
    chosen_value: { value?: string } | null;
    reasoning: string | null;
    stage_tag: string | null;
    created_at: string;
  }>;
  const pastConflicts = conflictsData.map((c) => ({
    title: c.title,
    resolution: c.chosen_value?.value ?? null,
    reasoning: c.reasoning,
    stageTag: c.stage_tag,
    createdAt: c.created_at,
  }));

  // --- Part 2 & 3: 불만족 자동 감지 + 세션 수준 실수 추적 ---
  // 현재 사용자 메시지 (마지막 user 메시지)
  const typedMessages = messages as Array<{ role: string; content: string; id?: string }>;
  const lastUserMsg = [...typedMessages].reverse().find((m) => m.role === "user");
  const lastUserText = lastUserMsg?.content ?? "";

  // 직전 AI 메시지 (마지막 assistant 메시지)
  const lastAiMsg = [...typedMessages].reverse().find((m) => m.role === "assistant");
  const lastAiText = lastAiMsg?.content ?? "";
  // 직전 AI 메시지의 DB ID (id 필드가 있다면)
  const lastAiMessageId = (lastAiMsg as { id?: string })?.id;

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
  if (dissatisfaction?.detected) {
    autoSaveDissatisfaction({
      userId: user.id,
      coupleId,
      signal: dissatisfaction.signal,
      userMessage: lastUserText,
      previousAiMessageId: lastAiMessageId,
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
    senderName,
    bookings,
    scheduleEvents,
    chatSummaries,
    preferences: preferences ?? undefined,
    feedbackLessons,
    pastDecisions,
    pastConflicts,
  }) + specialistAddon;

  // 메시지 포맷팅
  const formattedMessages: MessageParam[] = messages.map(
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

  const executionContext = {
    coupleId,
    weddingContext: {
      weddingDate: journey?.wedding_date ?? weddingContext?.weddingDate ?? null,
      budget: journey?.total_budget ?? weddingContext?.budget ?? 0,
      venue: journey?.venue ?? weddingContext?.venue ?? null,
      progress: journey?.progress ?? weddingContext?.progress ?? {},
    },
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
            messages: currentMessages,
            tools: WEDDING_TOOLS,
            onTextDelta: (token) => {
              send({ type: "text_delta", content: token });
            },
          });

          // 라운드별 토큰/모델 집계
          if (result.usage) {
            totalTokensIn += result.usage.input_tokens ?? 0;
            totalTokensOut += result.usage.output_tokens ?? 0;
          }
          if (result.model) lastModel = result.model;

          // tool use가 없으면 최종 응답 (이미 토큰별로 스트리밍됨)
          if (result.toolUseBlocks.length === 0) {
            const { cleanText, suggestions } = extractSuggestions(
              result.fullText
            );

            if (suggestions.length > 0) {
              send({ type: "suggestions", suggestions });
            }

            // 서버 사이드 INSERT (with 10s idempotency)
            // 모바일 retry / 중복 fetch 시 동일 내용을 또 INSERT하지 않음.
            const insertResult = await insertAiMessageWithIdempotency({
              isDemo,
              coupleId,
              cleanText,
              clientRequestId,
              metadata: { toolResults, toolsUsed, senderName },
              stageTag,
              specialistType,
              visibility,
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
              },
            });

            // D1: 성공 turn 로깅 (fire-and-forget)
            void logAIInteraction({
              userId: user.id,
              coupleId,
              interactionType: "chat_turn",
              specialistType,
              userInput: lastUserText,
              aiOutput: cleanText,
              latencyMs: elapsedMs(turnStartedAt),
              success: true,
              model: lastModel,
              tokensInput: totalTokensIn || null,
              tokensOutput: totalTokensOut || null,
              metadata: {
                stage_tag: stageTag,
                tools_used: toolsUsed,
                tool_rounds: round + 1,
                correction_count: correctionCount,
              },
            });

            // Memory Step A: 10 메시지+ 누적 시 요약 생성 (fire-and-forget)
            const messagesWithLatest = [
              ...typedMessages.map((m) => ({ role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant", content: m.content, id: m.id })),
              { role: "assistant" as const, content: cleanText },
            ];
            void maybeSummarize({
              coupleId,
              userId: user.id,
              messages: messagesWithLatest,
              lastCoveredCount,
              lastToMessageId,
            });

            // Memory Step B: 이번 턴 decision/preference 추출 (fire-and-forget)
            void maybeExtractDecision({
              coupleId,
              userId: user.id,
              messages: messagesWithLatest,
              stageTag,
              lastUserText,
              visibility,
            });

            // Excavation 기법 사용 분류 (fire-and-forget)
            void maybeClassifyExcavation({
              coupleId,
              userId: user.id,
              lastUserText,
              aiResponseText: cleanText,
              stageTag,
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
            "analyze_quote",
          ]);

          const toolResultContents: ContentBlockParam[] = [];
          let hasUIRenderedTool = false;
          // 유저 메시지에 [quote_analysis] 태그가 있는지 확인
          const roundLastUserMsg = currentMessages.filter((m) => m.role === "user").pop();
          const roundLastUserText = typeof roundLastUserMsg?.content === "string"
            ? roundLastUserMsg.content
            : Array.isArray(roundLastUserMsg?.content)
              ? (roundLastUserMsg.content as ContentBlockParam[]).filter((b) => (b as { type: string }).type === "text").map((b) => (b as { text: string }).text).join("")
              : "";
          const hasQuoteAnalysisTag = roundLastUserText.includes("[quote_analysis]");

          for (const toolUse of result.toolUseBlocks) {
            toolsUsed.push(toolUse.name);
            if (UI_RENDERED_TOOLS.has(toolUse.name)) hasUIRenderedTool = true;

            // analyze_quote 방어: [quote_analysis] 태그 없이 included_items가 있으면 강제로 비움
            if (toolUse.name === "analyze_quote" && !hasQuoteAnalysisTag) {
              const inp = toolUse.input as Record<string, unknown>;
              if (Array.isArray(inp.included_items) && (inp.included_items as string[]).length > 0) {
                inp.included_items = [];
              }
            }

            send({ type: "tool_start", toolName: toolUse.name, toolInput: toolUse.input });
            const execResult = await executeTool(toolUse.name, toolUse.input, executionContext);
            toolResults.push(execResult);
            send({ type: "tool_result", result: execResult });
            // UI 카드로 렌더링되는 도구는 텍스트 중복 방지 리마인더 추가
            const outputJson = JSON.stringify(execResult.toolOutput);
            const reminder = UI_RENDERED_TOOLS.has(toolUse.name)
              ? "\n[SYSTEM: 이 결과는 프론트엔드에서 인터랙티브 카드/버튼으로 자동 표시됩니다. 텍스트 응답에서 업체 목록, 상품 목록, 시간표, 가격표를 절대 나열하지 마세요. 간단한 안내 1~2문장만 작성하세요.]"
              : "";
            toolResultContents.push(buildToolResultContent(toolUse.id, outputJson + reminder));
          }

          const assistantContent: ContentBlockParam[] = [];
          if (result.fullText) {
            assistantContent.push({ type: "text", text: result.fullText } as ContentBlockParam);
          }
          for (const toolUse of result.toolUseBlocks) {
            assistantContent.push({ type: "tool_use", id: toolUse.id, name: toolUse.name, input: toolUse.input } as ContentBlockParam);
          }

          currentMessages = [
            ...currentMessages,
            { role: "assistant" as const, content: assistantContent },
            { role: "user" as const, content: toolResultContents },
          ];
        }

        // 최대 라운드 초과 시 마지막 호출 (역시 실시간 스트리밍)
        const finalResult = await chatWithToolsStream({
          systemPrompt,
          messages: currentMessages,
          tools: WEDDING_TOOLS,
          onTextDelta: (token) => {
            send({ type: "text_delta", content: token });
          },
        });

        // 마지막 호출 토큰/모델 집계
        if (finalResult.usage) {
          totalTokensIn += finalResult.usage.input_tokens ?? 0;
          totalTokensOut += finalResult.usage.output_tokens ?? 0;
        }
        if (finalResult.model) lastModel = finalResult.model;

        const { cleanText, suggestions } = extractSuggestions(
          finalResult.fullText
        );

        if (suggestions.length > 0) {
          send({ type: "suggestions", suggestions });
        }

        // 서버 사이드 INSERT (MAX_TOOL_ROUNDS 초과 분기 — idempotency 포함)
        const insertResult2 = await insertAiMessageWithIdempotency({
          isDemo,
          coupleId,
          cleanText,
          clientRequestId,
          metadata: { toolResults, toolsUsed, senderName },
          stageTag,
          specialistType,
          visibility,
        });

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
          },
        });

        // Memory Step A + B: 요약 생성 + decision/preference 추출 (fire-and-forget)
        const messagesWithLatest = [
          ...typedMessages.map((m) => ({ role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant", content: m.content, id: m.id })),
          { role: "assistant" as const, content: cleanText },
        ];
        void maybeSummarize({
          coupleId,
          userId: user.id,
          messages: messagesWithLatest,
          lastCoveredCount,
          lastToMessageId,
        });
        void maybeExtractDecision({
          coupleId,
          userId: user.id,
          messages: messagesWithLatest,
          stageTag,
          lastUserText,
          visibility,
        });
        void maybeClassifyExcavation({
          coupleId,
          userId: user.id,
          lastUserText,
          aiResponseText: cleanText,
          stageTag,
        });

        // D1: MAX_TOOL_ROUNDS 초과 후 성공 turn 로깅 (fire-and-forget)
        void logAIInteraction({
          userId: user.id,
          coupleId,
          interactionType: "chat_turn",
          specialistType,
          userInput: lastUserText,
          aiOutput: cleanText,
          latencyMs: elapsedMs(turnStartedAt),
          success: true,
          model: lastModel,
          tokensInput: totalTokensIn || null,
          tokensOutput: totalTokensOut || null,
          metadata: {
            stage_tag: stageTag,
            tools_used: toolsUsed,
            tool_rounds: MAX_TOOL_ROUNDS,
            exceeded_max_rounds: true,
            correction_count: correctionCount,
          },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("채팅 API 에러:", errMsg);
        send({
          type: "error",
          message: errMsg.includes("timeout") || errMsg.includes("abort")
            ? "응답 시간이 초과되었습니다. 다시 시도해주세요."
            : `AI 응답 생성에 실패했습니다: ${errMsg}`,
        });

        // D1: 실패 turn 로깅 (fire-and-forget)
        void logAIInteraction({
          userId: user.id,
          coupleId,
          interactionType: "chat_turn",
          specialistType,
          userInput: lastUserText,
          aiOutput: null,
          latencyMs: elapsedMs(turnStartedAt),
          success: false,
          errorMessage: errMsg,
          model: lastModel,
          tokensInput: totalTokensIn || null,
          tokensOutput: totalTokensOut || null,
          metadata: {
            stage_tag: stageTag,
          },
        });
      }

      clearInterval(heartbeat);
      controller.close();
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
