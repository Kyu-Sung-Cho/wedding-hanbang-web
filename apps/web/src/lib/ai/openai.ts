import { createHash } from "node:crypto";
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

/** 커플 문맥이 시작되는 자리. 이 앞은 모든 커플에게 동일하다(441개 갈래 실측). */
const AMORA_VOLATILE_CONTEXT_MARK = "[필수 현재 문맥]";

/**
 * 캐시 라우팅 키.
 *
 * 정적 접두부만 해시한다 — 커플 문맥까지 넣으면 커플마다 키가 갈려서 캐시를
 * 공유하지 못한다. 표식이 없는 프롬프트는 전체가 정적이다(실측으로 확인).
 * 해시라 제공자에게는 어떤 신원도 나가지 않는다.
 */
export function promptCacheKey(systemPrompt: string): string {
  const mark = systemPrompt.indexOf(AMORA_VOLATILE_CONTEXT_MARK);
  const stable = mark >= 0 ? systemPrompt.slice(0, mark) : systemPrompt;
  return createHash("sha256").update(stable).digest("hex").slice(0, 32);
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

const LOCAL_INPUT_ESTIMATE_FRAMING_TOKENS = 512;
const INPUT_ATTACHMENT_ITEM_TYPES = new Set(["input_image", "input_file"]);
const INPUT_ATTACHMENT_KEYS = new Set(["image_url", "file_data"]);

/**
 * 입력에 사진·PDF 첨부(input_image / input_file 항목)가 하나라도 있는가.
 * 항목의 `type` 과 첨부 키만 보고 판정하며 본문 문자열은 읽지 않는다 —
 * "image_url" 이라는 낱말이 든 문장은 첨부가 아니다.
 */
export function hasInputAttachments(input: string | ResponseInput): boolean {
  const stack: unknown[] = [input];
  const seen = new Set<object>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const value of current) stack.push(value);
      continue;
    }
    const record = current as Record<string, unknown>;
    if (typeof record.type === "string" && INPUT_ATTACHMENT_ITEM_TYPES.has(record.type)) {
      return true;
    }
    for (const [key, value] of Object.entries(record)) {
      if (INPUT_ATTACHMENT_KEYS.has(key)) return true;
      stack.push(value);
    }
  }
  return false;
}

/** 토크나이저의 사전 분할과 같은 단위: 글자 묶음 · 숫자 묶음 · 기호 묶음 · 공백 묶음. */
const LOCAL_TOKEN_CHUNK_RE = /\p{L}[\p{L}\p{M}]*|\p{N}+|[^\s\p{L}\p{N}]+|\s+/gu;
const LOCAL_TOKEN_WEIGHT = {
  /** KS X 1001 완성형 한글 음절 1자. 실측 추정 0.46~0.69 보다 크게 잡는다. */
  hangulSyllable: 0.8,
  /**
   * 완성형 2,350자 밖의 한글 음절 1자(뷁·똠·햏 등). o200k 에서 1자 2~3토큰이다.
   * 바이트 단위 BPE 는 한 글자를 UTF-8 바이트 수보다 잘게 나누지 않으므로 3이면 위로만 틀린다.
   */
  rareHangulSyllable: 3,
  /** 라틴 글자 1자. 흔한 영단어는 4~6자가 1토큰이다. */
  latinLetter: 0.25,
  /**
   * 한 묶음에 라틴 글자가 `longLatinRun` 자보다 많을 때의 1자. 실제 낱말이 아니라 무작위
   * 문자열·base64 라서 o200k 에서 1.3~2자당 1토큰이다.
   */
  longLatinLetter: 0.75,
  longLatinRun: 20,
  /** ASCII 기호 1자. JSON 의 `":"`·`","` 같은 묶음은 1토큰이다. */
  asciiSymbol: 1 / 3,
  /** 자모·한자·가나·기타 문자·비ASCII 기호(BMP) 1자. */
  otherBmp: 1,
  /** 이모지 등 BMP 밖 1자. */
  astral: 2,
  /** 숫자는 최대 3자리씩 1토큰이다. */
  digitsPerToken: 3,
} as const;

/**
 * KS X 1001 완성형 한글 2,350자. EUC-KR 로 표현되는 음절이 일상 한국어의 사실상 전부다
 * (프롬프트·체크리스트·예절 안내 13만 음절에 표 밖 음절이 0자였다). 표 밖 음절은
 * 토크나이저 어휘에도 드물어 1자가 여러 토큰이 된다.
 *
 * 전체 ICU 가 없는 런타임이라 표를 만들 수 없으면 null — 예전처럼 모든 음절을 흔한 음절로 센다.
 */
