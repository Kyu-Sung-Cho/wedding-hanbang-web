import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export async function getChatResponse(
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock ? textBlock.text : "죄송합니다. 답변을 생성하지 못했습니다.";
}
