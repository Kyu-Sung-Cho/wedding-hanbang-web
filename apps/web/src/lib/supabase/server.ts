import { createServerClient } from "@supabase/ssr";

import { parseAuthorizationHeader } from "@/utils/bearerAuthorization";

type RequestClientOptions = { fetch?: typeof fetch };

function createAnonymousClient(options?: RequestClientOptions) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} },
      ...(options?.fetch ? { global: { fetch: options.fetch } } : {}) }
  );
}

/**
 * 쿠키 기반 Supabase 클라이언트 (웹 SSR 전용)
 * Server Components, Server Actions에서 사용
 */
export async function createClient(options?: RequestClientOptions) {
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();

    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        ...(options?.fetch ? { global: { fetch: options.fetch } } : {}),
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Server Component에서 호출 시 무시
            }
          },
        },
      }
    );
  } catch {
    // cookies() 실패 시 익명 클라이언트 (API Route 외부 호출 등)
    return createAnonymousClient(options);
  }
}

/**
 * Bearer 토큰으로 Supabase 클라이언트 생성 (모바일 앱용)
 */
export function createClientFromToken(accessToken: string, options?: RequestClientOptions) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
      global: { headers: { Authorization: `Bearer ${accessToken}` }, ...(options?.fetch ? { fetch: options.fetch } : {}) },
    }
  );
}

/**
 * Request에서 인증된 Supabase 클라이언트 생성
 * 1순위: Authorization Bearer 토큰 (모바일)
 * 2순위: Request Cookie 헤더 직접 파싱 (API Route)
 */
export async function createClientFromRequest(request: Request, options?: RequestClientOptions) {
  // 1순위: Bearer 토큰 (모바일 앱)
  const authorization = parseAuthorizationHeader(request.headers.get("authorization"));
  if (authorization.kind === "bearer") return createClientFromToken(authorization.token, options);

  // A caller that explicitly supplied malformed credentials must never inherit
  // a browser cookie session as a fallback identity.
  if (authorization.kind === "invalid") return createAnonymousClient(options);

  // 2순위: Next.js cookies() (웹 브라우저 — 세션 read+write 지원)
  return createClient(options);
}