const COMMON_HANGUL_SYLLABLES: ReadonlySet<string> | null = (() => {
  try {
    const decoder = new TextDecoder("euc-kr");
    const syllables = new Set<string>();
    for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
      for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
        const char = decoder.decode(new Uint8Array([lead, trail]));
        if (char.length === 1 && char >= "가" && char <= "힣") syllables.add(char);
      }
    }
    return syllables.size === 2_350 ? syllables : null;
  } catch {
    return null;
  }
})();

/**
 * 문자열 하나의 토큰 수를 문자 체계별로 어림한다. 사전 분할 묶음마다 최소 1토큰을
 * 매겨 `a a a a`·`가 가 가` 같은 한 글자 묶음 반복도 아래로 틀리지 않는다. 앞에 붙은
 * 공백 한 칸은 다음 묶음과 같은 토큰이 되므로 따로 세지 않고, 줄바꿈이나 두 칸 이상의
 * 공백 묶음은 1토큰으로 센다. (o200k 는 숫자 앞 공백을 따로 떼지만, 그 몫은 흔한 한글
 * 음절 가중치의 여유가 덮는다. 따로 세면 숫자가 섞인 긴 정상 대화가 다시 부푼다.)
 */
export function estimateTextTokensLocally(text: string): number {
  let tokens = 0;
  for (const [chunk] of text.matchAll(LOCAL_TOKEN_CHUNK_RE)) {
    if (/\s/u.test(chunk[0])) {
      if (chunk.length > 1 || /[\r\n]/u.test(chunk)) tokens += 1;
      continue;
    }
    if (/\p{N}/u.test(chunk[0])) {
      tokens += Math.ceil(chunk.length / LOCAL_TOKEN_WEIGHT.digitsPerToken);
      continue;
    }
    const letters = /\p{L}/u.test(chunk[0]);
    // 글자 묶음 안에서 코드 포인트 0x024f 이하는 라틴 글자다(아래 가중치 분기와 같은 기준).
    const latinLetters = letters
      ? [...chunk].filter((char) => (char.codePointAt(0) ?? 0) <= 0x024f).length
      : 0;
    const latinWeight = latinLetters > LOCAL_TOKEN_WEIGHT.longLatinRun
      ? LOCAL_TOKEN_WEIGHT.longLatinLetter
      : LOCAL_TOKEN_WEIGHT.latinLetter;
    let chunkTokens = 0;
    for (const char of chunk) {
      const codePoint = char.codePointAt(0) ?? 0;
      if (codePoint >= 0xac00 && codePoint <= 0xd7a3) {
        chunkTokens += COMMON_HANGUL_SYLLABLES && !COMMON_HANGUL_SYLLABLES.has(char)
          ? LOCAL_TOKEN_WEIGHT.rareHangulSyllable
          : LOCAL_TOKEN_WEIGHT.hangulSyllable;
      }
      else if (letters && codePoint <= 0x024f) chunkTokens += latinWeight;
      else if (!letters && codePoint < 0x80) chunkTokens += LOCAL_TOKEN_WEIGHT.asciiSymbol;
      else chunkTokens += codePoint > 0xffff ? LOCAL_TOKEN_WEIGHT.astral : LOCAL_TOKEN_WEIGHT.otherBmp;
    }
    tokens += Math.max(1, chunkTokens);
  }
  return Math.ceil(tokens);
}

