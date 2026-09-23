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
  estimateInputTokensLocally,
  getOpenAIClient,
  hasInputAttachments,
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
  /**
   * Required privacy/audit gate for every content-bearing provider request of
   * this call, including the input token count. `beforeGeneration` runs after
   * counting because it reserves paid capacity next to the billed generation, so
   * it cannot protect the count — which already carries the full instructions and
   * input to the provider. No caller may opt out: an omitted gate fails closed
   * before any provider request. See handoff §8 P0-5 and §17.3.
   */
  beforeProviderEgress: () => void | Promise<void>;
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
  let providerEgressGateFailed = false;
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
      // 프롬프트 캐싱: 암묵 경계를 켠다.
      //
      // 예전에는 `{ mode: "explicit" }` 로 암묵 경계를 끄고, 아래
      // assertNoPromptCacheBreakpoints 로 명시 경계도 금지해 캐싱을 이중으로
      // 잠가 두었다. 주석의 조건은 "측정 전에는 끈다" 였다.
      //
      // 2026-08-23 그 측정을 했다(스테이징 원장 실측):
      //   호출당 입력 23,000토큰 / 출력 50토큰 — 비용의 99.8%가 입력이다
      //   cache_read_input_tokens 는 전 호출 null — 캐시가 한 번도 안 걸렸다
      //   시스템 프롬프트 441개 갈래를 재니 정적 접두부가 85~100%이고,
      //   서로 다른 두 커플에 대해 **글자 단위로 동일**했다
      //
      // 켜도 모델이 받는 프롬프트는 한 글자도 바뀌지 않는다 — 같은 토큰을
      // 보내고 청구만 달라진다. 그래서 답변 품질에 영향이 없다(파운더 판단
      // 기준: "품질이 절대 떨어져서는 안 된다").
      //
      // 명시 경계는 여전히 금지다(assertNoPromptCacheBreakpoints). 그것을
      // 쓰려면 커플 문맥을 instructions 밖으로 옮겨야 하는데, 그건 프롬프트
      // 구조를 바꾸는 일이라 위 기준에 어긋난다.
      store: false,
    };

    // 토큰 계산도 instructions와 input 원문을 제공자에게 보내는 content-bearing
    // egress다. 개인정보·감사 게이트가 실패하면 count도 create도 시작하지 않고,
    // 감사 행에는 provider 요청이 없었다는 사실만 남는다. gate를 아예 넘기지
    // 않은 호출부도 같은 취급이다 — 빠진 gate는 열린 gate와 같다.
    if (typeof options.beforeProviderEgress !== "function") {
      providerEgressGateFailed = true;
      throw new Error(
        "[ai-config] beforeProviderEgress is required before any content-bearing provider request",
      );
    }
    // 측정 *호출*이 전송·제공자 장애(네트워크·5xx·429·타임아웃)로 죽으면 한 번만
    // 다시 잰다. 측정이 성공하고 그 판정이 막은 것(한도 초과·잘못된 응답)과
    // 호출부의 취소는 다시 재지 않는다.
    let inputCountFailure: OpenAIProviderError | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      // 동의가 바뀐 재시도를 측정 장애로 처리하거나 원문을 다시 보내지 않는다.
      options.signal?.throwIfAborted();
      try {
        await options.beforeProviderEgress();
      } catch (error) {
        providerEgressGateFailed = true;
        throw error;
      }
      options.signal?.throwIfAborted();
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
        inputCountFailure = null;
        break;
      } catch (error) {
        const normalized = markInputCountFailure(error, {
          model: modelConfig.model,
          requestId: inputCountRequestId,
        });
        if (error instanceof OpenAIProviderError || options.signal?.aborted) throw normalized;
        inputCountFailure = normalized;
      }
    }
    if (inputCountFailure) {
      // 두 번 다 실패 — 측정 장애다. 2026-07-25 운영에서 count 만 죽고 create 는
      // 멀쩡했는데 여기서 던져 "안녕" 한 마디까지 전부 AMORA_INPUT_COUNT_UNAVAILABLE
      // 로 죽었다. 그러나 비용 예약은 앱의 입력 상한을 전제로 하므로(b2d2fa1c 가
      // 옛 폴백을 뺀 이유) 상한 없이 진행하지 않고, 보수적 로컬 추정으로 상한을
      // 지킨 뒤에만 생성으로 간다. 건너뛴 사유는 원장 metadata 에 남는다.
      //
      // 첨부(사진·PDF) 턴은 폴백하지 않는다 — 로컬 추정이 첨부를 잴 수 없어
      // (PDF 는 추출 텍스트 + 쪽당 이미지 1장, 최대 100쪽) 상한을 보장하지 못한다.
      // 이전처럼 측정 단계에서 끝낸다.
      if (hasInputAttachments(options.input)) throw inputCountFailure;
      const estimatedInputTokens = estimateInputTokensLocally({
        instructions: options.instructions,
        input: options.input,
      });
      if (estimatedInputTokens > options.maxInputTokens) {
        throw new OpenAIInputTokenLimitError(estimatedInputTokens, options.maxInputTokens, {
          requestId: inputCountFailure.requestId,
        });
      }
      inputCountUnavailableReason =
        inputCountFailure.providerCode ?? inputCountFailure.category;
      console.warn(
        `[amora] input pre-count unavailable after retry (${inputCountUnavailableReason}) — proceeding on a local estimate of ${estimatedInputTokens} tokens`,
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
      errorMessage: providerEgressGateFailed
        ? "provider_egress_gate_failed"
        : beforeGenerationFailed
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
    if (providerEgressGateFailed || beforeGenerationFailed) throw error;
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
