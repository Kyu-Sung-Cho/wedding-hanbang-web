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
  OpenAIInputTokenLimitError,
  OpenAIProviderError,
  OpenAIRefusalError,
  type NormalizedOpenAIUsage,
  type OpenAIRequestStage,
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
  inputCountRequestId?: string | null;
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
  maxInputTokens: number;
  maxOutputTokens: number;
  audit: AuditBase;
  client?: OpenAI;
  startedAt?: number;
  signal?: AbortSignal;
  safetyIdentifierScope?: string;
  /** Required atomic paid-call gate; no audited caller may opt out. */
  beforeGeneration: () => void | Promise<void>;
  /**
   * A durable provider receipt may own the only cost/audit row. The default
   * remains this wrapper's internal audit so unwrapped callers cannot silently
   * lose accounting.
   */
  auditPersistence?: "internal" | "external_provider_receipt";
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
  inputCountRequestId?: string | null;
  inputCountUnavailableReason?: string | null;
  usageStatus?: OpenAIUsageStatus;
  requestStage?: OpenAIRequestStage | null;
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
    input_count_request_id: options.inputCountRequestId ?? null,
    // 사전 토큰 계산을 건너뛴 턴 — null이 아니면 가드레일이 꺼진 채 나간 것이다.
    input_count_unavailable: options.inputCountUnavailableReason ?? null,
    provider_request_stage: options.requestStage ?? null,
    usage_status: options.usageStatus ?? "unknown",
    unknown_paid_attempt:
      options.providerAttempted && options.usageStatus === "unknown",
    provider_attempted: options.providerAttempted,
    ...(options.structuredOutputName
      ? { structured_output: true, schema_name: options.structuredOutputName }
      : {}),
  };
}

function markInputCountFailure(
  error: unknown,
  context: { model: string; requestId?: string | null },
): OpenAIProviderError {
  const normalized = normalizeOpenAIProviderError(error, context);
  if (normalized.requestStage) return normalized;
  return new OpenAIProviderError(normalized.message, {
    category: normalized.category,
    model: normalized.model ?? context.model,
    usage: normalized.usage,
    usageStatus: normalized.usageStatus,
    requestId: normalized.requestId,
    responseId: normalized.responseId,
    providerCode: normalized.providerCode,
    requestStage: "input_count",
  });
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
  const writeOwnedAudit: typeof writeAudit =
    options.auditPersistence === "external_provider_receipt"
      ? async (): Promise<void> => undefined
      : writeAudit;
  const modelConfig = getAmoraModelConfig(options.modelRole);
  const safetyIdentifier = createSafetyIdentifier(
    options.safetyIdentifierScope ??
      options.audit.userId ??
      options.audit.coupleId ??
      options.audit.sessionId
  );
  let requestId: string | null | undefined;
  let inputCountRequestId: string | null | undefined;
  // 사전 토큰 계산이 불가능했던 이유 — 원장에 남겨 장애를 눈에 보이게 한다.
  let inputCountUnavailableReason: string | null = null;
  let response: OpenAIResponse | undefined;
  let providerAttempted = false;
  let beforeGenerationFailed = false;

  try {
    // 주입된 클라이언트도 운영 kill switch를 우회하지 못한다.
    assertOpenAIProviderEnabled();
    assertAmoraOutputTokenLimit(options.maxOutputTokens);
    if (!Number.isSafeInteger(options.maxInputTokens) || options.maxInputTokens < 1) {
      throw new Error("[ai-config] maxInputTokens must be a positive integer");
    }
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

    try {
      const countPromise = client.responses.inputTokens.count(
        {
          model: request.model,
          instructions: request.instructions,
          input: request.input,
          reasoning: request.reasoning,
          text: request.text,
        },
        options.signal ? { signal: options.signal } : undefined,
      );
      const counted = await countPromise.withResponse();
      inputCountRequestId = counted.request_id;
      if (
        !Number.isSafeInteger(counted.data.input_tokens)
        || counted.data.input_tokens < 0
      ) {
        throw new OpenAIProviderError("[openai] invalid input token count", {
          category: "response_invalid",
          model: modelConfig.model,
          requestId: counted.request_id,
          providerCode: "invalid_input_token_count",
          requestStage: "input_count",
          usageStatus: "complete",
        });
      }
      if (counted.data.input_tokens > options.maxInputTokens) {
        throw new OpenAIInputTokenLimitError(
          counted.data.input_tokens,
          options.maxInputTokens,
          { requestId: counted.request_id },
        );
      }
    } catch (error) {
      const normalized = markInputCountFailure(error, {
        model: modelConfig.model,
        requestId: inputCountRequestId,
      });
      // 측정에 성공했고 그 값이 한도를 넘은 경우는 그대로 막는다.
      if (error instanceof OpenAIInputTokenLimitError) throw normalized;
      // 측정 자체가 실패한 것은 사전 점검의 실패지 대화의 실패가 아니다.
      // 여기서 던지면 선택적 가드레일 하나가 서비스 전체를 멈춘다 —
      // 2026-07-25 운영에서 실제로 inputTokens.count가 계속 실패하며 모든 턴이
      // AMORA_INPUT_COUNT_UNAVAILABLE로 죽었다("안녕" 한 마디까지).
      // 과대 입력은 제공자가 스스로 거부하고 그 경로(input_token_limit)는 이미
      // 처리돼 있으므로, 측정 불가일 때는 본 호출로 진행한다.
      inputCountUnavailableReason =
        normalized.providerCode ?? normalized.category ?? "unknown";
      console.warn(
        `[amora] input token pre-count unavailable (${inputCountUnavailableReason}) — proceeding without it`,
      );
    }

    options.signal?.throwIfAborted();
    try {
      await options.beforeGeneration();
    } catch (error) {
      beforeGenerationFailed = true;
      throw error;
    }
    options.signal?.throwIfAborted();
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
    await writeOwnedAudit({
      audit: options.audit,
      startedAt,
      success: false,
      errorMessage: beforeGenerationFailed
        ? "pre_generation_gate_failed"
        : `openai_${normalized.category}`,
      model: normalized.model ?? modelConfig.model,
      usage: normalized.usage,
      metadata: buildAuditMetadata({
        modelRole: options.modelRole,
        auditWrapper: options.auditWrapper,
        metadata: options.audit.metadata,
        structuredOutputName: options.textFormat?.name,
        requestId:
          normalized.requestStage === "input_count"
            ? null
            : normalized.requestId,
        responseId: normalized.responseId,
        inputCountRequestId:
          normalized.requestStage === "input_count"
            ? normalized.requestId
            : inputCountRequestId,
        usageStatus: providerAttempted ? normalized.usageStatus : "complete",
        requestStage: normalized.requestStage,
        providerAttempted,
      }),
    });
    if (beforeGenerationFailed) throw error;
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
    await writeOwnedAudit({
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
        inputCountRequestId,
        inputCountUnavailableReason,
        usageStatus: usage ? "complete" : "unknown",
        requestStage: "generation",
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
      await writeOwnedAudit({
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
          inputCountRequestId,
          inputCountUnavailableReason,
          usageStatus: usage ? "complete" : "unknown",
          requestStage: "generation",
          providerAttempted,
        }),
      });
      throw error;
    }
  }

  const usageStatus: OpenAIUsageStatus = usage ? "complete" : "unknown";
  await writeOwnedAudit({
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
      inputCountRequestId,
      inputCountUnavailableReason,
      usageStatus,
      requestStage: "generation",
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
    inputCountRequestId,
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
