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
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  model?: string;
}

// 첨부파일 정보 (이미지 + PDF)
export type AttachmentMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "application/pdf";

export interface ImageAttachment {
  base64: string;
  mediaType: AttachmentMediaType;
}

// 텍스트 + 이미지를 멀티모달 content로 변환
export function buildMultimodalContent(
  text: string,
  images?: ImageAttachment[]
): string | ContentBlockParam[] {
  if (!images || images.length === 0) return text;

  const contentBlocks: ContentBlockParam[] = [];

  // 이미지/PDF 블록
  for (const img of images) {
    if (img.mediaType === "application/pdf") {
      contentBlocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: img.base64,
        },
      } as ContentBlockParam);
    } else {
      contentBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType,
          data: img.base64,
        },
      } as ContentBlockParam);
    }
  }

  // 텍스트 블록
  if (text) {
    contentBlocks.push({ type: "text", text } as ContentBlockParam);
  }

  return contentBlocks;
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
    usage: finalMessage.usage
      ? {
          input_tokens: finalMessage.usage.input_tokens,
          output_tokens: finalMessage.usage.output_tokens,
        }
      : undefined,
    model: finalMessage.model,
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
