import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
}

function rateLimitResponse(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, retryAfter)) },
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

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + config.windowMs });
    return null;
  }

  bucket.count++;

  if (bucket.count > config.maxRequests) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return rateLimitResponse(retryAfter);
  }

  return null;
}

let adminClient: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  adminClient ??= createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return adminClient;
}

/**
 * 서버리스 인스턴스를 넘어 공유되는 rate limit.
 * Supabase RPC가 없거나 실패하면 기존 인메모리 limiter로 fallback한다.
 */
export async function checkRateLimitPersistent(
  key: string,
  config: RateLimitConfig,
): Promise<NextResponse | null> {
  const admin = getAdminClient();
  if (!admin) return checkRateLimit(key, config);

  try {
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_key: key,
      p_max_requests: config.maxRequests,
      p_window_ms: config.windowMs,
    });
    if (error) {
      console.error("[rateLimit] persistent check failed; falling back:", error.message);
      return checkRateLimit(key, config);
    }

    const result = Array.isArray(data) ? data[0] : data;
    const allowed = result?.allowed === true;
    if (allowed) return null;

    const retryAfter = Number(result?.retry_after_seconds ?? Math.ceil(config.windowMs / 1000));
    return rateLimitResponse(retryAfter);
  } catch (err) {
    console.error("[rateLimit] persistent check exception; falling back:", err);
    return checkRateLimit(key, config);
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
export function rateLimitKey(
  prefix: string,
  req: Request,
  userId?: string,
): string {
  if (userId) return `${prefix}:${userId}`;
  return `${prefix}:${getClientIp(req) ?? "unknown"}`;
}
