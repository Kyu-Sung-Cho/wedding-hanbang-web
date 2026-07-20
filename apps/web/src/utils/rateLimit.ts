import { createHash, createHmac } from "node:crypto";
import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient as createPinnedAdminClient } from "@/lib/supabase/admin";
import { mobileBridgeJson } from "@/lib/mobile/boundedJsonResponse";

// 간단한 인메모리 Rate Limiter (서버리스 환경)
// Vercel 서버리스에서는 인스턴스당 메모리 — 완벽하지 않지만 기본 방어용
const buckets = new Map<string, { count: number; resetAt: number }>();

// 5분마다 오래된 엔트리 정리
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 300_000) return;
  lastCleanup = now;
  for (const [key, val] of buckets) {
    if (val.resetAt < now) buckets.delete(key);
  }
}

export interface RateLimitConfig {
  /** 윈도우(ms) 내 허용 요청 수 */
  maxRequests: number;
  /** 윈도우 크기(ms) */
  windowMs: number;
  /** 한 호출이 소비하는 원자적 단위. 배치가 아니면 1. */
  cost?: number;
}

export interface PersistentRateLimitOptions {
  /**
   * Defaults to true: a shared-store failure must not silently become an
   * instance-local allowance in a horizontally scaled deployment. Set false
   * only for an explicitly reviewed, non-sensitive best-effort endpoint.
   */
  failClosed?: boolean;
}

function rateLimitResponse(retryAfter: number): NextResponse {
  return mobileBridgeJson(
    { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, retryAfter)) },
    },
  );
}

function rateLimitUnavailableResponse(): NextResponse {
  return mobileBridgeJson(
    { error: "요청 제한 확인에 실패했습니다. 잠시 후 다시 시도해주세요." },
    {
      status: 503,
      headers: { "Retry-After": "60" },
    },
  );
}

/**
 * Rate limit 체크.
 * @returns null이면 통과, NextResponse면 차단됨
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): NextResponse | null {
  cleanup();

  const now = Date.now();
  const bucket = buckets.get(key);
  const cost = Number.isSafeInteger(config.cost) && (config.cost ?? 0) > 0
    ? config.cost!
    : 1;

  if (cost > config.maxRequests) {
    return rateLimitResponse(Math.ceil(config.windowMs / 1000));
  }

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: cost, resetAt: now + config.windowMs });
    return null;
  }

  if (bucket.count > config.maxRequests - cost) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return rateLimitResponse(retryAfter);
  }

  bucket.count += cost;

  return null;
}

function getAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createPinnedAdminClient();
}

/**
 * 서버리스 인스턴스를 넘어 공유되는 rate limit.
 * Shared-store failures are fail-closed by default. An explicitly reviewed
 * best-effort endpoint may opt into the instance-local fallback.
 */
export async function checkRateLimitPersistent(
  key: string,
  config: RateLimitConfig,
  options: PersistentRateLimitOptions = {},
): Promise<NextResponse | null> {
  const failClosed = options.failClosed !== false;
  const admin = getAdminClient();
  if (!admin) {
    return failClosed
      ? rateLimitUnavailableResponse()
      : checkRateLimit(key, config);
  }

  try {
    const cost = Number.isSafeInteger(config.cost) && (config.cost ?? 0) > 0
      ? config.cost!
      : 1;
    const { data, error } = await admin.rpc("check_rate_limit_cost", {
      p_key: key,
      p_max_requests: config.maxRequests,
      p_window_ms: config.windowMs,
      p_cost: cost,
    });
    if (error) {
      console.error("[rateLimit] persistent check failed:", error.message);
      return failClosed
        ? rateLimitUnavailableResponse()
        : checkRateLimit(key, config);
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (result?.allowed === true) return null;
    if (result?.allowed !== false) {
      console.error("[rateLimit] persistent check returned an invalid result");
      return failClosed
        ? rateLimitUnavailableResponse()
        : checkRateLimit(key, config);
    }

    const rawRetryAfter = Number(result.retry_after_seconds);
    const retryAfter = Number.isFinite(rawRetryAfter) && rawRetryAfter > 0
      ? Math.ceil(rawRetryAfter)
      : Math.ceil(config.windowMs / 1000);
    return rateLimitResponse(retryAfter);
  } catch (err) {
    console.error("[rateLimit] persistent check exception:", err);
    return failClosed
      ? rateLimitUnavailableResponse()
      : checkRateLimit(key, config);
  }
}

/**
 * 클라이언트 IP 추출 — 스푸핑 저항 (감사 2.2 M2).
 * Vercel이 실제 접속 IP로 설정하는 x-real-ip를 우선 신뢰.
 * XFF 폴백은 "최우측" 토큰만 사용 — 최좌측은 클라이언트가 헤더에 임의 값을
 * 넣어 조작 가능하지만(익명 rate limit 우회 벡터), 최우측은 마지막 신뢰
 * 프록시가 붙인 값이다. Turnstile remoteip 등 IP가 필요한 곳도 이걸 쓴다.
 */
export function getClientIp(req: Request): string | null {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = req.headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const tokens = forwarded.split(",").map((t) => t.trim()).filter(Boolean);
  return tokens.length > 0 ? tokens[tokens.length - 1] : null;
}

/** IP 또는 유저 ID 기반 키 생성 */
/**
 * Build a stable, pseudonymous rate-limit bucket key.
 *
 * Production must configure RATE_LIMIT_KEY_SECRET (enforced by the release
 * gate) so identifiers cannot be recovered with a cheap dictionary attack.
 * The unkeyed SHA-256 fallback keeps local/test databases free of raw
 * identifiers without making developer environments depend on a secret.
 */
export function rateLimitSubjectKey(prefix: string, subject: string): string {
  const secret = process.env.RATE_LIMIT_KEY_SECRET?.trim();
  const payload = `${prefix}\0${subject}`;
  if (secret) {
    const digest = createHmac("sha256", secret).update(payload).digest("hex");
    return `${prefix}:hmac-sha256:${digest}`;
  }

  const digest = createHash("sha256").update(payload).digest("hex");
  return `${prefix}:sha256:${digest}`;
}

export function rateLimitKey(
  prefix: string,
  req: Request,
  userId?: string,
): string {
  return rateLimitSubjectKey(prefix, userId ?? getClientIp(req) ?? "unknown");
}
