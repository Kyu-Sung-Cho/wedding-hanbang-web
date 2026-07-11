import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";

const DEMO_MODE_COOKIE = "demo_mode";
const DEMO_SESSION_COOKIE = "demo_session";
const DEMO_MAX_AGE_SECONDS = 24 * 60 * 60;
const LOCAL_DEMO_SECRET = "wedding-hanbang-local-demo-session-v1";

function getDemoSecret(): string | null {
  const configured = (
    process.env.DEMO_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.ADMIN_PASSWORD ||
    null
  );
  if (configured) return configured;
  // 계정·Supabase 없이 예시 앱을 점검할 수 있게 로컬/테스트에서만
  // 고정 fallback을 쓴다. production은 전용 secret이 없으면 fail-closed다.
  return process.env.NODE_ENV === "production" ? null : LOCAL_DEMO_SECRET;
}

function signPayload(payload: string): string | null {
  const secret = getDemoSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createDemoSessionToken(now = Date.now()): string | null {
  const payload = String(now);
  const signature = signPayload(payload);
  return signature ? `${payload}.${signature}` : null;
}

export function verifyDemoSessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const issuedAt = Number(payload);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > DEMO_MAX_AGE_SECONDS * 1000) return false;

  const expected = signPayload(payload);
  return Boolean(expected && safeEqual(signature, expected));
}

export function getCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return rawValue.join("=") || "";
  }
  return null;
}

export function hasSignedDemoSessionFromCookieHeader(cookieHeader: string | null | undefined): boolean {
  const marker = getCookieValue(cookieHeader, DEMO_MODE_COOKIE);
  const session = getCookieValue(cookieHeader, DEMO_SESSION_COOKIE);
  return marker === "true" && verifyDemoSessionToken(session);
}

export function setDemoCookies(response: NextResponse): boolean {
  const token = createDemoSessionToken();
  if (!token) return false;

  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(DEMO_MODE_COOKIE, "true", {
    path: "/",
    maxAge: DEMO_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure,
  });
  response.cookies.set(DEMO_SESSION_COOKIE, token, {
    path: "/",
    maxAge: DEMO_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    secure,
  });
  return true;
}

export function clearDemoCookies(response: NextResponse): void {
  response.cookies.set(DEMO_MODE_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(DEMO_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}
