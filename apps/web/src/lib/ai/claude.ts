import Anthropic from "@anthropic-ai/sdk";
import type { Tool, MessageParam, ContentBlockParam, TextBlockParam } from "@anthropic-ai/sdk/resources/messages";

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
    /** Prompt caching: 캐시 write (첫 호출, ~25% 추가비) */
    cache_creation_input_tokens?: number;
    /** Prompt caching: 캐시 read (hit, ~90% 할인) */
    cache_read_input_tokens?: number;
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
//
// [Prompt caching 적용 — 2026-05-18]
// - system 프롬프트는 그대로(순서/내용 변경 X) 한 블록으로 cache_control 마킹.
//   같은 사용자가 5분 안에 같은 컨텍스트로 두 번째 호출하면 input 토큰
//   90% 할인 ($3/M → $0.30/M). 입력 내용이 다르면 캐시 miss 후 새로 캐시.
//   응답 품질/내용은 캐시 여부와 무관하게 100% 동일 (Anthropic 보장).
// - tools 배열 마지막에도 cache_control. 35개 tool 정의 ~900 토큰이 매 호출
//   캐시 hit 가능.
export async function chatWithToolsStream(options: {
  systemPrompt: string;
  messages: MessageParam[];
  tools: Tool[];
  onTextDelta?: (text: string) => void;
  maxTokens?: number;
}): Promise<ChatWithToolsResult> {
  const { systemPrompt, messages, tools, onTextDelta, maxTokens = 2048 } = options;

  // 시스템 프롬프트를 캐시 가능한 단일 블록으로 변환 — 순서·내용 변경 없음.
  const systemBlocks: TextBlockParam[] = [
    {
      type: "text",
      text: systemPrompt,
      cache_control: { type: "ephemeral" },
    },
  ];

  // tools 배열의 마지막 원소에 cache_control — 전체 tools 배열 캐싱.
  // 마지막 tool을 spread로 복제 후 cache_control 추가 (원본 tools 배열 비파괴).
  const cachedTools: Tool[] = tools.length > 0
    ? [
        ...tools.slice(0, -1),
        { ...tools[tools.length - 1], cache_control: { type: "ephemeral" } } as Tool,
      ]
    : tools;

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    system: systemBlocks,
    messages,
    tools: cachedTools,
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
          cache_creation_input_tokens: finalMessage.usage.cache_creation_input_tokens ?? undefined,
          cache_read_input_tokens: finalMessage.usage.cache_read_input_tokens ?? undefined,
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
