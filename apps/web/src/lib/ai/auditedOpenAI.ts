import OpenAI from "openai";
import type {
  Response as OpenAIResponse,
  ResponseCreateParamsNonStreaming,
  ResponseInput,
} from "openai/resources/responses/responses";
import { getAmoraModelConfig, type AmoraModelRole } from "@/lib/ai/modelConfig";
import { getOpenAIClient, OpenAIResponseError } from "@/lib/ai/openai";
import { createSafetyIdentifier } from "@/lib/ai/safetyIdentifier";
import {
  elapsedMs,
  logAIInteraction,
  startLatencyClock,
  type AIInteractionLogInput,
} from "@/lib/compliance/ai-log";

type AuditBase = Omit<
  AIInteractionLogInput,
  "latencyMs" | "success" | "errorMessage" | "model" | "tokensInput" | "tokensOutput"
>;

export interface AuditedOpenAIResponse {
  text: string;
  model: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_write_input_tokens: number;
    cached_input_tokens: number;
  };
}

export async function createOpenAIResponseWithAudit(options: {
  modelRole: AmoraModelRole;
  instructions: string;
  input: string | ResponseInput;
  maxOutputTokens: number;
  audit: AuditBase;
  client?: OpenAI;
  startedAt?: number;
  signal?: AbortSignal;
}): Promise<AuditedOpenAIResponse> {
  const startedAt = options.startedAt ?? startLatencyClock();
  const modelConfig = getAmoraModelConfig(options.modelRole);
  const safetyIdentifier = createSafetyIdentifier(
    options.audit.userId ?? options.audit.coupleId ?? options.audit.sessionId
  );

  const auditMetadata = {
    ...(options.audit.metadata ?? {}),
    ai_provider: "openai",
    quota_class: "provider_call",
    model_role: options.modelRole,
    reasoning_effort: modelConfig.reasoningEffort,
    audit_wrapper: "createOpenAIResponseWithAudit",
  };
  let response: OpenAIResponse;

  // Provider/response failures are audited here. The success audit below is
  // deliberately outside this catch so an audit outage cannot be misclassified
  // as a second provider failure or discard the response usage.
  try {
    options.signal?.throwIfAborted();
    const client = options.client ?? getOpenAIClient();
    const request: ResponseCreateParamsNonStreaming = {
      model: modelConfig.model,
      instructions: options.instructions,
      input: options.input,
      max_output_tokens: options.maxOutputTokens,
      reasoning: { effort: modelConfig.reasoningEffort },
      text: { verbosity: modelConfig.verbosity },
      safety_identifier: safetyIdentifier,
      service_tier: "default",
      // 보조 호출은 대부분 일회성·동적 입력이라 재사용되지 않는 유료 cache write를 막는다.
      prompt_cache_options: { mode: "explicit" },
      store: false,
    };
    response = options.signal
      ? await client.responses.create(request, { signal: options.signal })
      : await client.responses.create(request);
    if (response.status !== "completed") {
      const reason =
        response.error?.message ||
        response.incomplete_details?.reason ||
        response.status ||
        "unknown";
      throw new OpenAIResponseError(
        `[openai] 응답이 완료되지 않았습니다: ${reason}`,
        response
      );
    }
  } catch (err) {
    const responseError = err instanceof OpenAIResponseError ? err : null;
    await logAIInteraction({
      ...options.audit,
      required: true,
      aiOutput: null,
      latencyMs: elapsedMs(startedAt),
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      model: responseError?.model ?? modelConfig.model,
      tokensInput: responseError?.usage?.input_tokens ?? null,
      tokensOutput: responseError?.usage?.output_tokens ?? null,
      cacheWriteTokens: responseError?.usage?.cache_write_input_tokens ?? null,
      cacheReadTokens: responseError?.usage?.cache_read_input_tokens ?? null,
      metadata: auditMetadata,
    });
    throw err;
  }

  const text = response.output_text.trim();
  const hasOutput = text.length > 0;

  await logAIInteraction({
    ...options.audit,
    required: true,
    aiOutput: text || null,
    latencyMs: elapsedMs(startedAt),
    success: hasOutput,
    errorMessage: hasOutput ? null : "empty_response",
    model: response.model,
    tokensInput: response.usage?.input_tokens ?? null,
    tokensOutput: response.usage?.output_tokens ?? null,
    cacheWriteTokens: response.usage?.input_tokens_details?.cache_write_tokens ?? null,
    cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens ?? null,
    metadata: auditMetadata,
  });

  return {
    text,
    model: response.model,
    usage: response.usage
      ? {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          cache_write_input_tokens:
            response.usage.input_tokens_details?.cache_write_tokens ?? 0,
          cached_input_tokens: response.usage.input_tokens_details?.cached_tokens ?? 0,
        }
      : undefined,
  };
}
