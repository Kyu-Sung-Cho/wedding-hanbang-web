import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";

export const ADMIN_STEP_UP_COOKIE = "hanbang_admin_step_up";
export const ADMIN_STEP_UP_MAX_AGE_SECONDS = 15 * 60;

const TOKEN_VERSION = "v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_FUTURE_SKEW_SECONDS = 30;

function getAdminStepUpKey(): Buffer | null {
  const secret = process.env.ADMIN_PASSWORD;
  if (
    typeof secret !== "string"
    || Buffer.byteLength(secret, "utf8") < 32
    || Buffer.byteLength(secret, "utf8") > 512
    || /[\s\u0000-\u001f\u007f]/u.test(secret)
    || new Set(secret).size < 12
  ) {
    return null;
  }

  return createHash("sha256")
    .update("hanbang-admin-step-up-v1\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

function sign(payload: string): string | null {
  const key = getAdminStepUpKey();
  return key
    ? createHmac("sha256", key).update(payload, "utf8").digest("base64url")
    : null;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length
    && timingSafeEqual(leftBytes, rightBytes);
}

function cookieValue(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === ADMIN_STEP_UP_COOKIE) return value.join("=") || null;
  }
  return null;
}

export function createAdminStepUpToken(
  userId: string,
  nowMs = Date.now(),
  nonce = randomBytes(16).toString("base64url"),
): string | null {
  if (
    !UUID_PATTERN.test(userId)
    || !Number.isSafeInteger(nowMs)
    || nowMs < 0
    || !NONCE_PATTERN.test(nonce)
  ) {
    return null;
  }

  const issuedAt = Math.floor(nowMs / 1000);
  const expiresAt = issuedAt + ADMIN_STEP_UP_MAX_AGE_SECONDS;
  const payload = `${TOKEN_VERSION}.${issuedAt}.${expiresAt}.${userId.toLowerCase()}.${nonce}`;
  const signature = sign(payload);
  return signature ? `${payload}.${signature}` : null;
}

export function verifyAdminStepUpToken(
  token: string | null | undefined,
  expectedUserId: string,
  nowMs = Date.now(),
): boolean {
  if (
    !token
    || !UUID_PATTERN.test(expectedUserId)
    || !Number.isSafeInteger(nowMs)
    || nowMs < 0
  ) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 6) return false;
  const [version, rawIssuedAt, rawExpiresAt, userId, nonce, signature] = parts;
  if (
    version !== TOKEN_VERSION
    || !/^(?:0|[1-9]\d{0,15})$/u.test(rawIssuedAt ?? "")
    || !/^(?:0|[1-9]\d{0,15})$/u.test(rawExpiresAt ?? "")
    || !UUID_PATTERN.test(userId ?? "")
    || userId?.toLowerCase() !== expectedUserId.toLowerCase()
    || !NONCE_PATTERN.test(nonce ?? "")
    || !SIGNATURE_PATTERN.test(signature ?? "")
  ) {
    return false;
  }

  const issuedAt = Number(rawIssuedAt);
  const expiresAt = Number(rawExpiresAt);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    !Number.isSafeInteger(issuedAt)
    || !Number.isSafeInteger(expiresAt)
    || expiresAt - issuedAt !== ADMIN_STEP_UP_MAX_AGE_SECONDS
    || issuedAt > nowSeconds + MAX_FUTURE_SKEW_SECONDS
    || expiresAt <= nowSeconds
  ) {
    return false;
  }

  const payload = parts.slice(0, 5).join(".");
  const expectedSignature = sign(payload);
  return expectedSignature !== null && safeEqual(signature!, expectedSignature);
}

export function hasAdminStepUp(
  cookieHeader: string | null | undefined,
  expectedUserId: string,
  nowMs = Date.now(),
): boolean {
  return verifyAdminStepUpToken(
    cookieValue(cookieHeader),
    expectedUserId,
    nowMs,
  );
}

export function setAdminStepUpCookie(
  response: NextResponse,
  userId: string,
): boolean {
  const token = createAdminStepUpToken(userId);
  if (!token) return false;

  response.cookies.set(ADMIN_STEP_UP_COOKIE, token, {
    path: "/api/admin",
    maxAge: ADMIN_STEP_UP_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    priority: "high",
  });
  return true;
}

export function clearAdminStepUpCookie(response: NextResponse): void {
  response.cookies.set(ADMIN_STEP_UP_COOKIE, "", {
    path: "/api/admin",
    maxAge: 0,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}
