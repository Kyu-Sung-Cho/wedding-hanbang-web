import { createClientFromRequest } from "@/lib/supabase/server";
import { chatWithToolsStream, buildToolResultContent, buildMultimodalContent } from "@/lib/ai/claude";
import type { ImageAttachment } from "@/lib/ai/claude";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { WEDDING_TOOLS } from "@/lib/ai/tools";
import { executeTool } from "@/lib/ai/toolExecutor";
import { NextResponse } from "next/server";
import type { MessageParam, ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutionResult } from "@/types/database.types";
// mammoth, xlsx는 필요할 때만 동적 import (Vercel 호환성)

// Vercel Pro: 최대 300초 (5분)
export const maxDuration = 300;

const MAX_TOOL_ROUNDS = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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

  const { messages, coupleId, senderName, weddingContext, attachments } = body;

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
  const [journeyResult, profilesResult, bookingsResult, summariesResult] = await Promise.all([
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
    // 4. 대화 요약 (최근 3개)
    supabase.from("chat_summaries")
      .select("summary, created_at")
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: false })
      .limit(3),
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
  const chatSummaries = (summariesResult.data ?? []).map((s) => s.summary as string);

  const systemPrompt = getWeddingPlannerSystemPrompt({
    weddingDate: journey?.wedding_date ?? weddingContext?.weddingDate ?? null,
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
  });

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

          // tool use가 없으면 최종 응답 (이미 토큰별로 스트리밍됨)
          if (result.toolUseBlocks.length === 0) {
            const { cleanText, suggestions } = extractSuggestions(
              result.fullText
            );

            if (suggestions.length > 0) {
              send({ type: "suggestions", suggestions });
            }

            send({
              type: "done",
              fullContent: cleanText,
              metadata: { toolResults, toolsUsed, senderName },
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
          const lastUserMsg = currentMessages.filter((m) => m.role === "user").pop();
          const lastUserText = typeof lastUserMsg?.content === "string"
            ? lastUserMsg.content
            : Array.isArray(lastUserMsg?.content)
              ? (lastUserMsg.content as ContentBlockParam[]).filter((b) => (b as { type: string }).type === "text").map((b) => (b as { text: string }).text).join("")
              : "";
          const hasQuoteAnalysisTag = lastUserText.includes("[quote_analysis]");

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

        const { cleanText, suggestions } = extractSuggestions(
          finalResult.fullText
        );

        if (suggestions.length > 0) {
          send({ type: "suggestions", suggestions });
        }

        send({
          type: "done",
          fullContent: cleanText,
          metadata: { toolResults, toolsUsed, senderName },
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
