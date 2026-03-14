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

// 스트리밍 + 도구 사용 지원 Chat
export async function chatWithTools(options: {
  systemPrompt: string;
  messages: MessageParam[];
  tools: Tool[];
  onTextDelta?: (text: string) => void;
  maxTokens?: number;
}): Promise<ChatWithToolsResult> {
  const { systemPrompt, messages, tools, onTextDelta, maxTokens = 2048 } = options;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
    tools,
  });

  let fullText = "";
  const toolUseBlocks: ToolUseBlock[] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      fullText += block.text;
      onTextDelta?.(block.text);
    } else if (block.type === "tool_use") {
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
    stopReason: response.stop_reason || "end_turn",
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
