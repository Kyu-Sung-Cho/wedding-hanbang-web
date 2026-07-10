import OpenAI from "openai";
import Ajv, { type ValidateFunction } from "ajv";
import type {
  EasyInputMessage,
  FunctionTool,
  Response,
  ResponseInput,
  ResponseInputItem,
  ResponseInputMessageContentList,
  ResponseOutputItem,
  ResponseCreateParamsStreaming,
} from "openai/resources/responses/responses";
import { getAmoraModelConfig, type AmoraModelRole } from "@/lib/ai/modelConfig";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

let defaultClient: OpenAI | null = null;
const schemaValidator = new Ajv({
  allErrors: true,
  strict: false,
  strictNumbers: true,
  coerceTypes: false,
});
const compiledToolSchemas = new WeakMap<object, ValidateFunction>();

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("[ai-config] OPENAI_API_KEY 환경변수가 필요합니다.");
  if (!defaultClient) {
    defaultClient = new OpenAI({
      apiKey,
      // 자동 재시도는 중복 과금을 숨길 수 있어 끈다. 실패 시 사용자가 명시적으로 재요청한다.
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

export interface NormalizedOpenAIUsage {
  input_tokens: number;
  output_tokens: number;
  cache_write_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export class OpenAIResponseError extends Error {
  readonly model?: string;
  readonly usage?: NormalizedOpenAIUsage;

  constructor(message: string, response?: Response) {
    super(message);
    this.name = "OpenAIResponseError";
    this.model = response?.model;
    this.usage = response ? normalizeResponseUsage(response) : undefined;
  }
}

export class OpenAIInputTokenLimitError extends Error {
  constructor(
    readonly inputTokens: number,
    readonly maxInputTokens: number
  ) {
    super(`[openai] 입력 토큰 ${inputTokens}개가 허용 상한 ${maxInputTokens}개를 초과했습니다.`);
    this.name = "OpenAIInputTokenLimitError";
  }
}

export interface ChatWithToolsResult {
  fullText: string;
  toolCalls: ToolCallBlock[];
  outputItems: ResponseInputItem[];
  stopReason: string;
  usage?: NormalizedOpenAIUsage;
  model?: string;
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
export type ChatResponseInput = ResponseInput;
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
      });
    } else {
      content.push({
        type: "input_image",
        // GPT-5.6 auto/original은 원본 해상도를 보존해 입력 토큰이 급증할 수 있다.
        detail: "low",
        image_url: `data:${attachment.mediaType};base64,${attachment.base64}`,
      });
    }
  }
  if (text) content.push({ type: "input_text", text });
  return content;
}

function toOpenAITools(tools: AiToolDefinition[]): FunctionTool[] {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
    // 기존 스키마에는 선택 필드와 additionalProperties 설정이 혼재한다.
    // 공급자 전환 중 동작을 보존하고 실행기 경계에서 다시 검증한다.
    strict: false,
  }));
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

function validateToolInput(
  tool: AiToolDefinition | undefined,
  input: Record<string, unknown>
): boolean {
  if (!tool || !tool.input_schema || typeof tool.input_schema !== "object") return false;
  const schema = tool.input_schema as object;
  let validate = compiledToolSchemas.get(schema);
  if (!validate) {
    validate = schemaValidator.compile(schema);
    compiledToolSchemas.set(schema, validate);
  }
  return validate(input) === true;
}

function getIncompleteReason(response: Response): string {
  return response.incomplete_details?.reason || response.status || "incomplete";
}

function getRefusalText(response: Response): string {
  return response.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content)
    .filter((content) => content.type === "refusal")
    .map((content) => content.refusal)
    .join("");
}

