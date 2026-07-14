import { NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { parseBearerAccessToken } from "@/lib/supabase/bearer";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { sanitizeText } from "@/utils/sanitize";

const DEFAULT_MAX_BODY_BYTES = 32 * 1024;
const COURT_CURSOR_MAX_LENGTH = 384;
const POSTGRES_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|[+-](\d{2}):(\d{2}))$/;

export type CourtCursorKind = "cases" | "comments";

export interface CourtCursor {
  at: string;
  id: string;
}

function isValidCourtCursorTimestamp(value: string): boolean {
  const match = POSTGRES_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1
    && month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth[month - 1]
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 14
    && offsetMinute <= 59
    && (offsetHour < 14 || offsetMinute === 0);
}

export class CourtApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CourtApiError";
  }
}

export function encodeCourtCursor(kind: CourtCursorKind, cursor: CourtCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, kind, ...cursor }), "utf8").toString("base64url");
}

export function readCourtCursor(
  request: Request,
  expectedKind: CourtCursorKind,
): CourtCursor | null {
  const encoded = new URL(request.url).searchParams.get("cursor");
  if (encoded === null) return null;
  if (
    encoded.length < 1
    || encoded.length > COURT_CURSOR_MAX_LENGTH
    || !/^[A-Za-z0-9_-]+$/.test(encoded)
  ) {
    throw new CourtApiError(400, "COURT_CURSOR_INVALID", "목록 위치를 다시 확인해 주세요.");
  }

  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new CourtApiError(400, "COURT_CURSOR_INVALID", "목록 위치를 다시 확인해 주세요.");
  }
  if (
    !isRecord(value)
    || value.v !== 1
    || value.kind !== expectedKind
    || typeof value.at !== "string"
    || value.at.length > 40
    || !isValidCourtCursorTimestamp(value.at)
    || !isUuid(value.id)
  ) {
    throw new CourtApiError(400, "COURT_CURSOR_INVALID", "목록 위치를 다시 확인해 주세요.");
  }
  return { at: value.at, id: value.id };
}

type CourtEnvironment = Partial<Pick<
  NodeJS.ProcessEnv,
  | "NODE_ENV"
  | "COUPLE_COURT_ENABLED"
  | "COUPLE_COURT_AI_ENABLED"
  | "COUPLE_COURT_PUBLIC_ENABLED"
  | "COUPLE_COURT_MOCK_ENABLED"
>>;

function enabledByExplicitProductionFlag(
  value: string | undefined,
  environment: CourtEnvironment,
): boolean {
  if (environment.NODE_ENV === "production") return value === "true";
  return value !== "false";
}

export function isCoupleCourtEnabled(environment: CourtEnvironment = process.env): boolean {
  return enabledByExplicitProductionFlag(environment.COUPLE_COURT_ENABLED, environment);
}

export function isCoupleCourtAiEnabled(environment: CourtEnvironment = process.env): boolean {
  if (!isCoupleCourtEnabled(environment)) return false;
  if (environment.COUPLE_COURT_AI_ENABLED === "true") return true;
  return environment.NODE_ENV !== "production"
    && environment.COUPLE_COURT_MOCK_ENABLED === "true";
}

export function isCoupleCourtPublicEnabled(environment: CourtEnvironment = process.env): boolean {
  return isCoupleCourtEnabled(environment)
    && enabledByExplicitProductionFlag(environment.COUPLE_COURT_PUBLIC_ENABLED, environment);
}

export function requireCoupleCourtEnabled(): void {
  if (!isCoupleCourtEnabled()) {
    throw new CourtApiError(404, "COUPLE_COURT_DISABLED", "커플재판소를 준비하고 있어요.");
  }
}

export function requireCoupleCourtAiEnabled(): void {
  if (!isCoupleCourtAiEnabled()) {
    throw new CourtApiError(
      503,
      "COUPLE_COURT_AI_UNAVAILABLE",
      "지금은 한방 판결을 만들 수 없어요. 잠시 후 다시 시도해 주세요.",
    );
  }
}

