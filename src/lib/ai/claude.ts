import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

interface ClaudeStreamOptions {
  systemPrompt: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  model?: string;
}

// 스트리밍 응답 생성
export async function* streamClaude({
  systemPrompt,
  messages,
  maxTokens = 1024,
  model = "claude-sonnet-4-5-20250929",
}: ClaudeStreamOptions): AsyncGenerator<string> {
  const stream = anthropic.messages.stream({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}

// 일반 응답 생성
export async function callClaude({
  systemPrompt,
  messages,
  maxTokens = 1024,
  model = "claude-sonnet-4-5-20250929",
}: ClaudeStreamOptions): Promise<string> {
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock?.type === "text" ? textBlock.text : "";
}
