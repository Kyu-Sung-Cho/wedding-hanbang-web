import { createClient } from "@/lib/supabase/server";
import { chatWithTools, buildToolResultContent } from "@/lib/ai/claude";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { WEDDING_TOOLS } from "@/lib/ai/tools";
import { executeTool } from "@/lib/ai/toolExecutor";
import { NextResponse } from "next/server";
import type { MessageParam, ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutionResult } from "@/types/database.types";

// Vercel 함수 타임아웃 60초 (tool use 루프 때문에 시간 필요)
export const maxDuration = 60;

const MAX_TOOL_ROUNDS = 5;

// Claude 응답에서 [suggestions] 블록 추출 (백틱 있든 없든 모두 처리)
function extractSuggestions(text: string): { cleanText: string; suggestions: string[] } {
  // 패턴 1: ```[suggestions]...[/suggestions]``` (백틱 감싸기)
  // 패턴 2: [suggestions]...[/suggestions] (백틱 없음)
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
  // 인증 체크 (실패 시 JSON 에러 반환)
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

  // 최신 journey 데이터로 시스템 프롬프트 생성
  const { data: journey, error: journeyErr } = await supabase
    .from("wedding_journeys")
    .select("*")
    .eq("couple_id", coupleId)
    .single();

  if (journeyErr) {
    console.error("Journey 조회 에러:", journeyErr.message);
  }

  const systemPrompt = getWeddingPlannerSystemPrompt({
    weddingDate: journey?.wedding_date ?? weddingContext?.weddingDate ?? null,
    budget: journey?.total_budget ?? weddingContext?.budget ?? 0,
    progress: journey?.progress ?? weddingContext?.progress ?? {},
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
          const result = await chatWithTools({
            systemPrompt,
            messages: currentMessages,
            tools: WEDDING_TOOLS,
          });

          // tool use가 없으면 최종 응답
          if (result.toolUseBlocks.length === 0) {
            const { cleanText, suggestions } = extractSuggestions(
              result.fullText
            );

            send({ type: "text_delta", content: cleanText });

            if (suggestions.length > 0) {
              send({ type: "suggestions", suggestions });
            }

            send({
              type: "done",
              fullContent: cleanText,
              metadata: { toolResults, toolsUsed, senderName },
            });

            controller.close();
            return;
          }

          // tool use 블록 실행
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

        // 최대 라운드 초과 시 마지막 호출
        const finalResult = await chatWithTools({
          systemPrompt,
          messages: currentMessages,
          tools: WEDDING_TOOLS,
        });

        const { cleanText, suggestions } = extractSuggestions(
          finalResult.fullText
        );

        send({ type: "text_delta", content: cleanText });

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
          message: `AI 응답 생성에 실패했습니다: ${errMsg}`,
        });
      }

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
