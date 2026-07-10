// Stay below the hosting platform's request ceiling after headers/framing.
// Inline base64 attachments are separately capped at 2 MiB raw in the route.
export const MAX_CHAT_REQUEST_BODY_BYTES = Math.floor(3.5 * 1024 * 1024);

const MAX_SENDER_NAME_CHARS = 80;
const MAX_VENUE_CHARS = 200;
const MAX_FILE_NAME_CHARS = 200;
const MAX_BUDGET_WON = 100_000_000_000;
const MAX_PROGRESS_DEPTH = 8;
const MAX_PROGRESS_NODES = 1_000;
const MAX_PROGRESS_COLLECTION_ITEMS = 100;
const MAX_PROGRESS_KEY_CHARS = 100;
const MAX_PROGRESS_SINGLE_STRING_CHARS = 2_000;
const MAX_PROGRESS_TOTAL_STRING_CHARS = 20_000;
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export class ChatRequestError extends Error {
  readonly status: 400 | 413;

  constructor(message: string, status: 400 | 413) {
    super(message);
    this.name = "ChatRequestError";
    this.status = status;
  }
}

export type ChatSenderRole = "bride" | "groom";

export interface BoundedWeddingContext {
  weddingDate: string | null;
  budget: number;
  venue: string | null;
  progress: Record<string, unknown>;
}

export interface ClientChatContext {
  senderName?: string;
  senderRole?: ChatSenderRole;
  weddingContext?: BoundedWeddingContext;
}

