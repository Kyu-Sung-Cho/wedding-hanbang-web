import OpenAI from "openai";
import type {
  Response as OpenAIResponse,
  ResponseCreateParamsNonStreaming,
  ResponseFormatTextJSONSchemaConfig,
  ResponseInput,
} from "openai/resources/responses/responses";
import {
  assertAmoraOutputTokenLimit,
  getAmoraModelConfig,
  type AmoraModelRole,
} from "@/lib/ai/modelConfig";
import {
  assertOpenAIProviderEnabled,
  assertNoPromptCacheBreakpoints,
  getOpenAIClient,
  normalizeOpenAIProviderError,
  normalizeResponseUsage,
  OpenAIProviderError,
  OpenAIRefusalError,
  type NormalizedOpenAIUsage,
  type OpenAIUsageStatus,
} from "@/lib/ai/openai";
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
  usage?: NormalizedOpenAIUsage;
  usageStatus: OpenAIUsageStatus;
  requestId?: string | null;
  responseId?: string | null;
}

export interface AuditedOpenAIStructuredResponse<T> extends AuditedOpenAIResponse {
  data: T;
}

export class OpenAIStructuredOutputError extends Error {
  constructor(
    readonly code: "invalid_json" | "schema_validation_failed",
    options?: { cause?: unknown }
  ) {
    super(`[openai] structured output rejected: ${code}`, options);
    this.name = "OpenAIStructuredOutputError";
  }
}

interface BaseAuditOptions {
  modelRole: AmoraModelRole;
  instructions: string;
  input: string | ResponseInput;
  maxOutputTokens: number;
  audit: AuditBase;
  client?: OpenAI;
  startedAt?: number;
  signal?: AbortSignal;
  safetyIdentifierScope?: string;
}

interface InternalAuditOptions<T> extends BaseAuditOptions {
  auditWrapper: string;
  textFormat?: ResponseFormatTextJSONSchemaConfig;
  parseOutput?: (text: string) => T;
}

function getRefusalText(response: OpenAIResponse): string {
  return response.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content)
    .filter((content) => content.type === "refusal")
    .map((content) => content.refusal)
    .join("")
    .trim();
}

function buildAuditMetadata(options: {
  modelRole: AmoraModelRole;
  auditWrapper: string;
  metadata?: Record<string, unknown> | null;
  structuredOutputName?: string;
  requestId?: string | null;
  responseId?: string | null;
  usageStatus?: OpenAIUsageStatus;
  providerAttempted: boolean;
}): Record<string, unknown> {
  const modelConfig = getAmoraModelConfig(options.modelRole);
  return {
    ...(options.metadata ?? {}),
    ai_provider: "openai",
    model_role: options.modelRole,
    reasoning_effort: modelConfig.reasoningEffort,
    audit_wrapper: options.auditWrapper,
    provider_request_id: options.requestId ?? null,
    provider_response_id: options.responseId ?? null,
    usage_status: options.usageStatus ?? "unknown",
    unknown_paid_attempt: options.usageStatus === "unknown",
    provider_attempted: options.providerAttempted,
    ...(options.structuredOutputName
      ? { structured_output: true, schema_name: options.structuredOutputName }
      : {}),
  };
}

