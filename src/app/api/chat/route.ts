import { NextRequest } from "next/server";
import { streamClaude } from "@/lib/ai/claude";
import { buildSystemPrompt, classifyQuery } from "@/lib/ai/prompts";
import { ChatContext } from "@/types/chat.types";

export const runtime = "nodejs";

interface ChatRequestBody {
  messages: { role: "user" | "assistant"; content: string }[];
  context?: ChatContext;
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequestBody = await request.json();
    const { messages, context } = body;

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ error: "메시지가 필요합니다." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 시스템 프롬프트 생성
    const systemPrompt = buildSystemPrompt(context);

    // 마지막 사용자 메시지로 쿼리 분류
    const lastUserMsg = messages.filter((m) => m.role === "user").pop();
    const queryType = lastUserMsg
      ? classifyQuery(lastUserMsg.content)
      : "simple";

    // 모델 선택 (복잡한 질문은 더 강력한 모델)
    const model =
      queryType === "simple"
        ? "claude-haiku-4-5-20251001"
        : "claude-sonnet-4-5-20250929";

    // 스트리밍 응답
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          const stream = streamClaude({
            systemPrompt,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            model,
          });

          for await (const chunk of stream) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`)
            );
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          console.error("[Chat API] Stream error:", error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: "응답 생성 중 오류가 발생했습니다." })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[Chat API] Error:", error);
    return new Response(
      JSON.stringify({ error: "서버 오류가 발생했습니다." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
