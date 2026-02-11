import { NextRequest } from "next/server";
import { streamClaude } from "@/lib/ai/claude";
import { buildSystemPrompt, classifyQuery } from "@/lib/ai/prompts";
import { ChatContext } from "@/types/chat.types";

export const runtime = "nodejs";

const ACTION_MARKER = "---ACTIONS---";

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
            maxTokens: 1500,
          });

          let fullText = "";
          let sentLength = 0;
          const BUFFER_SIZE = 500;

          for await (const chunk of stream) {
            fullText += chunk;

            // 버퍼링: 마지막 500자는 보류 (---ACTIONS--- 블록이 잘리지 않도록)
            const safeEnd = Math.max(0, fullText.length - BUFFER_SIZE);
            const toSend = fullText.slice(sentLength, safeEnd);

            if (toSend) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: toSend })}\n\n`)
              );
              sentLength = safeEnd;
            }
          }

          // 스트림 종료 - 버퍼에 남은 텍스트 처리
          const remaining = fullText.slice(sentLength);
          const markerIdx = remaining.indexOf(ACTION_MARKER);

          if (markerIdx !== -1) {
            // ACTION 마커 발견 - 마커 이전 텍스트 전송
            const textBeforeMarker = remaining.slice(0, markerIdx).trimEnd();
            if (textBeforeMarker) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: textBeforeMarker })}\n\n`)
              );
            }

            // JSON 파싱하여 메타데이터로 전송
            const actionsStr = remaining.slice(markerIdx + ACTION_MARKER.length).trim();
            try {
              const actions = JSON.parse(actionsStr);
              const metadata: Record<string, unknown> = {};
              if (actions.buttons) metadata.buttons = actions.buttons;
              if (actions.quickReplies) metadata.quickReplies = actions.quickReplies;

              if (Object.keys(metadata).length > 0) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(metadata)}\n\n`)
                );
              }
            } catch {
              // JSON 파싱 실패 시 텍스트로 전송하지 않음 (UI에 JSON이 보이면 안됨)
              console.error("[Chat API] Failed to parse actions JSON");
            }
          } else {
            // 마커 없음 - 전체 버퍼에서 확인
            const fullMarkerIdx = fullText.indexOf(ACTION_MARKER);
            if (fullMarkerIdx !== -1) {
              // 이미 일부가 전송됨 - textReplace로 정리
              const cleanText = fullText.slice(0, fullMarkerIdx).trimEnd();
              const actionsStr = fullText.slice(fullMarkerIdx + ACTION_MARKER.length).trim();

              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ textReplace: cleanText })}\n\n`)
              );

              try {
                const actions = JSON.parse(actionsStr);
                const metadata: Record<string, unknown> = {};
                if (actions.buttons) metadata.buttons = actions.buttons;
                if (actions.quickReplies) metadata.quickReplies = actions.quickReplies;

                if (Object.keys(metadata).length > 0) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(metadata)}\n\n`)
                  );
                }
              } catch {
                console.error("[Chat API] Failed to parse actions JSON (full)");
              }
            } else {
              // 마커 없음 - 남은 텍스트 그대로 전송
              if (remaining) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ text: remaining })}\n\n`)
                );
              }
            }
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
