import { createClient } from "@/lib/supabase/server";
import { chatWithTools, buildToolResultContent } from "@/lib/ai/claude";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { WEDDING_TOOLS } from "@/lib/ai/tools";
import { executeTool } from "@/lib/ai/toolExecutor";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { SSEEvent } from "@/types/chat.types";

export const maxDuration = 60;

function sendSSE(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: SSEEvent
) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}

// [SUGGESTIONS: "a", "b", "c"] 파싱
function parseSuggestions(text: string): {
  cleanText: string;
  suggestions: string[];
} {
  const match = text.match(/\[SUGGESTIONS:\s*(.+?)\]\s*$/);
  if (!match) return { cleanText: text, suggestions: [] };

  const cleanText = text.replace(/\[SUGGESTIONS:\s*.+?\]\s*$/, "").trim();
  const raw = match[1];
  const suggestions = Array.from(raw.matchAll(/"([^"]+)"/g)).map((m) => m[1]);

  return { cleanText, suggestions };
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 데모 모드 체크
    const cookieHeader = request.headers.get("cookie") || "";
    const isDemo = cookieHeader.includes("demo_mode=true");

    if (!user && !isDemo) {
      return new Response(JSON.stringify({ error: "인증이 필요합니다." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { messages, coupleId, senderName, senderRole, weddingContext } =
      await request.json();

    if (!messages) {
      return new Response(
        JSON.stringify({ error: "메시지가 필요합니다." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = getWeddingPlannerSystemPrompt({
      weddingDate: weddingContext?.weddingDate ?? null,
      budget: weddingContext?.budget ?? 0,
      venue: weddingContext?.venue ?? null,
      progress: weddingContext?.progress ?? {},
    });

    // 대화 메시지 포맷
    const formattedMessages: MessageParam[] = messages.map(
      (m: { role: string; content: string }) => ({
        role:
          m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      })
    );

    // 도구 실행 컨텍스트
    const execContext = {
      coupleId: coupleId || "demo",
      weddingContext: {
        weddingDate: weddingContext?.weddingDate ?? null,
        budget: weddingContext?.budget ?? 0,
        venue: weddingContext?.venue ?? null,
        progress: weddingContext?.progress ?? {},
      },
    };

    // SSE 스트림 생성
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let currentMessages = [...formattedMessages];
          let allToolResults: Array<{
            toolName: string;
            toolInput: Record<string, unknown>;
            toolOutput: Record<string, unknown>;
            success: boolean;
            displayMessage: string;
          }> = [];
          let finalText = "";
          let iterations = 0;
          const MAX_ITERATIONS = 3;

          // 도구 사용 루프
          while (iterations < MAX_ITERATIONS) {
            iterations++;

            const result = await chatWithTools({
              systemPrompt,
              messages: currentMessages,
              tools: WEDDING_TOOLS,
              onTextDelta: (text) => {
                sendSSE(controller, encoder, {
                  type: "text_delta",
                  content: text,
                });
              },
              maxTokens: 2048,
            });

            finalText += result.fullText;

            // 도구 호출이 없으면 루프 종료
            if (
              result.stopReason !== "tool_use" ||
              result.toolUseBlocks.length === 0
            ) {
              break;
            }

            // 도구 실행
            const toolResultContents = [];

            for (const toolBlock of result.toolUseBlocks) {
              // 도구 시작 이벤트
              sendSSE(controller, encoder, {
                type: "tool_start",
                toolName: toolBlock.name,
                toolInput: toolBlock.input,
              });

              // 도구 실행 (데모 모드에서는 DB 호출 스킵)
              let toolResult;
              if (isDemo) {
                // 데모: 로컬에서 시뮬레이션
                toolResult = await executeDemoTool(
                  toolBlock.name,
                  toolBlock.input,
                  execContext
                );
              } else {
                toolResult = await executeTool(
                  toolBlock.name,
                  toolBlock.input,
                  execContext
                );
              }

              allToolResults.push(toolResult);

              // 도구 결과 이벤트
              sendSSE(controller, encoder, {
                type: "tool_result",
                result: toolResult,
              });

              // Claude에게 돌려줄 도구 결과
              toolResultContents.push(
                buildToolResultContent(
                  toolBlock.id,
                  JSON.stringify(toolResult.toolOutput)
                )
              );
            }

            // assistant 메시지(도구 호출 포함) + user 메시지(도구 결과) 추가
            const assistantContent = [];
            if (result.fullText) {
              assistantContent.push({
                type: "text" as const,
                text: result.fullText,
              });
            }
            for (const tb of result.toolUseBlocks) {
              assistantContent.push({
                type: "tool_use" as const,
                id: tb.id,
                name: tb.name,
                input: tb.input,
              });
            }

            currentMessages = [
              ...currentMessages,
              { role: "assistant", content: assistantContent } as MessageParam,
              {
                role: "user",
                content: toolResultContents,
              } as MessageParam,
            ];

            // 다음 반복에서 텍스트 리셋
            finalText = "";
          }

          // 제안 파싱
          const { cleanText, suggestions } = parseSuggestions(finalText);

          if (suggestions.length > 0) {
            sendSSE(controller, encoder, {
              type: "suggestions",
              suggestions,
            });
          }

          // 완료 이벤트
          sendSSE(controller, encoder, {
            type: "done",
            fullContent: cleanText,
            metadata: {
              suggestions,
              toolResults:
                allToolResults.length > 0 ? allToolResults : undefined,
            },
          });
        } catch (err) {
          console.error("SSE 스트림 에러:", err);
          sendSSE(controller, encoder, {
            type: "error",
            message: "AI 응답 생성에 실패했습니다.",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("채팅 API 에러:", err);
    return new Response(
      JSON.stringify({ error: "AI 응답 생성에 실패했습니다." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// 데모 모드용 도구 실행 (DB 없이 로컬 시뮬레이션)
async function executeDemoTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: {
    coupleId: string;
    weddingContext: {
      weddingDate: string | null;
      budget: number;
      venue: string | null;
      progress: Record<string, { category: string; status: string }>;
    };
  }
) {
  // toolExecutor와 동일한 로직이지만 DB 호출 없이 컨텍스트만 업데이트
  const { executeTool: exec } = await import("@/lib/ai/toolExecutor");

  // read 전용 도구는 그대로 실행
  if (toolName.startsWith("get_")) {
    return exec(toolName, toolInput, ctx);
  }

  // write 도구는 컨텍스트만 업데이트 (DB skip)
  const CATEGORY_LABELS: Record<string, string> = {
    venue: "예식장", studio: "스튜디오", dress: "드레스",
    makeup: "메이크업", ring: "예물", hanbok: "한복",
    honeymoon: "신혼여행", houseware: "혼수",
    invitation: "청첩장", gift: "답례품",
  };
  const STATUS_LABELS: Record<string, string> = {
    not_started: "시작전", in_progress: "진행중", completed: "완료",
  };

  function formatWon(amount: number): string {
    if (amount >= 100000000) return `${(amount / 100000000).toFixed(1)}억원`;
    return `${Math.round(amount / 10000).toLocaleString()}만원`;
  }

  switch (toolName) {
    case "update_budget": {
      const newBudget = toolInput.total_budget as number;
      const oldBudget = ctx.weddingContext.budget;
      ctx.weddingContext.budget = newBudget;
      return {
        toolName, toolInput,
        toolOutput: { total_budget: newBudget, previous_budget: oldBudget },
        success: true,
        displayMessage: `총 예산이 ${formatWon(oldBudget)}에서 ${formatWon(newBudget)}으로 변경되었습니다.`,
      };
    }
    case "update_wedding_date": {
      const newDate = toolInput.wedding_date as string;
      const oldDate = ctx.weddingContext.weddingDate;
      ctx.weddingContext.weddingDate = newDate;
      const dDay = Math.ceil(
        (new Date(newDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      return {
        toolName, toolInput,
        toolOutput: { wedding_date: newDate, previous_date: oldDate, d_day: dDay },
        success: true,
        displayMessage: `결혼 예정일이 ${newDate}로 변경되었습니다. (D-${dDay})`,
      };
    }
    case "update_task_status": {
      const category = toolInput.category as string;
      const status = toolInput.status as string;
      ctx.weddingContext.progress = {
        ...ctx.weddingContext.progress,
        [category]: { category, status },
      };
      return {
        toolName, toolInput,
        toolOutput: {
          category, status,
          label: CATEGORY_LABELS[category] || category,
          statusLabel: STATUS_LABELS[status] || status,
        },
        success: true,
        displayMessage: `${CATEGORY_LABELS[category] || category} 상태가 "${STATUS_LABELS[status] || status}"(으)로 변경되었습니다.`,
      };
    }
    case "update_venue": {
      const venue = toolInput.venue as string;
      const oldVenue = ctx.weddingContext.venue;
      ctx.weddingContext.venue = venue;
      return {
        toolName, toolInput,
        toolOutput: { venue, previous_venue: oldVenue },
        success: true,
        displayMessage: `예식장이 "${venue}"(으)로 설정되었습니다.`,
      };
    }
    default:
      return {
        toolName, toolInput, toolOutput: {}, success: false,
        displayMessage: `알 수 없는 도구: ${toolName}`,
      };
  }
}
