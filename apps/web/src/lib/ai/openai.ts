import OpenAI, {
  APIConnectionTimeoutError,
  APIUserAbortError,
} from "openai";
import Ajv, { type ValidateFunction } from "ajv";
import type {
  EasyInputMessage,
  FunctionTool,
  Response as OpenAIResponse,
  ResponseCreateParamsStreaming,
  ResponseInput,
  ResponseInputItem,
  ResponseInputMessageContentList,
  ResponseOutputItem,
  ResponseStreamEvent,
  ToolChoiceFunction,
} from "openai/resources/responses/responses";
import {
  assertAmoraOutputTokenLimit,
  getAmoraModelConfig,
  hasOpenAIConfig,
  MAX_AMORA_OUTPUT_TOKENS,
  type AmoraModelRole,
} from "@/lib/ai/modelConfig";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import { createSafetyIdentifier } from "@/lib/ai/safetyIdentifier";

let defaultClient: OpenAI | null = null;
const schemaValidator = new Ajv({
  allErrors: true,
  strict: false,
  strictNumbers: true,
  coerceTypes: false,
});
const compiledToolSchemas = new WeakMap<object, ValidateFunction>();
const FUNCTION_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_FUNCTION_CALL_ID_LENGTH = 128;

export type OpenAIUsageStatus = "complete" | "unknown";
export type OpenAIRequestStage = "input_count" | "generation";
export type OpenAIErrorCategory =
  | "auth_config"
  | "rate_limit"
  | "timeout"
  | "aborted"
  | "invalid_request"
  | "provider_5xx"
  | "incomplete_max_output"
  | "refusal"
  | "transport"
  | "response_invalid";

export interface NormalizedOpenAIUsage {
  input_tokens: number;
  output_tokens: number;
  cache_write_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ProviderErrorDetails {
  category: OpenAIErrorCategory;
  model?: string;
  usage?: NormalizedOpenAIUsage;
  usageStatus?: OpenAIUsageStatus;
  requestId?: string | null;
  responseId?: string | null;
  providerCode?: string | null;
  requestStage?: OpenAIRequestStage | null;
}

export class OpenAIProviderError extends Error {
  readonly category: OpenAIErrorCategory;
  readonly model?: string;
  readonly usage?: NormalizedOpenAIUsage;
  readonly usageStatus: OpenAIUsageStatus;
  readonly requestId?: string | null;
  readonly responseId?: string | null;
  readonly providerCode?: string | null;
  readonly requestStage?: OpenAIRequestStage | null;

  constructor(message: string, details: ProviderErrorDetails) {
    super(message);
    this.name = "OpenAIProviderError";
    this.category = details.category;
    this.model = details.model;
    this.usage = details.usage;
    this.usageStatus = details.usageStatus ?? (details.usage ? "complete" : "unknown");
    this.requestId = details.requestId;
    this.responseId = details.responseId;
    this.providerCode = details.providerCode;
    this.requestStage = details.requestStage;
  }
}

export class OpenAIRefusalError extends OpenAIProviderError {
  constructor(details: Omit<ProviderErrorDetails, "category">) {
    super("[openai] model refusal", { ...details, category: "refusal" });
    this.name = "OpenAIRefusalError";
  }
}

export class OpenAIInputTokenLimitError extends OpenAIProviderError {
  constructor(
    readonly inputTokens: number,
    readonly maxInputTokens: number,
    details: Pick<ProviderErrorDetails, "requestId"> = {}
  ) {
    super("[openai] input token limit exceeded", {
      category: "invalid_request",
      usageStatus: "complete",
      requestId: details.requestId,
      providerCode: "input_token_limit",
      requestStage: "input_count",
    });
    this.name = "OpenAIInputTokenLimitError";
  }
}

function cleanProviderToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
  return cleaned || null;
}

function categorizeProviderError(error: unknown): OpenAIErrorCategory {
  if (error instanceof APIUserAbortError) return "aborted";
  if (error instanceof APIConnectionTimeoutError) return "timeout";
  const record = error && typeof error === "object"
    ? (error as { name?: unknown; status?: unknown; code?: unknown; type?: unknown })
    : {};
  const name = typeof record.name === "string" ? record.name.toLowerCase() : "";
  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
  const status = typeof record.status === "number" ? record.status : null;
  if (name === "aborterror" || code === "aborted") return "aborted";
  if (name.includes("timeout") || code.includes("timeout")) return "timeout";
  if (status === 401 || status === 403) return "auth_config";
  if (status === 429) return "rate_limit";
  if (status !== null && status >= 500) return "provider_5xx";
  if (status !== null && status >= 400) return "invalid_request";
  return "transport";
}

