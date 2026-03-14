import { createClient } from "@/lib/supabase/server";
import { chatWithToolsStream, buildToolResultContent } from "@/lib/ai/claude";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { WEDDING_TOOLS } from "@/lib/ai/tools";
import { executeTool } from "@/lib/ai/toolExecutor";
import { NextResponse } from "next/server";
import type { MessageParam, ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutionResult } from "@/types/database.types";

// Vercel Pro: 최대 300초 (5분)
export const maxDuration = 300;

const MAX_TOOL_ROUNDS = 5;

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

export async function POST(request: Request) {
  // 인증 체크
  const supabase = await createClient();
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

  const { messages, coupleId, senderName, weddingContext } = body;

  if (!messages || !coupleId) {
    return NextResponse.json(
      { error: "메시지와 커플 ID가 필요합니다." },
      { status: 400 }
    );
  }

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
  });

  const formattedMessages: MessageParam[] = messages.map(
    (m: { role: string; content: string }) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    })
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

        // Tool use 루프: 최대 MAX_TOOL_ROUNDS까지 반복
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

          const toolResultContents: ContentBlockParam[] = [];

          for (const toolUse of result.toolUseBlocks) {
            toolsUsed.push(toolUse.name);

            send({
              type: "tool_start",
              toolName: toolUse.name,
              toolInput: toolUse.input,
            });

            const execResult = await executeTool(
              toolUse.name,
              toolUse.input,
              executionContext
            );
            toolResults.push(execResult);

            send({ type: "tool_result", result: execResult });

            toolResultContents.push(
              buildToolResultContent(
                toolUse.id,
                JSON.stringify(execResult.toolOutput)
              )
            );
          }

          // 대화 이어가기: assistant 응답 + tool results
          const assistantContent: ContentBlockParam[] = [];
          if (result.fullText) {
            assistantContent.push({
              type: "text",
              text: result.fullText,
            } as ContentBlockParam);
          }
          for (const toolUse of result.toolUseBlocks) {
            assistantContent.push({
              type: "tool_use",
              id: toolUse.id,
              name: toolUse.name,
              input: toolUse.input,
            } as ContentBlockParam);
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
