import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, createHmac } from "node:crypto";

// 간단한 인메모리 Rate Limiter (서버리스 환경)
// Vercel 서버리스에서는 인스턴스당 메모리 — 완벽하지 않지만 기본 방어용
const buckets = new Map<string, { count: number; resetAt: number }>();

function protectedRateLimitKey(rawKey: string): string {
  const secret = process.env.RATE_LIMIT_KEY_SECRET?.trim();
  const digest = secret && secret.length >= 32
    ? createHmac("sha256", secret).update(`weddinghanbang-rate-limit-v1\0${rawKey}`).digest("hex")
    : createHash("sha256").update(`weddinghanbang-rate-limit-v1\0${rawKey}`).digest("hex");
  return `rl:${digest}`;
}

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

function protectedSubjectRateLimitResponse(errorCode?: string): NextResponse {
  if (errorCode === "42501") {
    return NextResponse.json(
      {
        code: "ACCOUNT_REQUEST_BLOCKED",
        error: "현재 계정 상태로는 요청을 처리할 수 없습니다.",
      },
      { status: 403 },
    );
  }

  if (errorCode === "22023") {
    return NextResponse.json(
      {
        code: "RATE_LIMIT_SUBJECT_CONFLICT",
        error: "요청 상태가 일치하지 않습니다. 새로고침 후 다시 시도해주세요.",
      },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      code: "RATE_LIMIT_UNAVAILABLE",
      error: "요청 보호 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
    },
    {
      status: 503,
      headers: { "Retry-After": "5" },
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
  const protectedKey = protectedRateLimitKey(key);

  const now = Date.now();
  const bucket = buckets.get(protectedKey);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(protectedKey, { count: 1, resetAt: now + config.windowMs });
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
  subjectUserId?: string | null,
): Promise<NextResponse | null> {
  const admin = getAdminClient();
  if (!admin) {
    return subjectUserId
      ? protectedSubjectRateLimitResponse()
      : checkRateLimit(key, config);
  }
  const protectedKey = protectedRateLimitKey(key);

  try {
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_key: protectedKey,
      p_max_requests: config.maxRequests,
      p_window_ms: config.windowMs,
      p_subject_user_id: subjectUserId ?? null,
    });
    if (error) {
      console.error("[rateLimit] persistent check failed:", error.message);
      return subjectUserId
        ? protectedSubjectRateLimitResponse(error.code)
        : checkRateLimit(key, config);
    }

    const result = Array.isArray(data) ? data[0] : data;
    const allowed = result?.allowed === true;
    if (allowed) return null;

    const retryAfter = Number(result?.retry_after_seconds ?? Math.ceil(config.windowMs / 1000));
    return rateLimitResponse(retryAfter);
  } catch (err) {
    console.error("[rateLimit] persistent check exception:", err);
    return subjectUserId
      ? protectedSubjectRateLimitResponse()
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
export function rateLimitKey(
  prefix: string,
  req: Request,
  userId?: string,
): string {
  if (userId) return `${prefix}:${userId}`;
  return `${prefix}:${getClientIp(req) ?? "unknown"}`;
}