export function normalizeOpenAIProviderError(
  error: unknown,
  context: Pick<ProviderErrorDetails, "model" | "usage" | "requestId" | "responseId"> = {}
): OpenAIProviderError {
  if (error instanceof OpenAIProviderError) return error;
  const record = error && typeof error === "object"
    ? (error as {
        requestID?: unknown;
        request_id?: unknown;
        _request_id?: unknown;
        code?: unknown;
        type?: unknown;
      })
    : {};
  const requestId =
    cleanProviderToken(record.requestID) ??
    cleanProviderToken(record.request_id) ??
    cleanProviderToken(record._request_id) ??
    context.requestId;
  return new OpenAIProviderError("[openai] provider request failed", {
    category: categorizeProviderError(error),
    ...context,
    requestId,
    providerCode: cleanProviderToken(record.code) ?? cleanProviderToken(record.type),
    usageStatus: context.usage ? "complete" : "unknown",
  });
}

function markOpenAIRequestStage(
  error: unknown,
  requestStage: OpenAIRequestStage,
  context: Pick<
    ProviderErrorDetails,
    "model" | "usage" | "requestId" | "responseId"
  >,
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
    requestStage,
  });
}

export function getSafeOpenAIErrorMetadata(error: unknown): Record<string, unknown> {
  const normalized = normalizeOpenAIProviderError(error);
  const isInputCountRequest = normalized.requestStage === "input_count";
  return {
    ai_provider: "openai",
    provider_error_category: normalized.category,
    provider_error_code: normalized.providerCode ?? null,
    provider_request_id: isInputCountRequest ? null : (normalized.requestId ?? null),
    input_count_request_id: isInputCountRequest ? (normalized.requestId ?? null) : null,
    provider_response_id: normalized.responseId ?? null,
    provider_request_stage: normalized.requestStage ?? null,
    usage_status: normalized.usageStatus,
    unknown_paid_attempt:
      !isInputCountRequest && normalized.usageStatus === "unknown",
  };
}

export function assertOpenAIProviderEnabled(): void {
  if (!hasOpenAIConfig()) {
    throw new OpenAIProviderError("[ai-config] OpenAI is not enabled", {
      category: "auth_config",
      providerCode: "openai_not_enabled",
      usageStatus: "complete",
    });
  }
}

export function getOpenAIClient(): OpenAI {
  assertOpenAIProviderEnabled();
  const apiKey = process.env.OPENAI_API_KEY!.trim();
  if (!defaultClient) {
    defaultClient = new OpenAI({
      apiKey,
      // 생성 자동 재시도는 부분 성공 뒤 중복 과금을 숨길 수 있어 끈다.
      maxRetries: 0,
      timeout: 90_000,
    });
  }
  return defaultClient;
}

export interface ToolCallBlock {
  callId: string;
  name: string;
  input: Record<string, unknown>;
  parseError?: "invalid_json" | "invalid_shape" | "schema_validation";
}

export interface ChatWithToolsResult {
  fullText: string;
  toolCalls: ToolCallBlock[];
  outputItems: ResponseInputItem[];
  stopReason: string;
  usage?: NormalizedOpenAIUsage;
  usageStatus: OpenAIUsageStatus;
  model?: string;
  requestId?: string | null;
  responseId?: string | null;
  inputCountRequestId?: string | null;
  /** 사전 토큰 계산을 건너뛴 턴의 사유. null이면 정상적으로 측정했다. */
  inputCountUnavailableReason?: string | null;
}

export type AttachmentMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "application/pdf";

export interface ImageAttachment {
  base64: string;
  mediaType: AttachmentMediaType;
  fileName?: string;
}

export type ChatMessageInput = EasyInputMessage;
export type ChatResponseInput = string | ResponseInput;
export type ChatInputItem = ResponseInputItem;

export function buildMultimodalContent(
  text: string,
  attachments?: ImageAttachment[]
): string | ResponseInputMessageContentList {
  if (!attachments || attachments.length === 0) return text;

  const content: ResponseInputMessageContentList = [];
  for (const attachment of attachments) {
    if (attachment.mediaType === "application/pdf") {
      content.push({
        type: "input_file",
        filename: attachment.fileName || "attachment.pdf",
        file_data: `data:application/pdf;base64,${attachment.base64}`,
        // GPT-5.6 PDF auto/high rendering은 입력 토큰이 크게 늘 수 있다.
        detail: "low",
      });
    } else {
      content.push({
        type: "input_image",
        // 원본/auto는 큰 이미지의 입력 토큰과 지연을 급증시킬 수 있다.
        detail: "low",
        image_url: `data:${attachment.mediaType};base64,${attachment.base64}`,
      });
    }
  }
  if (text) content.push({ type: "input_text", text });
  return content;
}

