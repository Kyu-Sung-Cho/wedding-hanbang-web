import Anthropic from "@anthropic-ai/sdk";
import type { Tool, MessageParam, ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ChatWithToolsResult {
  fullText: string;
  toolUseBlocks: ToolUseBlock[];
  stopReason: string;
}

// 실시간 스트리밍 + 도구 사용 지원 Chat
// messages.stream()을 사용하여 토큰이 생성되는 즉시 onTextDelta로 전달
export async function chatWithToolsStream(options: {
  systemPrompt: string;
  messages: MessageParam[];
  tools: Tool[];
  onTextDelta?: (text: string) => void;
  maxTokens?: number;
}): Promise<ChatWithToolsResult> {
  const { systemPrompt, messages, tools, onTextDelta, maxTokens = 2048 } = options;

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
    tools,
  });

  let fullText = "";
  const toolUseBlocks: ToolUseBlock[] = [];

  // 텍스트 토큰이 생성될 때마다 실시간 콜백
  stream.on("text", (text) => {
    fullText += text;
    onTextDelta?.(text);
  });

  // 스트림 완료 대기 → 최종 메시지에서 tool_use 블록 추출
  const finalMessage = await stream.finalMessage();

  for (const block of finalMessage.content) {
    if (block.type === "tool_use") {
      toolUseBlocks.push({
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
    }
  }

  return {
    fullText,
    toolUseBlocks,
    stopReason: finalMessage.stop_reason || "end_turn",
  };
}

// 도구 결과를 포함한 메시지 블록 생성
export function buildToolResultContent(
  toolUseId: string,
  result: string
): ContentBlockParam {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: result,
  } as ContentBlockParam;
}