export function requireCoupleCourtPublicEnabled(): void {
  if (!isCoupleCourtPublicEnabled()) {
    throw new CourtApiError(404, "COUPLE_COURT_PUBLIC_DISABLED", "공개재판을 준비하고 있어요.");
  }
}

export async function requireCourtUser(request: Request): Promise<{ id: string }> {
  const user = await getOptionalCourtUser(request);
  if (!user) {
    throw new CourtApiError(401, "AUTH_REQUIRED", "로그인이 필요해요.");
  }
  return user;
}

export async function getOptionalCourtUser(request: Request): Promise<{ id: string } | null> {
  const supabase = await createClientFromRequest(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id } : null;
}

export function requireSafeJsonMutation(request: Request): void {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new CourtApiError(415, "JSON_REQUIRED", "JSON 요청만 처리할 수 있어요.");
  }

  // Native clients authenticate with an explicit bearer token and do not
  // necessarily send browser Origin/Sec-Fetch-Site headers. This exception
  // relies on createClientFromRequest selecting a cookie-free token client
  // whenever this header is present; keep that isolation under regression test.
  if (parseBearerAccessToken(request.headers.get("authorization"))) return;

  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin && origin !== requestOrigin) {
    throw new CourtApiError(403, "CROSS_SITE_REQUEST_BLOCKED", "요청 출처를 확인할 수 없어요.");
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new CourtApiError(403, "CROSS_SITE_REQUEST_BLOCKED", "요청 출처를 확인할 수 없어요.");
  }
}

export async function readCourtJson(
  request: Request,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
  requireSafeJsonMutation(request);

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new CourtApiError(413, "REQUEST_TOO_LARGE", "입력 내용이 너무 길어요.");
  }

  if (!request.body) {
    throw new CourtApiError(400, "INVALID_JSON", "요청 형식을 확인해 주세요.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let actualBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      actualBytes += value.byteLength;
      if (actualBytes > maxBytes) {
        try {
          await reader.cancel("request body exceeds Couple Court limit");
        } catch {
          // The bounded read has already stopped; transport cancellation is
          // best-effort and must not replace the safe 413 response.
        }
        throw new CourtApiError(413, "REQUEST_TOO_LARGE", "입력 내용이 너무 길어요.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(actualBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CourtApiError(400, "INVALID_JSON", "요청 형식을 확인해 주세요.");
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new CourtApiError(400, "INVALID_JSON", "요청 형식을 확인해 주세요.");
  }
  if (!isRecord(body)) {
    throw new CourtApiError(400, "INVALID_BODY", "요청 형식을 확인해 주세요.");
  }
  return body;
}

/**
 * Sanitizes a user-authored court field without silently truncating it.
 * Truncation can discard a safety disclosure at the end of a statement and
 * violates the promise that a failed submission preserves what the user wrote.
 */
export function cleanCourtText(
  raw: unknown,
  maximum: number,
  label: string,
): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length > maximum) {
    throw new CourtApiError(
      400,
      "COURT_FIELD_TOO_LONG",
      `${label}은(는) ${maximum.toLocaleString("ko-KR")}자 이하로 적어 주세요. 작성한 내용은 화면에 그대로 남아 있어요.`,
    );
  }
  const value = sanitizeText(raw).trim();
  if (value.length > maximum) {
    throw new CourtApiError(
      400,
      "COURT_FIELD_TOO_LONG",
      `${label}은(는) ${maximum.toLocaleString("ko-KR")}자 이하로 적어 주세요. 작성한 내용은 화면에 그대로 남아 있어요.`,
    );
  }
  return value.length > 0 ? value : null;
}

export function courtErrorResponse(error: unknown): NextResponse {
  if (error instanceof CourtApiError) {
    return noStoreJson(
      { code: error.code, error: error.message },
      { status: error.status },
    );
  }

  // Avoid persisting or returning free-text statements through error channels.
  console.error("COUPLE_COURT_REQUEST_FAILED");
  return noStoreJson(
    { code: "COUPLE_COURT_REQUEST_FAILED", error: "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요." },
    { status: 500 },
  );
}

export function noStoreJson(data: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(data, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Authorization, Cookie");
  return response;
}