function normalizeResponseUsage(response: Response): NormalizedOpenAIUsage | undefined {
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

function getReplayableOutputItems(output: ResponseOutputItem[]): ResponseInputItem[] {
  for (const item of output) {
    if (item.type !== "message" && item.type !== "function_call" && item.type !== "reasoning") {
      throw new Error(`[openai] 지원하지 않는 출력 item입니다: ${item.type}`);
    }
  }
  // 이 요청은 custom function tools만 사용하므로 위 세 종류는 모두 ResponseInputItem이다.
  return output as ResponseInputItem[];
}

export async function chatWithToolsStream(options: {
  systemPrompt: string;
  input: ResponseInput;
  tools: AiToolDefinition[];
  onTextDelta?: (text: string) => void;
  maxOutputTokens?: number;
  /** 설정된 경우 Responses input token count를 먼저 호출해 장문 요금 구간 진입을 차단한다. */
  maxInputTokens?: number;
  /** 원문이 OpenAI token-count endpoint로 나가기 직전에 회원/삭제 상태를 재검증한다. */
  beforeInputCount?: () => Promise<void>;
  /** 토큰 상한 통과 뒤, 실제 유료 generation 직전에 원자 비용 예약을 수행한다. */
  beforeCreate?: (inputTokens: number | null) => Promise<void>;
  safetyIdentifier?: string;
  /** Luna is the normal chat default; callers explicitly escalate high-risk turns to Terra. */
  modelRole?: AmoraModelRole;
  signal?: AbortSignal;
  client?: OpenAI;
}): Promise<ChatWithToolsResult> {
  const {
    systemPrompt,
    input,
    tools,
    onTextDelta,
    maxOutputTokens = 2_048,
    maxInputTokens,
    beforeInputCount,
    beforeCreate,
    safetyIdentifier,
    // Cost-safe fallback for any future internal caller that does not yet
    // choose a role explicitly. High-consequence chat paths pass primary.
    modelRole = "fast",
    signal,
    client = getOpenAIClient(),
  } = options;
  signal?.throwIfAborted();
  const modelConfig = getAmoraModelConfig(modelRole);
  const openAITools = toOpenAITools(tools);
  let countedInputTokens: number | null = null;

  if (maxInputTokens !== undefined) {
    if (!Number.isInteger(maxInputTokens) || maxInputTokens <= 0) {
      throw new Error("[ai-config] maxInputTokens는 양의 정수여야 합니다.");
    }
    await beforeInputCount?.();
    signal?.throwIfAborted();
    const countParams = {
      model: modelConfig.model,
      instructions: systemPrompt,
      input,
      tools: openAITools,
      parallel_tool_calls: false,
      reasoning: { effort: modelConfig.reasoningEffort },
      text: { verbosity: modelConfig.verbosity },
    } as const;
    const tokenCount = signal
      ? await client.responses.inputTokens.count(countParams, { signal })
      : await client.responses.inputTokens.count(countParams);
    signal?.throwIfAborted();
    countedInputTokens = tokenCount.input_tokens;
    if (tokenCount.input_tokens > maxInputTokens) {
      throw new OpenAIInputTokenLimitError(tokenCount.input_tokens, maxInputTokens);
    }
  }

  await beforeCreate?.(countedInputTokens);
  signal?.throwIfAborted();

  const requestBody: ResponseCreateParamsStreaming = {
    model: modelConfig.model,
    instructions: systemPrompt,
    input,
    tools: openAITools,
    parallel_tool_calls: false,
    max_output_tokens: maxOutputTokens,
    reasoning: { effort: modelConfig.reasoningEffort },
    text: { verbosity: modelConfig.verbosity },
    include: ["reasoning.encrypted_content"],
    safety_identifier: safetyIdentifier,
    service_tier: "default",
    // 명시 모드에 cache breakpoint를 두지 않아 private/첨부/대화 원문을
    // billable prompt cache에 쓰지 않는다. 계약상 보유 상한 확인 전 보수 기본값.
    prompt_cache_options: { mode: "explicit" },
    store: false,
    stream: true,
  };
  const stream = signal
    ? await client.responses.create(requestBody, { signal })
    : await client.responses.create(requestBody);

  let fullText = "";
  let refusalText = "";
  let finalResponse: Response | null = null;
  for await (const event of stream) {
    signal?.throwIfAborted();
    if (event.type === "response.output_text.delta") {
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
    } else if (event.type === "response.incomplete") {
      throw new OpenAIResponseError(
        `[openai] 응답이 완료되지 않았습니다: ${getIncompleteReason(event.response)}`,
        event.response
      );
    } else if (event.type === "response.failed") {
      throw new OpenAIResponseError(
        `[openai] 응답 생성에 실패했습니다: ${event.response.error?.message || "unknown"}`,
        event.response
      );
    } else if (event.type === "error") {
      throw new Error(`[openai] 스트리밍 오류: ${event.message}`);
    }
  }

  if (!finalResponse) throw new Error("[openai] 완료 응답을 받지 못했습니다.");

  const toolCalls = finalResponse.output
    .filter((item) => item.type === "function_call")
    .map((item) => {
      const parsed = parseToolArguments(item.arguments);
      const parseError: ToolCallBlock["parseError"] = parsed.parseError ?? (
        validateToolInput(tools.find((tool) => tool.name === item.name), parsed.input)
          ? undefined
          : "schema_validation"
      );
      return {
        callId: item.call_id,
        name: item.name,
        input: parsed.input,
        parseError,
      };
    });
  const resolvedRefusal = refusalText || getRefusalText(finalResponse);
  const resolvedText = fullText || finalResponse.output_text || resolvedRefusal || "";
  if (!resolvedText && toolCalls.length === 0) {
    throw new OpenAIResponseError(
      "[openai] 텍스트 또는 도구 호출이 없는 응답입니다.",
      finalResponse
    );
  }

  let outputItems: ResponseInputItem[];
  try {
    outputItems = getReplayableOutputItems(finalResponse.output);
  } catch (err) {
    throw new OpenAIResponseError(
      err instanceof Error ? err.message : "[openai] 출력 item 검증 실패",
      finalResponse
    );
  }

  return {
    fullText: resolvedText,
    toolCalls,
    outputItems,
    stopReason: resolvedRefusal
      ? "refusal"
      : finalResponse.status === "completed"
        ? "completed"
        : getIncompleteReason(finalResponse),
    usage: normalizeResponseUsage(finalResponse),
    model: finalResponse.model,
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
