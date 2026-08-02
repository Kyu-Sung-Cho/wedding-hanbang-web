import { createHmac, timingSafeEqual } from "node:crypto";

export const AMORA_EVAL_HEADER = "x-amora-eval";

const TOKEN_VERSION = "v1";
const MAX_TOKEN_AGE_MS = 5 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 30 * 1000;
const MIN_SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 512;
const MIN_UNIQUE_SECRET_CHARACTERS = 12;
const UNSAFE_SECRET_PATTERN =
  /(?:placeholder|example|test-only|replace-with|not-a-real)/i;

function isPlausibleEvalSecret(secret: string): boolean {
  const byteLength = Buffer.byteLength(secret, "utf8");
  return (
    byteLength >= MIN_SECRET_LENGTH
    && byteLength <= MAX_SECRET_LENGTH
    && !/[\s\u0000-\u001f\u007f]/u.test(secret)
    && new Set(secret).size >= MIN_UNIQUE_SECRET_CHARACTERS
    && !UNSAFE_SECRET_PATTERN.test(secret)
  );
}

function signatureFor(secret: string, requestId: string, issuedAt: string): string {
  return createHmac("sha256", secret)
    .update(`${TOKEN_VERSION}:${issuedAt}:${requestId}`)
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Release evaluation requests are bound to one client request id and expire
 * quickly. This keeps the evaluation-only quota path unavailable to public
 * demo clients even if a token is copied from an old request.
 */
export function createAmoraEvalToken(
  secret: string,
  requestId: string,
  now = Date.now(),
): string {
  if (!isPlausibleEvalSecret(secret)) {
    throw new Error("AMORA_EVAL_SECRET_INVALID");
  }
  const issuedAt = String(now);
  return `${TOKEN_VERSION}.${issuedAt}.${signatureFor(secret, requestId, issuedAt)}`;
}

export function verifyAmoraEvalToken(
  token: string | null | undefined,
  requestId: string,
  options: { now?: number; secret?: string } = {},
): boolean {
  if (!token || token.length > 200) return false;
  const secret = options.secret ?? process.env.AMORA_EVAL_SECRET ?? "";
  if (!isPlausibleEvalSecret(secret)) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, issuedAtText, signature] = parts;
  if (version !== TOKEN_VERSION || !/^\d{13}$/.test(issuedAtText) || !signature) return false;

  const now = options.now ?? Date.now();
  const issuedAt = Number(issuedAtText);
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > now + MAX_FUTURE_SKEW_MS ||
    now - issuedAt > MAX_TOKEN_AGE_MS
  ) {
    return false;
  }

  return safeEqual(signature, signatureFor(secret, requestId, issuedAtText));
}
