import OpenAI from "openai";
import type {
  Response as OpenAIResponse,
  ResponseCreateParamsNonStreaming,
  ResponseInput,
} from "openai/resources/responses/responses";
import {
  assertAmoraOutputTokenLimit,
  getAmoraModelConfig,
  type AmoraModelRole,
} from "@/lib/ai/modelConfig";
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

function safeProviderErrorCode(error: unknown): string {
  if (error instanceof OpenAIResponseError) return "openai_response_error";
  if (error instanceof Error && error.name === "AbortError") {
    return "provider_request_aborted";
  }

  const record = error && typeof error === "object"
    ? error as { name?: unknown; status?: unknown; code?: unknown; type?: unknown }
    : {};
  const cleanToken = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
    return cleaned || null;
  };
  const parts = ["provider_request_failed"];
  const name = cleanToken(record.name);
  const code = cleanToken(record.code);
  const type = cleanToken(record.type);
  const status = typeof record.status === "number" && Number.isSafeInteger(record.status)
    ? record.status
    : null;
  if (name) parts.push(`name_${name}`);
  if (status !== null) parts.push(`status_${status}`);
  if (code) parts.push(`code_${code}`);
  if (type) parts.push(`type_${type}`);
  return parts.join(":").slice(0, 240);
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
    assertAmoraOutputTokenLimit(options.maxOutputTokens);
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
      // 비용·보안 장부에는 canonical 채팅/도메인 레코드와 별도로 대화
      // 원문을 복제하지 않는다. 비활성 보조 작업이 재개돼도 같은 기본값을 유지한다.
      userInput: null,
      aiOutput: null,
      latencyMs: elapsedMs(startedAt),
      success: false,
      // Provider/SDK messages can reflect request fragments. Persist only a
      // bounded diagnostic made from non-free-text name/status/code fields.
      errorMessage: safeProviderErrorCode(err),
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
    userInput: null,
    aiOutput: null,
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

  if (!hasOutput) {
    // The failed audit was already written above. Throw outside the provider
    // catch so callers fail closed without creating a duplicate audit row.
    throw new OpenAIResponseError("[openai] completed response contained no output text", response);
  }

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