function toOpenAITools(tools: AiToolDefinition[]): FunctionTool[] {
  const names = new Set<string>();
  return tools.map((tool) => {
    if (!FUNCTION_NAME_RE.test(tool.name) || names.has(tool.name)) {
      throw new OpenAIProviderError("[openai] invalid tool name", {
        category: "invalid_request",
        providerCode: "invalid_tool_name",
        usageStatus: "complete",
      });
    }
    names.add(tool.name);
    getToolValidator(tool);
    return {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
      // 기존 스키마 정규화 전에는 strict=true가 공급자 400을 만들 수 있다.
      // 현재는 AJV 실행 경계가 잘못된 인자를 fail-closed 한다.
      strict: false,
    };
  });
}

function getPriorFunctionCallIds(input: string | ResponseInput): Set<string> {
  const callIds = new Set<string>();
  if (typeof input === "string") return callIds;

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const record = item as { type?: unknown; call_id?: unknown };
    if (
      (record.type === "function_call" || record.type === "function_call_output") &&
      typeof record.call_id === "string"
    ) {
      callIds.add(record.call_id);
    }
  }
  return callIds;
}

function assertValidFunctionCalls(
  functionCalls: Array<Extract<ResponseOutputItem, { type: "function_call" }>>,
  tools: AiToolDefinition[],
  input: string | ResponseInput,
  context: Pick<
    ProviderErrorDetails,
    "model" | "usage" | "usageStatus" | "requestId" | "responseId"
  >
): void {
  const allowedNames = new Set(tools.map((tool) => tool.name));
  const seenCallIds = getPriorFunctionCallIds(input);

  for (const item of functionCalls) {
    if (item.status !== "completed") {
      throw new OpenAIProviderError("[openai] incomplete function call", {
        category: "response_invalid",
        ...context,
        providerCode: "invalid_function_call_status",
      });
    }

    if (
      typeof item.call_id !== "string" ||
      item.call_id.trim().length === 0 ||
      item.call_id.length > MAX_FUNCTION_CALL_ID_LENGTH
    ) {
      throw new OpenAIProviderError("[openai] invalid function call id", {
        category: "response_invalid",
        ...context,
        providerCode: "invalid_function_call_id",
      });
    }

    if (!FUNCTION_NAME_RE.test(item.name) || !allowedNames.has(item.name)) {
      throw new OpenAIProviderError("[openai] invalid function call name", {
        category: "response_invalid",
        ...context,
        providerCode: "invalid_function_call_name",
      });
    }

    if (seenCallIds.has(item.call_id)) {
      throw new OpenAIProviderError("[openai] duplicate function call id", {
        category: "response_invalid",
        ...context,
        providerCode: "duplicate_function_call_id",
      });
    }
    seenCallIds.add(item.call_id);
  }
}

function parseToolArguments(value: string): {
  input: Record<string, unknown>;
  parseError?: "invalid_json" | "invalid_shape";
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { input: {}, parseError: "invalid_json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { input: {}, parseError: "invalid_shape" };
  }
  return { input: parsed as Record<string, unknown> };
}

function getToolValidator(tool: AiToolDefinition): ValidateFunction {
  if (!tool.input_schema || typeof tool.input_schema !== "object") {
    throw new OpenAIProviderError("[openai] invalid tool schema", {
      category: "invalid_request",
      providerCode: "invalid_tool_schema",
      usageStatus: "complete",
    });
  }
  const schema = tool.input_schema as object;
  let validate = compiledToolSchemas.get(schema);
  if (!validate) {
    try {
      validate = schemaValidator.compile(schema);
    } catch {
      throw new OpenAIProviderError("[openai] invalid tool schema", {
        category: "invalid_request",
        providerCode: "invalid_tool_schema",
        usageStatus: "complete",
      });
    }
    compiledToolSchemas.set(schema, validate);
  }
  return validate;
}

function validateToolInput(
  tool: AiToolDefinition | undefined,
  input: Record<string, unknown>
): boolean {
  if (!tool) return false;
  const validate = getToolValidator(tool);
  return validate(input) === true;
}