/**
 * 사전 토큰 계산(inputTokens.count)이 장애일 때 앱 입력 상한을 지키기 위한
 * 보수적 로컬 추정 — **텍스트 전용 턴에만** 쓴다.
 *
 * 예전 기준(UTF-8 바이트/3)은 한글 1자를 1토큰으로 셌다. 한국어 본문에서 실제의
 * 1.5~2배라 장애 중에는 상한 안의 긴 정상 대화까지 AMORA_INPUT_TOO_LARGE 로
 * 막았다. 지금은 문자 체계별 가중치(`LOCAL_TOKEN_WEIGHT`)로 잰다.
 *
 * ## 보정 근거와 가정 (저장소에 토크나이저 패키지가 없어 실측 표본으로 맞췄다)
 *
 * - OpenAI 가 o200k 토크나이저 공개 때 든 한국어 예문
 *   "안녕하세요, 제 이름은 GPT-4o입니다. 저는 새로운 유형의 언어 모델입니다, 만나서
 *   반갑습니다!" 는 27토큰이다. 이 추정은 36(1.33배)이다.
 * - 운영 최악 커플의 시스템 프롬프트 48,019자는 호출당 입력 ~23,000토큰으로
 *   실측됐다. 실제 프롬프트 합성(한글 57%·공백 23%·ASCII 18%)을 같은 길이로
 *   늘려 재면 프롬프트만으로 ~28,700(1.25배)이다. 23,000 에 도구·대화가 포함된
 *   값이면 여유는 더 크다. 이 두 표본에서 한글 1자는 실제 0.46~0.69토큰이다.
 * - 드물게 쓰이는 한글 음절은 1자가 2토큰 이상이다. KS X 1001 완성형 밖 음절은 UTF-8
 *   바이트 수(3)로 세어 위로만 틀리게 했다. 한 묶음에 라틴 글자가 20자를 넘는 무작위
 *   문자열은 글자당 0.75 로 센다(2026-09-15 2차 검토).
 * - 남은 한계: 드문 한자만 늘어놓은 입력, 공백으로 20자 이하씩 끊은 무작위 영문은
 *   아직 아래로 틀릴 수 있다. 토크나이저 없이 가중치를 올리면 흔한 입력이 부풀어
 *   장애 중 정상 대화를 막게 되므로 여기서 멈췄다. 일반 대화 전체 평균에서는 위로
 *   틀리게 잡았다.
 *
 * 첨부는 로컬로 잴 수 없다. PDF 는 추출 텍스트 + 쪽당 이미지 1장(최대 100쪽)으로
 * 청구돼 건당 고정 몫은 과소 추정이다(10MB PDF 다섯 장이 21,074 로 통과했다).
 * 첨부 턴은 호출부가 hasInputAttachments 로 걸러 측정 단계에서 끝내고, 그래도
 * 첨부가 여기까지 오면 base64 를 글자 그대로 세어 위로 틀린다.
 */
export function estimateInputTokensLocally(request: {
  instructions: string;
  input: string | ResponseInput;
  tools?: FunctionTool[];
}): number {
  let tokens = 0;
  const stack: unknown[] = [request.instructions, request.input, request.tools ?? []];
  const seen = new Set<object>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") {
      tokens += estimateTextTokensLocally(current);
      continue;
    }
    if (typeof current === "number" || typeof current === "boolean") {
      tokens += estimateTextTokensLocally(String(current));
      continue;
    }
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const value of current) stack.push(value);
      continue;
    }
    for (const [key, value] of Object.entries(current)) {
      // 키와 JSON 구분 기호(`"key":`)를 함께 센다.
      tokens += estimateTextTokensLocally(key) + 1;
      stack.push(value);
    }
  }
  return tokens + LOCAL_INPUT_ESTIMATE_FRAMING_TOKENS;
}

function getRefusalText(response: OpenAIResponse): string {
  return response.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content)
    .filter((content) => content.type === "refusal")
    .map((content) => content.refusal)
    .join("");
}

