import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages";
import {
  elapsedMs,
  logAIInteraction,
  startLatencyClock,
  type AIInteractionLogInput,
} from "@/lib/compliance/ai-log";

let defaultClient: Anthropic | null = null;

function getDefaultClient() {
  if (!defaultClient) {
    defaultClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return defaultClient;
}

function extractText(response: Message): string {
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

type AuditBase = Omit<
  AIInteractionLogInput,
  "latencyMs" | "success" | "errorMessage" | "model" | "tokensInput" | "tokensOutput"
>;

export async function createAnthropicMessageWithAudit(options: {
  params: MessageCreateParamsNonStreaming;
  audit: AuditBase;
  client?: Anthropic;
  startedAt?: number;
  extractAiOutput?: (response: Message) => string | null;
}) {
  const startedAt = options.startedAt ?? startLatencyClock();
  const model = typeof options.params.model === "string" ? options.params.model : null;

  try {
    const client = options.client ?? getDefaultClient();
    const response = await client.messages.create(options.params);
    const aiOutput = options.extractAiOutput?.(response) ?? extractText(response);
    const hasOutput = aiOutput.trim().length > 0;

    void logAIInteraction({
      ...options.audit,
      aiOutput: aiOutput || null,
      latencyMs: elapsedMs(startedAt),
      success: hasOutput,
      errorMessage: hasOutput ? null : "empty_response",
      model,
      tokensInput: response.usage?.input_tokens ?? null,
      tokensOutput: response.usage?.output_tokens ?? null,
      metadata: {
        ...(options.audit.metadata ?? {}),
        audit_wrapper: "createAnthropicMessageWithAudit",
      },
    });

    return response;
  } catch (err) {
    void logAIInteraction({
      ...options.audit,
      aiOutput: null,
      latencyMs: elapsedMs(startedAt),
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      model,
      metadata: {
        ...(options.audit.metadata ?? {}),
        audit_wrapper: "createAnthropicMessageWithAudit",
      },
    });
    throw err;
  }
}