export function assertNoPromptCacheBreakpoints(input: string | ResponseInput): void {
  if (typeof input === "string") return;
  const stack: unknown[] = [input];
  const seen = new Set<object>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Object.prototype.hasOwnProperty.call(current, "prompt_cache_breakpoint")) {
      throw new OpenAIProviderError("[openai] prompt cache breakpoint is disabled", {
        category: "invalid_request",
        providerCode: "prompt_cache_disabled",
        usageStatus: "complete",
      });
    }
    for (const value of Object.values(current)) stack.push(value);
  }
}

function getRefusalText(response: OpenAIResponse): string {
  return response.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content)
    .filter((content) => content.type === "refusal")
    .map((content) => content.refusal)
    .join("");
}

export function normalizeResponseUsage(
  response: OpenAIResponse
): NormalizedOpenAIUsage | undefined {
  if (!response.usage) return undefined;
  return {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_write_input_tokens:
      response.usage.input_tokens_details?.cache_write_tokens || undefined,
    cache_read_input_tokens:
      response.usage.input_tokens_details?.cached_tokens || undefined,
  };
}

function getReplayableOutputItems(
  output: ResponseOutputItem[],
  context: Pick<
    ProviderErrorDetails,
    "model" | "usage" | "usageStatus" | "requestId" | "responseId"
  >
): ResponseInputItem[] {
  for (const item of output) {
    if (item.type !== "message" && item.type !== "function_call" && item.type !== "reasoning") {
      throw new OpenAIProviderError("[openai] unsupported output item", {
        category: "response_invalid",
        ...context,
        providerCode: `unsupported_${item.type}`,
      });
    }
  }
  return output as ResponseInputItem[];
}

