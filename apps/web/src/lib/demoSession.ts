import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { NextResponse } from "next/server";

const DEMO_MODE_COOKIE = "demo_mode";
const DEMO_SESSION_COOKIE = "demo_session";
const DEMO_TOKEN_VERSION = "v1";
const DEMO_SESSION_ID_BYTES = 16;
const DEMO_SESSION_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const DEMO_SIGNATURE_RE = /^[A-Za-z0-9_-]{43}$/;
const DEMO_MAX_AGE_SECONDS = 24 * 60 * 60;
const DEMO_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface SignedDemoSession {
  token: string;
  issuedAt: number;
  sessionId: string;
  /** One synthetic UUID shared by demo turns in the same KST calendar day. */
  dailyCostLedgerId: string;
}

function getDemoSecret(): string | null {
  const secret = process.env.DEMO_SESSION_SECRET;
  if (!secret) return null;

  const byteLength = Buffer.byteLength(secret, "utf8");
  const isStrong =
    byteLength >= 32
    && byteLength <= 512
    && !/[\s\u0000-\u001f\u007f]/u.test(secret)
    && new Set(secret).size >= 12
    && !/(?:placeholder|example|test-only|replace-with|not-a-real)/iu.test(secret);
  return isStrong ? secret : null;
}

function signPayload(payload: string): string | null {
  const secret = getDemoSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deriveDailyCostLedgerId(now: number): string {
  const kstDay = new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);
  const bytes = Buffer.from(
    createHash("sha256")
      .update(`hanbang-demo-daily-cost-ledger\0${kstDay}`, "utf8")
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return formatUuid(bytes);
}

function readDemoSessionToken(
  token: string | undefined | null,
  now: number,
): SignedDemoSession | null {
  if (!token || !Number.isSafeInteger(now) || now < 0) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, rawIssuedAt, sessionId, signature] = parts;
  if (
    version !== DEMO_TOKEN_VERSION
    || !/^(?:0|[1-9]\d{0,15})$/.test(rawIssuedAt ?? "")
    || !DEMO_SESSION_ID_RE.test(sessionId ?? "")
    || !DEMO_SIGNATURE_RE.test(signature ?? "")
  ) {
    return null;
  }

  const issuedAt = Number(rawIssuedAt);
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) return null;
  if (issuedAt > now + DEMO_MAX_FUTURE_SKEW_MS) return null;
  if (now - issuedAt > DEMO_MAX_AGE_SECONDS * 1000) return null;

  const payload = `${version}.${rawIssuedAt}.${sessionId}`;
  const expected = signPayload(payload);
  if (!expected || !safeEqual(signature!, expected)) return null;

  return {
    token,
    issuedAt,
    sessionId: sessionId!,
    dailyCostLedgerId: deriveDailyCostLedgerId(now),
  };
}

export function createDemoSessionToken(
  now = Date.now(),
  sessionId = randomBytes(DEMO_SESSION_ID_BYTES).toString("base64url"),
): string | null {
  if (!Number.isSafeInteger(now) || now < 0 || !DEMO_SESSION_ID_RE.test(sessionId)) {
    return null;
  }
  const payload = `${DEMO_TOKEN_VERSION}.${now}.${sessionId}`;
  const signature = signPayload(payload);
  return signature ? `${payload}.${signature}` : null;
}

export function verifyDemoSessionToken(
  token: string | undefined | null,
  now = Date.now(),
): boolean {
  return readDemoSessionToken(token, now) !== null;
}

export function getCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return rawValue.join("=") || "";
  }
  return null;
}

export function getSignedDemoSessionFromCookieHeader(
  cookieHeader: string | null | undefined,
  now = Date.now(),
): SignedDemoSession | null {
  if (getCookieValue(cookieHeader, DEMO_MODE_COOKIE) !== "true") return null;
  return readDemoSessionToken(
    getCookieValue(cookieHeader, DEMO_SESSION_COOKIE),
    now,
  );
}

export function hasSignedDemoSessionFromCookieHeader(
  cookieHeader: string | null | undefined,
): boolean {
  return getSignedDemoSessionFromCookieHeader(cookieHeader) !== null;
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
