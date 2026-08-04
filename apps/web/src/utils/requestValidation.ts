import { sanitizeText } from "@/utils/sanitize";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * A public read may receive Supabase's missing-session error from a real guest.
 * Only a request that actually presented auth material should be treated as a
 * failed authenticated session.
 */
export function hasPresentedAuthCredential(request: Request): boolean {
  if (request.headers.has("authorization")) return true;
  const cookie = request.headers.get("cookie") ?? "";
  return /(?:^|;\s*)sb-[^=]*auth-token(?:\.\d+)?=/u.test(cookie);
}

export function isBodyTooLarge(request: Request, maxBytes: number): boolean {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return false;
  const size = Number(contentLength);
  return Number.isFinite(size) && size > maxBytes;
}

export type BoundedUtf8TextResult =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" | "read_error" };

/**
 * Read at most maxBytes from a request body. Content-Length is only an early
 * rejection hint; the stream itself is counted so chunked or dishonest
 * requests cannot make the route buffer an unbounded body before rejecting it.
 */
export async function readBoundedUtf8Text(
  request: Request,
  maxBytes: number,
): Promise<BoundedUtf8TextResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    return { ok: false, reason: "read_error" };
  }
  if (isBodyTooLarge(request, maxBytes)) {
    return { ok: false, reason: "too_large" };
  }
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel("request body exceeds the configured limit");
        } catch {
          // Cancellation is best effort; the response still fails closed.
        }
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    try {
      await reader.cancel("request body could not be read");
    } catch {
      // Cancellation is best effort; callers receive a generic read failure.
    }
    return { ok: false, reason: "read_error" };
  } finally {
    reader.releaseLock();
  }
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

export function cleanOptionalText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") return null;
  const value = sanitizeText(raw).slice(0, maxLength).trim();
  return value.length > 0 ? value : null;
}

export function cleanPostgrestSearchTerm(raw: unknown, maxLength = 80): string | null {
  const value = cleanOptionalText(raw, maxLength);
  if (!value) return null;

  const cleaned = value
    .replace(/[,%(){}"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}

export function escapePostgrestLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function cleanOptionalEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[]
): T | null {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : null;
}

export function cleanOptionalBoolean(raw: unknown): boolean {
  return raw === true;
}

export function cleanOptionalIsoDate(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !ISO_DATE_RE.test(raw)) return undefined;

  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  if (date.toISOString().slice(0, 10) !== raw) return undefined;

  return raw;
}

// 한국 휴대폰 번호 정규화 — 하이픈/공백 제거 후 01X + 7~8자리 검증, 숫자만 반환.
// 반환: 정규화 문자열 | null(빈 입력 = 삭제 의도) | undefined(형식 오류)
export function cleanOptionalKoreanMobile(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits === "") return null;
  return /^01[016789][0-9]{7,8}$/.test(digits) ? digits : undefined;
}

export function cleanIntegerInRange(
  raw: unknown,
  min: number,
  max: number
): number | undefined {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return undefined;
  return value;
}

export interface JsonSanitizeOptions {
  maxDepth?: number;
  maxArrayLength?: number;
  maxObjectKeys?: number;
  maxStringLength?: number;
}

export function sanitizeJsonValue(
  value: unknown,
  options: JsonSanitizeOptions = {},
  depth = 0
): unknown {
  const maxDepth = options.maxDepth ?? 6;
  const maxArrayLength = options.maxArrayLength ?? 100;
  const maxObjectKeys = options.maxObjectKeys ?? 200;
  const maxStringLength = options.maxStringLength ?? 1000;

  if (depth > maxDepth) return null;
  if (value === null) return null;

  if (typeof value === "string") {
    return sanitizeText(value).slice(0, maxStringLength);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value
      .slice(0, maxArrayLength)
      .map((item) => sanitizeJsonValue(item, options, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, maxObjectKeys)) {
      if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(key)) continue;
      output[key] = sanitizeJsonValue(item, options, depth + 1);
    }
    return output;
  }

  return null;
}

export function sanitizeJsonObject(
  value: unknown,
  options?: JsonSanitizeOptions
): Record<string, unknown> | null {
  const sanitized = sanitizeJsonValue(value, options);
  return isRecord(sanitized) ? sanitized : null;
}