export async function chatWithToolsStream(options: {
  systemPrompt: string;
  input: string | ResponseInput;
  tools: AiToolDefinition[];
  onTextDelta?: (text: string) => void;
  maxOutputTokens?: number;
  /** Required exact provider-count ceiling; no generation may skip this gate. */
  maxInputTokens: number;
  safetyIdentifierScope?: string;
  modelRole?: AmoraModelRole;
  toolChoice?: ToolChoiceFunction;
  signal?: AbortSignal;
  /** Required atomic paid-call gate; callers cannot silently opt out. */
  beforeGeneration: () => void | Promise<void>;
  client?: OpenAI;
}): Promise<ChatWithToolsResult> {
  const {
    systemPrompt,
    input,
    tools,
    onTextDelta,
    maxOutputTokens = MAX_AMORA_OUTPUT_TOKENS,
    maxInputTokens,
    safetyIdentifierScope,
    modelRole = "fast",
    toolChoice,
    signal,
    beforeGeneration,
    client: providedClient,
  } = options;
  // 테스트/DI 클라이언트도 운영 kill switch와 설정 검증을 우회할 수 없다.
  assertOpenAIProviderEnabled();
  signal?.throwIfAborted();
  assertAmoraOutputTokenLimit(maxOutputTokens);
  assertNoPromptCacheBreakpoints(input);
  const client = providedClient ?? getOpenAIClient();
  const modelConfig = getAmoraModelConfig(modelRole);
  const safetyIdentifier = createSafetyIdentifier(safetyIdentifierScope);
  const openAITools = toOpenAITools(tools);
  if (toolChoice && !tools.some((tool) => tool.name === toolChoice.name)) {
    throw new OpenAIProviderError("[ai-config] forced tool is not available", {
      category: "invalid_request",
      providerCode: "forced_tool_unavailable",
      usageStatus: "complete",
    });
  }
  let inputCountRequestId: string | null | undefined;
  // 사전 토큰 계산을 건너뛴 턴 — 호출부가 원장에 남길 수 있게 반환한다.
  let inputCountUnavailableReason: string | null = null;

  if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens <= 0) {
    throw new Error("[ai-config] maxInputTokens must be a positive integer");
  }
  try {
    const countPromise = client.responses.inputTokens.count(
      {
        model: modelConfig.model,
        instructions: systemPrompt,
        input,
        tools: openAITools,
        parallel_tool_calls: false,
        reasoning: { effort: modelConfig.reasoningEffort },
        text: { verbosity: modelConfig.verbosity },
      },
      signal ? { signal } : undefined
    );
    const counted = await countPromise.withResponse();
    inputCountRequestId = counted.request_id;
    if (
      !Number.isSafeInteger(counted.data.input_tokens) ||
      counted.data.input_tokens < 0
    ) {
      throw new OpenAIProviderError("[openai] invalid input token count", {
        category: "response_invalid",
        requestId: counted.request_id,
        providerCode: "invalid_input_token_count",
        requestStage: "input_count",
        usageStatus: "complete",
      });
    }
    if (counted.data.input_tokens > maxInputTokens) {
      throw new OpenAIInputTokenLimitError(
        counted.data.input_tokens,
        maxInputTokens,
        { requestId: counted.request_id }
      );
    }
  } catch (error) {
    const staged = markOpenAIRequestStage(error, "input_count", {
      model: modelConfig.model,
    });
    // 측정에 성공했고 그 값이 한도를 넘은 경우만 막는다.
    if (error instanceof OpenAIInputTokenLimitError) throw staged;
    // 측정 자체가 실패한 것은 사전 점검의 실패지 대화의 실패가 아니다.
    // 여기서 던지면 선택적 가드레일 하나가 채팅 전체를 멈춘다 — 2026-07-25
    // 운영에서 실제로 이 경로가 계속 실패하며 "안녕" 한 마디까지 죽었다.
    // 과대 입력은 제공자가 스스로 거부하고 그 경로는 아래에서 처리된다.
    inputCountUnavailableReason =
      staged instanceof OpenAIProviderError
        ? staged.providerCode ?? staged.category ?? "unknown"
        : "unknown";
    console.warn(
      `[amora] streaming input pre-count unavailable (${inputCountUnavailableReason}) — proceeding without it`,
    );
  }

  const requestBody: ResponseCreateParamsStreaming = {
    model: modelConfig.model,
    instructions: systemPrompt,
    input,
    tools: openAITools,
    tool_choice: toolChoice ?? "auto",
    parallel_tool_calls: false,
    max_output_tokens: maxOutputTokens,
    reasoning: { effort: modelConfig.reasoningEffort },
    text: { verbosity: modelConfig.verbosity },
    include: ["reasoning.encrypted_content"],
    safety_identifier: safetyIdentifier,
    service_tier: "default",
    // 캐시 쓰기는 1.25배이고 개인정보 설정을 대신하지 않는다. 측정 전에는 끈다.
    prompt_cache_options: { mode: "explicit" },
    store: false,
    stream: true,
  };

  // The hook is a final application-side gate (for example, an atomic quota
  // reservation). It runs after any configured exact input validation and as
  // close as possible to the first paid generation request.
  signal?.throwIfAborted();
  await beforeGeneration();
  signal?.throwIfAborted();

  let stream: AsyncIterable<ResponseStreamEvent>;
  let requestId: string | null | undefined;
  try {
    const request = client.responses.create(
      requestBody,
      signal ? { signal } : undefined
    );
    const withResponse = await request.withResponse();
    stream = withResponse.data;
    requestId = withResponse.request_id;
  } catch (error) {
    const normalized = normalizeOpenAIProviderError(error, { model: modelConfig.model });
    if (normalized.requestStage) throw normalized;
    throw new OpenAIProviderError(normalized.message, {
      category: normalized.category,
      model: normalized.model ?? modelConfig.model,
      usage: normalized.usage,
      usageStatus: normalized.usageStatus,
      requestId: normalized.requestId,
      responseId: normalized.responseId,
      providerCode: normalized.providerCode,
      requestStage: "generation",
    });
  }

  let fullText = "";
  let refusalText = "";
  let finalResponse: OpenAIResponse | null = null;
  let responseId: string | null | undefined;
  let truncatedByMaxOutput = false;
  try {
    for await (const event of stream) {
      signal?.throwIfAborted();
      if (event.type === "response.created") {
        responseId = event.response.id;
      } else if (event.type === "response.output_text.delta") {
        fullText += event.delta;
        onTextDelta?.(event.delta);
      } else if (event.type === "response.refusal.delta") {
        refusalText += event.delta;
        onTextDelta?.(event.delta);
      } else if (event.type === "response.refusal.done" && !refusalText) {
        refusalText = event.refusal;
        onTextDelta?.(event.refusal);
      } else if (event.type === "response.completed") {
        finalResponse = event.response;
        responseId = event.response.id;
      } else if (event.type === "response.incomplete") {
        const usage = normalizeResponseUsage(event.response);
        const reason = event.response.incomplete_details?.reason ?? "incomplete";
        // 출력 상한에 걸렸어도 이미 사용자 화면에 스트리밍된 답변이 있으면 버리지 않는다.
        // (예전엔 여기서 throw → text_clear로 방금 읽던 답변이 사라지고 일반 오류가 떴다.)
        if (reason === "max_output_tokens" && (fullText.trim() || refusalText.trim())) {
          finalResponse = event.response;
          responseId = event.response.id;
          truncatedByMaxOutput = true;
          continue;
        }
        throw new OpenAIProviderError("[openai] incomplete response", {
          category: reason === "max_output_tokens" ? "incomplete_max_output" : "response_invalid",
          model: event.response.model,
          usage,
          usageStatus: usage ? "complete" : "unknown",
          requestId,
          responseId: event.response.id,
          providerCode: cleanProviderToken(reason),
        });
      } else if (event.type === "response.failed") {
        const usage = normalizeResponseUsage(event.response);
        throw new OpenAIProviderError("[openai] failed response", {
          category: "response_invalid",
          model: event.response.model,
          usage,
          usageStatus: usage ? "complete" : "unknown",
          requestId,
          responseId: event.response.id,
          providerCode: cleanProviderToken(event.response.error?.code) ?? "response_failed",
        });
      } else if (event.type === "error") {
        throw new OpenAIProviderError("[openai] stream error", {
          category: "transport",
          model: modelConfig.model,
          usageStatus: "unknown",
          requestId,
          responseId,
          providerCode: cleanProviderToken(event.code) ?? "stream_error",
        });
      }
    }
  } catch (error) {
    throw markOpenAIRequestStage(error, "generation", {
      model: finalResponse?.model ?? modelConfig.model,
      usage: finalResponse ? normalizeResponseUsage(finalResponse) : undefined,
      requestId,
      responseId,
    });
  }

  if (!finalResponse) {
    throw new OpenAIProviderError("[openai] missing completed response", {
      category: "response_invalid",
      model: modelConfig.model,
      usageStatus: "unknown",
      requestId,
      responseId,
      providerCode: "missing_completed_response",
    });
  }

  const usage = normalizeResponseUsage(finalResponse);
  const functionCallItems = finalResponse.output.filter(
    (item): item is Extract<ResponseOutputItem, { type: "function_call" }> =>
      item.type === "function_call"
  );
  assertValidFunctionCalls(functionCallItems, tools, input, {
    model: finalResponse.model,
    usage,
    usageStatus: usage ? "complete" : "unknown",
    requestId,
    responseId: finalResponse.id,
  });
  if (functionCallItems.length > 1) {
    throw new OpenAIProviderError("[openai] too many function calls", {
      category: "response_invalid",
      model: finalResponse.model,
      usage,
      requestId,
      responseId: finalResponse.id,
      providerCode: "too_many_function_calls",
    });
  }

  const toolCalls = functionCallItems.map((item) => {
    const parsed = parseToolArguments(item.arguments);
    const parseError: ToolCallBlock["parseError"] =
      parsed.parseError ??
      (validateToolInput(
        tools.find((tool) => tool.name === item.name),
        parsed.input
      )
        ? undefined
        : "schema_validation");
    return {
      callId: item.call_id,
      name: item.name,
      input: parsed.input,
      parseError,
    };
  });

  const resolvedRefusal = getRefusalText(finalResponse) || refusalText;
  const resolvedText = finalResponse.output_text || resolvedRefusal || fullText || "";
  if (!resolvedText && toolCalls.length === 0) {
    throw new OpenAIProviderError("[openai] empty response", {
      category: "response_invalid",
      model: finalResponse.model,
      usage,
      requestId,
      responseId: finalResponse.id,
      providerCode: "empty_response",
    });
  }

  return {
    fullText: resolvedText,
    toolCalls,
    outputItems: getReplayableOutputItems(finalResponse.output, {
      model: finalResponse.model,
      usage,
      usageStatus: usage ? "complete" : "unknown",
      requestId,
      responseId: finalResponse.id,
    }),
    stopReason: resolvedRefusal
      ? "refusal"
      : truncatedByMaxOutput
        ? "max_output_tokens"
        : "completed",
    usage,
    usageStatus: usage ? "complete" : "unknown",
    model: finalResponse.model,
    requestId,
    responseId: finalResponse.id,
    inputCountRequestId,
    inputCountUnavailableReason,
  };
}

export function buildToolResultInput(
  callId: string,
  result: string
): ResponseInputItem.FunctionCallOutput {
  return {
    type: "function_call_output",
    call_id: callId,
    output: result,
  };
}
