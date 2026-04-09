import { NextResponse } from "next/server";

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
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      },
    );
  }

  return null;
}

/** IP 또는 유저 ID 기반 키 생성 */
export function rateLimitKey(
  prefix: string,
  req: Request,
  userId?: string,
): string {
  if (userId) return `${prefix}:${userId}`;
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
  return `${prefix}:${ip}`;
}
