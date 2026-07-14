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

export interface AuditedOpenAIStructuredResponse<T> extends AuditedOpenAIResponse {
  data: T;
}

export class OpenAIStructuredOutputError extends Error {
  constructor(
    readonly code: "invalid_json" | "schema_validation_failed",
    options?: { cause?: unknown },
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
  /** Stable provider key for retrying one already-reserved logical request. */
  idempotencyKey?: string;
  /** Stable key for exactly-once persistence of the validated success audit. */
  successAuditIdempotencyKey?: string;
  /** Stable logical scope for provider abuse/safety correlation. */
  safetyIdentifierScope?: string;
}

interface InternalAuditOptions<T> extends BaseAuditOptions {
  auditWrapper: string;
  textFormat?: ResponseFormatTextJSONSchemaConfig;
  parseOutput?: (text: string) => T;
  /** Runs after strict validation and before the required success audit. */
  onValidated?: (
    data: T,
    response: Pick<AuditedOpenAIResponse, "model" | "usage">,
  ) => Promise<void>;
}

export function buildAuditedOpenAIMetadata(options: {
  modelRole: AmoraModelRole;
  auditWrapper: string;
  metadata?: Record<string, unknown> | null;
  structuredOutputName?: string;
}): Record<string, unknown> {
  const modelConfig = getAmoraModelConfig(options.modelRole);
  return {
    ...(options.metadata ?? {}),
    ai_provider: "openai",
    quota_class: "provider_call",
    model_role: options.modelRole,
    reasoning_effort: modelConfig.reasoningEffort,
    audit_wrapper: options.auditWrapper,
    ...(options.structuredOutputName
      ? { structured_output: true, schema_name: options.structuredOutputName }
      : {}),
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

async function createOpenAIResponseWithAuditInternal<T>(
  options: InternalAuditOptions<T>,
): Promise<AuditedOpenAIResponse & { data?: T }> {
  const startedAt = options.startedAt ?? startLatencyClock();
  const modelConfig = getAmoraModelConfig(options.modelRole);
  if (
    options.successAuditIdempotencyKey
    && !/^[a-f0-9]{64}$/.test(options.successAuditIdempotencyKey)
  ) {
    throw new Error("[openai] success audit idempotency key must be a 64-character lowercase hex digest.");
  }
  const safetyIdentifier = createSafetyIdentifier(
    options.safetyIdentifierScope
      ?? options.audit.userId
      ?? options.audit.coupleId
      ?? options.audit.sessionId
  );

  const auditMetadata = buildAuditedOpenAIMetadata({
    modelRole: options.modelRole,
    auditWrapper: options.auditWrapper,
    metadata: options.audit.metadata,
    structuredOutputName: options.textFormat?.name,
  });
  let response: OpenAIResponse;

  // Provider/response failures are audited here. The success audit below is
  // deliberately outside this catch so an audit outage cannot be misclassified
  // as a second provider failure or discard the response usage.
  try {
    assertAmoraOutputTokenLimit(options.maxOutputTokens);
    options.signal?.throwIfAborted();
    if (options.idempotencyKey && !/^[a-f0-9]{64}$/.test(options.idempotencyKey)) {
      throw new Error("[openai] idempotency key must be a 64-character lowercase hex digest.");
    }
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
      // implicit cache breakpoint를 끄고 explicit breakpoint도 두지 않는다.
      // 이 요청 설정은 애플리케이션 cache write만 제어하며 ZDR을 뜻하지 않는다.
      prompt_cache_options: { mode: "explicit" },
      store: false,
    };
    const requestOptions = {
      ...(options.signal ? { signal: options.signal } : {}),
      // openai-node exposes `idempotencyKey`, but the OpenAI client does not
      // configure an idempotencyHeader, so that option alone sends nothing.
      // Set the header explicitly. The court cost fence still treats a lost or
      // unknown provider response as terminal; it never assumes this header
      // guarantees safe replay.
      ...(options.idempotencyKey
        ? { headers: { "Idempotency-Key": options.idempotencyKey } }
        : {}),
    };
    response = options.signal || options.idempotencyKey
      ? await client.responses.create(request, requestOptions)
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

  let data: T | undefined;
  if (hasOutput && options.parseOutput) {
    try {
      data = options.parseOutput(text);
    } catch (error) {
      await logAIInteraction({
        ...options.audit,
        required: true,
        userInput: null,
        aiOutput: null,
        latencyMs: elapsedMs(startedAt),
        success: false,
        errorMessage: "structured_output_invalid",
        model: response.model,
        tokensInput: response.usage?.input_tokens ?? null,
        tokensOutput: response.usage?.output_tokens ?? null,
        cacheWriteTokens: response.usage?.input_tokens_details?.cache_write_tokens ?? null,
        cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens ?? null,
        metadata: auditMetadata,
      });
      throw error;
    }
  }

  let validatedCallbackError: unknown;
  if (data !== undefined && options.onValidated) {
    try {
      await options.onValidated(data, {
        model: response.model,
        usage: response.usage
          ? {
              input_tokens: response.usage.input_tokens,
              output_tokens: response.usage.output_tokens,
              cache_write_input_tokens:
                response.usage.input_tokens_details?.cache_write_tokens ?? 0,
              cached_input_tokens:
                response.usage.input_tokens_details?.cached_tokens ?? 0,
            }
          : undefined,
      });
    } catch (error) {
      // The provider still completed successfully and incurred usage. Record
      // that paid event exactly once; a stage/consumer failure is not a second
      // provider failure and must not duplicate cost in the AI ledger.
      validatedCallbackError = error;
      console.error("OPENAI_VALIDATED_RESULT_CALLBACK_FAILED");
    }
  }

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
    idempotencyKey: options.successAuditIdempotencyKey,
  });

  if (validatedCallbackError !== undefined) {
    throw validatedCallbackError;
  }

  if (!hasOutput) {
    // The failed audit was already written above. Throw outside the provider
    // catch so callers fail closed without creating a duplicate audit row.
    if (options.parseOutput) {
      throw new OpenAIStructuredOutputError("invalid_json");
    }
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
    ...(options.parseOutput ? { data } : {}),
  };
}

export async function createOpenAIResponseWithAudit(
  options: BaseAuditOptions,
): Promise<AuditedOpenAIResponse> {
  return createOpenAIResponseWithAuditInternal({
    ...options,
    auditWrapper: "createOpenAIResponseWithAudit",
  });
}

export async function createOpenAIStructuredResponseWithAudit<T>(options: BaseAuditOptions & {
  responseFormat: {
    name: string;
    description?: string;
    schema: Record<string, unknown>;
  };
  validate: (value: unknown) => T;
  onValidated?: (
    data: T,
    response: Pick<AuditedOpenAIResponse, "model" | "usage">,
  ) => Promise<void>;
}): Promise<AuditedOpenAIStructuredResponse<T>> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.responseFormat.name)) {
    throw new Error("[openai] structured response format name is invalid.");
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