function getCompletedResponseText(response: OpenAIResponse): string {
  if (response.status !== "completed" || response.error) return "";
  const parts = response.output
    .flatMap((item) => item.type === "message"
      && item.role === "assistant" && item.status === "completed" ? item.content : [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text);
  // 일부만 합치면 완성본처럼 보일 수 있어 잘못된 nested 본문은 전체를 버린다.
  if (parts.some((part) => typeof part !== "string")) return "";
  const text = parts.join("");
  return text.trim() ? text : "";
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
  /**
   * Required privacy/audit gate for every content-bearing provider request of
   * this call, including the input token count. `beforeGeneration` reserves paid
   * capacity as close as possible to the billed generation and therefore runs
   * *after* counting, so it cannot protect the count itself — the count already
   * carries the full instructions and input to the provider. No caller may opt
   * out: an omitted gate fails closed before any provider request. See handoff
   * §8 P0-5 and §17.3.
   */
  beforeProviderEgress: () => void | Promise<void>;
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
    beforeProviderEgress,
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
  // 사전 토큰 계산을 건너뛴 턴의 사유 — 호출부가 원장에 남길 수 있게 반환한다.
  let inputCountUnavailableReason: string | null = null;

  if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens <= 0) {
    throw new Error("[ai-config] maxInputTokens must be a positive integer");
  }

  // 토큰 계산도 systemPrompt와 input 원문을 그대로 제공자에게 보내는
  // content-bearing egress다. 따라서 어떤 provider 요청보다 먼저 개인정보·감사
  // 게이트를 통과해야 한다. 여기서 실패하면 count도 create도 시작하지 않는다.
  // gate를 아예 넘기지 않은 호출부는 타입 검사에서 막히지만, 런타임에서도
  // 조용히 통과시키지 않는다 — 빠진 gate는 열린 gate와 같다.
  if (typeof beforeProviderEgress !== "function") {
    throw new Error(
      "[ai-config] beforeProviderEgress is required before any content-bearing provider request",
    );
  }
  // 측정 *호출*이 전송·제공자 장애(네트워크·5xx·429·타임아웃)로 죽으면 한 번만
  // 다시 잰다. 측정이 성공하고 그 판정이 막은 것(한도 초과·잘못된 응답)과
  // 호출부의 취소는 다시 재지 않는다.
  let inputCountFailure: OpenAIProviderError | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    // 재시도도 원문 전송이다. 동의 철회는 측정 장애로 삼아 재시도하지 않는다.
    signal?.throwIfAborted();
    await beforeProviderEgress();
    signal?.throwIfAborted();
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
      inputCountFailure = null;
      break;
    } catch (error) {
      const staged = markOpenAIRequestStage(error, "input_count", {
        model: modelConfig.model,
      });
      if (error instanceof OpenAIProviderError || signal?.aborted) throw staged;
      inputCountFailure = staged;
    }
  }
  if (inputCountFailure) {
    // 두 번 다 실패 — 측정 장애다. 2026-07-25 운영에서 /responses/input_tokens 만
    // 죽고 /responses 는 멀쩡했는데 여기서 던져 "안녕" 한 마디까지 전부
    // "입력 분량을 확인하는 중 문제가 생겼어요"로 죽었다. 그러나 비용 예약은
    // 앱의 입력 상한을 전제로 하므로(b2d2fa1c 가 옛 폴백을 뺀 이유) 상한 없이
    // 진행하지 않고, 보수적 로컬 추정으로 상한을 지킨 뒤에만 생성으로 간다.
    //
    // 첨부(사진·PDF) 턴은 폴백하지 않는다 — 로컬 추정이 첨부를 잴 수 없어
    // (PDF 는 추출 텍스트 + 쪽당 이미지 1장, 최대 100쪽) 상한을 보장하지 못한다.
    // 이전처럼 측정 단계에서 끝낸다.
    if (hasInputAttachments(input)) throw inputCountFailure;
    const estimatedInputTokens = estimateInputTokensLocally({
      instructions: systemPrompt,
      input,
      tools: openAITools,
    });
    if (estimatedInputTokens > maxInputTokens) {
      throw new OpenAIInputTokenLimitError(estimatedInputTokens, maxInputTokens, {
        requestId: inputCountFailure.requestId,
      });
    }
    inputCountUnavailableReason =
      inputCountFailure.providerCode ?? inputCountFailure.category;
    console.warn(
      `[amora] input pre-count unavailable after retry (${inputCountUnavailableReason}) — proceeding on a local estimate of ${estimatedInputTokens} tokens`,
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
    // 캐시 라우팅 키. **프롬프트를 바꾸지 않는다** — 같은 접두부를 쓰는 요청을
    // 같은 캐시로 보내달라는 힌트일 뿐이다.
    //
    // 없으면 턴이 바뀔 때마다 캐시를 놓친다(2026-08-23 실측: 한 턴 안의 두 번째
    // 호출만 적중 $0.003, 첫 호출은 매번 $0.031). 시스템 프롬프트는 커플이 달라도
    // 동일하므로, **정적 접두부의 해시**를 키로 쓰면 모든 커플이 같은 캐시를
    // 공유한다. 커플 식별자를 쓰지 않으므로 제공자에게 신원이 나가지 않는다.
    prompt_cache_key: promptCacheKey(systemPrompt),
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
  // raw 스트림에는 SDK 편의 필드가 없을 수 있다. 완료 본문을 delta와 중복하지 않는다.
  const resolvedText = finalResponse.output_text || resolvedRefusal
    || getCompletedResponseText(finalResponse) || fullText || "";
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