export interface InlineAttachment {
  base64: string;
  mediaType: string;
  fileName?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

function readChunkWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(getAbortReason(signal));

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      void reader.cancel(signal.reason).catch(() => undefined);
      reject(getAbortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export function assertChatContentLength(
  headers: Headers,
  maxBytes = MAX_CHAT_REQUEST_BODY_BYTES
): void {
  const raw = headers.get("content-length");
  if (raw == null) return;
  if (!/^\d+$/.test(raw)) {
    throw new ChatRequestError("Content-Length가 올바르지 않습니다.", 400);
  }
  const declaredBytes = Number(raw);
  if (!Number.isSafeInteger(declaredBytes)) {
    throw new ChatRequestError("Content-Length가 올바르지 않습니다.", 400);
  }
  if (declaredBytes > maxBytes) {
    throw new ChatRequestError("요청 본문이 너무 큽니다.", 413);
  }
}

export async function readBoundedJsonBody(
  request: Request,
  options: { maxBytes?: number; signal?: AbortSignal } = {}
): Promise<Record<string, unknown>> {
  const maxBytes = options.maxBytes ?? MAX_CHAT_REQUEST_BODY_BYTES;
  const signal = options.signal ?? request.signal;
  assertChatContentLength(request.headers, maxBytes);
  if (!request.body || request.bodyUsed) {
    throw new ChatRequestError("요청 본문이 필요합니다.", 400);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await readChunkWithAbort(reader, signal);
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        void reader.cancel("request_body_too_large").catch(() => undefined);
        throw new ChatRequestError("요청 본문이 너무 큽니다.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    throw new ChatRequestError("요청 본문이 필요합니다.", 400);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(raw);
  } catch {
    throw new ChatRequestError("잘못된 JSON 요청입니다.", 400);
  }
  if (!isPlainObject(parsed)) {
    throw new ChatRequestError("요청 본문은 JSON 객체여야 합니다.", 400);
  }
  return parsed;
}

function parseStrictSingleLine(
  value: unknown,
  fieldName: string,
  maxChars: number,
  nullable: boolean
): string | null | undefined {
  if (value === undefined) return undefined;
  if (nullable && value === null) return null;
  if (typeof value !== "string") {
    throw new ChatRequestError(`${fieldName} 형식이 올바르지 않습니다.`, 400);
  }
  if (value.length > maxChars) {
    throw new ChatRequestError(`${fieldName}이 너무 깁니다.`, 413);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new ChatRequestError(`${fieldName}에 허용되지 않는 문자가 있습니다.`, 400);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || (nullable ? null : undefined);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateProgress(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new ChatRequestError("weddingContext.progress 형식이 올바르지 않습니다.", 400);
  }

  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  let totalStringChars = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_PROGRESS_NODES || current.depth > MAX_PROGRESS_DEPTH) {
      throw new ChatRequestError("weddingContext.progress가 너무 복잡합니다.", 413);
    }

    if (typeof current.value === "string") {
      if (current.value.length > MAX_PROGRESS_SINGLE_STRING_CHARS) {
        throw new ChatRequestError("weddingContext.progress 문자열이 너무 깁니다.", 413);
      }
      totalStringChars += current.value.length;
      if (totalStringChars > MAX_PROGRESS_TOTAL_STRING_CHARS) {
        throw new ChatRequestError("weddingContext.progress 내용이 너무 깁니다.", 413);
      }
      continue;
    }
    if (
      current.value === null ||
      typeof current.value === "boolean" ||
      (typeof current.value === "number" && Number.isFinite(current.value))
    ) {
      continue;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_PROGRESS_COLLECTION_ITEMS) {
        throw new ChatRequestError("weddingContext.progress 배열이 너무 큽니다.", 413);
      }
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (!isPlainObject(current.value)) {
      throw new ChatRequestError("weddingContext.progress 값이 올바르지 않습니다.", 400);
    }

    const entries = Object.entries(current.value);
    if (entries.length > MAX_PROGRESS_COLLECTION_ITEMS) {
      throw new ChatRequestError("weddingContext.progress 객체가 너무 큽니다.", 413);
    }
    for (const [key, item] of entries) {
      if (key.length > MAX_PROGRESS_KEY_CHARS || FORBIDDEN_OBJECT_KEYS.has(key)) {
        throw new ChatRequestError("weddingContext.progress 키가 올바르지 않습니다.", 400);
      }
      totalStringChars += key.length;
      if (totalStringChars > MAX_PROGRESS_TOTAL_STRING_CHARS) {
        throw new ChatRequestError("weddingContext.progress 내용이 너무 깁니다.", 413);
      }
      stack.push({ value: item, depth: current.depth + 1 });
    }
  }

  return value;
}

function parseSenderRole(value: unknown): ChatSenderRole | undefined {
  if (value == null) return undefined;
  if (value !== "bride" && value !== "groom") {
    throw new ChatRequestError("senderRole 형식이 올바르지 않습니다.", 400);
  }
  return value;
}

export function parseClientChatContext(body: Record<string, unknown>): ClientChatContext {
  const senderName = parseStrictSingleLine(
    body.senderName,
    "senderName",
    MAX_SENDER_NAME_CHARS,
    false
  ) as string | undefined;
  const senderRole = parseSenderRole(body.senderRole ?? body.role);
  if (
    body.senderRole != null &&
    body.role != null &&
    body.senderRole !== body.role
  ) {
    throw new ChatRequestError("senderRole과 role이 일치하지 않습니다.", 400);
  }

  let weddingContext: BoundedWeddingContext | undefined;
  if (body.weddingContext != null) {
    if (!isPlainObject(body.weddingContext)) {
      throw new ChatRequestError("weddingContext 형식이 올바르지 않습니다.", 400);
    }
    const allowedKeys = new Set(["weddingDate", "budget", "venue", "progress"]);
    if (Object.keys(body.weddingContext).some((key) => !allowedKeys.has(key))) {
      throw new ChatRequestError("weddingContext에 허용되지 않는 필드가 있습니다.", 400);
    }

    const rawDate = body.weddingContext.weddingDate;
    if (rawDate !== undefined && rawDate !== null && (typeof rawDate !== "string" || !isValidDate(rawDate))) {
      throw new ChatRequestError("weddingContext.weddingDate 형식이 올바르지 않습니다.", 400);
    }
    const rawBudget = body.weddingContext.budget ?? 0;
    if (
      typeof rawBudget !== "number" ||
      !Number.isFinite(rawBudget) ||
      rawBudget < 0 ||
      rawBudget > MAX_BUDGET_WON
    ) {
      throw new ChatRequestError("weddingContext.budget 형식이 올바르지 않습니다.", 400);
    }
    const venue = parseStrictSingleLine(
      body.weddingContext.venue,
      "weddingContext.venue",
      MAX_VENUE_CHARS,
      true
    );
    const progress = validateProgress(body.weddingContext.progress ?? {});

    weddingContext = {
      weddingDate: typeof rawDate === "string" ? rawDate : null,
      budget: rawBudget,
      venue: typeof venue === "string" ? venue : null,
      progress,
    };
  }

  return {
    ...(senderName ? { senderName } : {}),
    ...(senderRole ? { senderRole } : {}),
    ...(weddingContext ? { weddingContext } : {}),
  };
}

function sanitizeTrustedSingleLine(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxChars);
  return normalized || null;
}

export function sanitizeTrustedDisplayName(value: unknown): string | null {
  return sanitizeTrustedSingleLine(value, MAX_SENDER_NAME_CHARS);
}

function sanitizeTrustedProgress(value: unknown): Record<string, unknown> {
  try {
    return validateProgress(value ?? {});
  } catch {
    return {};
  }
}

function sanitizeTrustedWeddingContext(journey: {
  wedding_date?: unknown;
  total_budget?: unknown;
  venue?: unknown;
  progress?: unknown;
} | null | undefined): BoundedWeddingContext {
  const weddingDate = typeof journey?.wedding_date === "string" && isValidDate(journey.wedding_date)
    ? journey.wedding_date
    : null;
  const budget = typeof journey?.total_budget === "number" &&
    Number.isFinite(journey.total_budget) &&
    journey.total_budget >= 0 &&
    journey.total_budget <= MAX_BUDGET_WON
    ? journey.total_budget
    : 0;
  return {
    weddingDate,
    budget,
    venue: sanitizeTrustedSingleLine(journey?.venue, MAX_VENUE_CHARS),
    progress: sanitizeTrustedProgress(journey?.progress),
  };
}

export function resolveChatContext(params: {
  isDemo: boolean;
  client: ClientChatContext;
  profile: { name?: unknown; role?: unknown } | null | undefined;
  journey: {
    wedding_date?: unknown;
    total_budget?: unknown;
    venue?: unknown;
    progress?: unknown;
  } | null | undefined;
}): {
  senderName: string;
  senderRole: ChatSenderRole | null;
  weddingContext: BoundedWeddingContext;
} {
  const trustedRole = params.profile?.role === "bride" || params.profile?.role === "groom"
    ? params.profile.role
    : null;
  const trustedName = sanitizeTrustedSingleLine(params.profile?.name, MAX_SENDER_NAME_CHARS);
  const trustedWeddingContext = sanitizeTrustedWeddingContext(params.journey);

  const senderRole = params.isDemo
    ? params.client.senderRole ?? trustedRole
    : trustedRole;
  const senderName = params.isDemo
    ? params.client.senderName ?? trustedName ?? (senderRole === "groom" ? "신랑" : senderRole === "bride" ? "신부" : "사용자")
    : trustedName ?? (senderRole === "groom" ? "신랑" : senderRole === "bride" ? "신부" : "사용자");
  const weddingContext = params.isDemo && params.client.weddingContext
    ? params.client.weddingContext
    : trustedWeddingContext;

  return { senderName, senderRole, weddingContext };
}

export function parseInlineAttachment(value: unknown): InlineAttachment {
  if (!isPlainObject(value)) {
    throw new ChatRequestError("첨부파일 형식이 올바르지 않습니다.", 400);
  }
  if (value.url != null) {
    throw new ChatRequestError("URL 첨부는 지원하지 않습니다.", 400);
  }
  if (typeof value.mediaType !== "string" || !value.mediaType || value.mediaType.length > 100) {
    throw new ChatRequestError("첨부파일 mediaType이 필요합니다.", 400);
  }
  if (typeof value.base64 !== "string" || !value.base64) {
    throw new ChatRequestError("첨부파일 데이터가 필요합니다.", 400);
  }
  if (value.base64.length > MAX_CHAT_REQUEST_BODY_BYTES) {
    throw new ChatRequestError("첨부파일 데이터가 너무 큽니다.", 413);
  }
  if (value.fileName !== undefined && typeof value.fileName !== "string") {
    throw new ChatRequestError("첨부파일 이름 형식이 올바르지 않습니다.", 400);
  }
  if (typeof value.fileName === "string" && value.fileName.length > MAX_FILE_NAME_CHARS) {
    throw new ChatRequestError("첨부파일 이름이 너무 깁니다.", 413);
  }

  return {
    base64: value.base64,
    mediaType: value.mediaType,
    ...(typeof value.fileName === "string" ? { fileName: value.fileName } : {}),
  };
}
