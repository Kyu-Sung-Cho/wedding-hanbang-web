import { NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isRecord } from "@/utils/requestValidation";
import { sanitizeText } from "@/utils/sanitize";

const DEFAULT_MAX_BODY_BYTES = 32 * 1024;

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
  // necessarily send browser Origin/Sec-Fetch-Site headers.
  if (request.headers.get("authorization")?.startsWith("Bearer ")) return;

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

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new CourtApiError(413, "REQUEST_TOO_LARGE", "입력 내용이 너무 길어요.");
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
    return NextResponse.json(
      { code: error.code, error: error.message },
      { status: error.status },
    );
  }

  // Avoid persisting or returning free-text statements through error channels.
  console.error("COUPLE_COURT_REQUEST_FAILED");
  return NextResponse.json(
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