async function writeAudit(options: {
  audit: AuditBase;
  startedAt: number;
  success: boolean;
  errorMessage: string | null;
  model: string;
  usage?: NormalizedOpenAIUsage;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await logAIInteraction({
    ...options.audit,
    // canonical chat/domain rows are the content source of truth. The cost log
    // never duplicates conversation or tool payloads.
    userInput: null,
    aiOutput: null,
    toolInput: null,
    toolOutput: null,
    latencyMs: elapsedMs(options.startedAt),
    success: options.success,
    errorMessage: options.errorMessage,
    model: options.model,
    tokensInput: options.usage?.input_tokens ?? null,
    tokensOutput: options.usage?.output_tokens ?? null,
    cacheCreationTokens: options.usage?.cache_write_input_tokens ?? null,
    cacheReadTokens: options.usage?.cache_read_input_tokens ?? null,
    metadata: options.metadata,
  });
}

async function createOpenAIResponseWithAuditInternal<T>(
  options: InternalAuditOptions<T>
): Promise<AuditedOpenAIResponse & { data?: T }> {
  const startedAt = options.startedAt ?? startLatencyClock();
  const modelConfig = getAmoraModelConfig(options.modelRole);
  const safetyIdentifier = createSafetyIdentifier(
    options.safetyIdentifierScope ??
      options.audit.userId ??
      options.audit.coupleId ??
      options.audit.sessionId
  );
  let requestId: string | null | undefined;
  let response: OpenAIResponse | undefined;
  let providerAttempted = false;

  try {
    // 주입된 클라이언트도 운영 kill switch를 우회하지 못한다.
    assertOpenAIProviderEnabled();
    assertAmoraOutputTokenLimit(options.maxOutputTokens);
    assertNoPromptCacheBreakpoints(options.input);
    options.signal?.throwIfAborted();
    const client = options.client ?? getOpenAIClient();
    const request: ResponseCreateParamsNonStreaming = {
      model: modelConfig.model,
      instructions: options.instructions,
      input: options.input,
      max_output_tokens: options.maxOutputTokens,
      reasoning: { effort: modelConfig.reasoningEffort },
      text: {
        verbosity: modelConfig.verbosity,
        ...(options.textFormat ? { format: options.textFormat } : {}),
      },
      safety_identifier: safetyIdentifier,
      service_tier: "default",
      prompt_cache_options: { mode: "explicit" },
      store: false,
    };
    providerAttempted = true;
    const apiPromise = client.responses.create(
      request,
      options.signal ? { signal: options.signal } : undefined
    );
    const withResponse = await apiPromise.withResponse();
    response = withResponse.data;
    requestId = withResponse.request_id;

    const usage = normalizeResponseUsage(response);
    if (response.status !== "completed") {
      const reason = response.incomplete_details?.reason ?? response.status ?? "incomplete";
      throw new OpenAIProviderError("[openai] non-stream response incomplete", {
        category: reason === "max_output_tokens" ? "incomplete_max_output" : "response_invalid",
        model: response.model,
        usage,
        requestId,
        responseId: response.id,
        providerCode: reason,
      });
    }
    const refusal = getRefusalText(response);
    if (refusal) {
      throw new OpenAIRefusalError({
        model: response.model,
        usage,
        requestId,
        responseId: response.id,
        providerCode: "model_refusal",
      });
    }
  } catch (error) {
    const normalized = normalizeOpenAIProviderError(error, {
      model: response?.model ?? modelConfig.model,
      usage: response ? normalizeResponseUsage(response) : undefined,
      requestId,
      responseId: response?.id,
    });
    await writeAudit({
      audit: options.audit,
      startedAt,
      success: false,
      errorMessage: `openai_${normalized.category}`,
      model: normalized.model ?? modelConfig.model,
      usage: normalized.usage,
      metadata: buildAuditMetadata({
        modelRole: options.modelRole,
        auditWrapper: options.auditWrapper,
        metadata: options.audit.metadata,
        structuredOutputName: options.textFormat?.name,
        requestId: normalized.requestId,
        responseId: normalized.responseId,
        usageStatus: normalized.usageStatus,
        providerAttempted,
      }),
    });
    throw normalized;
  }

  const usage = normalizeResponseUsage(response);
  const text = response.output_text.trim();
  if (!text) {
    const emptyError = new OpenAIProviderError("[openai] empty response", {
      category: "response_invalid",
      model: response.model,
      usage,
      requestId,
      responseId: response.id,
      providerCode: "empty_response",
    });
    await writeAudit({
      audit: options.audit,
      startedAt,
      success: false,
      errorMessage: "openai_response_invalid",
      model: response.model,
      usage,
      metadata: buildAuditMetadata({
        modelRole: options.modelRole,
        auditWrapper: options.auditWrapper,
        metadata: options.audit.metadata,
        structuredOutputName: options.textFormat?.name,
        requestId,
        responseId: response.id,
        usageStatus: usage ? "complete" : "unknown",
        providerAttempted,
      }),
    });
    throw emptyError;
  }

  let data: T | undefined;
  if (options.parseOutput) {
    try {
      data = options.parseOutput(text);
    } catch (error) {
      await writeAudit({
        audit: options.audit,
        startedAt,
        success: false,
        errorMessage: "structured_output_invalid",
        model: response.model,
        usage,
        metadata: buildAuditMetadata({
          modelRole: options.modelRole,
          auditWrapper: options.auditWrapper,
          metadata: options.audit.metadata,
          structuredOutputName: options.textFormat?.name,
          requestId,
          responseId: response.id,
          usageStatus: usage ? "complete" : "unknown",
          providerAttempted,
        }),
      });
      throw error;
    }
  }

  const usageStatus: OpenAIUsageStatus = usage ? "complete" : "unknown";
  await writeAudit({
    audit: options.audit,
    startedAt,
    success: true,
    errorMessage: null,
    model: response.model,
    usage,
    metadata: buildAuditMetadata({
      modelRole: options.modelRole,
      auditWrapper: options.auditWrapper,
      metadata: options.audit.metadata,
      structuredOutputName: options.textFormat?.name,
      requestId,
      responseId: response.id,
      usageStatus,
      providerAttempted,
    }),
  });

  return {
    text,
    model: response.model,
    usage,
    usageStatus,
    requestId,
    responseId: response.id,
    ...(options.parseOutput ? { data } : {}),
  };
}

export async function createOpenAIResponseWithAudit(
  options: BaseAuditOptions
): Promise<AuditedOpenAIResponse> {
  return createOpenAIResponseWithAuditInternal({
    ...options,
    auditWrapper: "createOpenAIResponseWithAudit",
  });
}

export async function createOpenAIStructuredResponseWithAudit<T>(
  options: BaseAuditOptions & {
    responseFormat: {
      name: string;
      description?: string;
      schema: Record<string, unknown>;
    };
    validate: (value: unknown) => T;
  }
): Promise<AuditedOpenAIStructuredResponse<T>> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.responseFormat.name)) {
    throw new Error("[openai] structured response format name is invalid");
  }
  const textFormat: ResponseFormatTextJSONSchemaConfig = {
    type: "json_schema",
    name: options.responseFormat.name,
    schema: options.responseFormat.schema,
    strict: true,
    ...(options.responseFormat.description
      ? { description: options.responseFormat.description }
      : {}),
  };
  const response = await createOpenAIResponseWithAuditInternal({
    ...options,
    auditWrapper: "createOpenAIStructuredResponseWithAudit",
    textFormat,
    parseOutput: (text) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (cause) {
        throw new OpenAIStructuredOutputError("invalid_json", { cause });
      }
      try {
        return options.validate(parsed);
      } catch (cause) {
        if (cause instanceof OpenAIStructuredOutputError) throw cause;
        throw new OpenAIStructuredOutputError("schema_validation_failed", { cause });
      }
    },
  });
  if (response.data === undefined) {
    throw new OpenAIStructuredOutputError("schema_validation_failed");
  }
  return { ...response, data: response.data };
}
