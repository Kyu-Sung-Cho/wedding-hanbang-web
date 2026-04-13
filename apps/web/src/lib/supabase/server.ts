import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
}

/**
 * 모바일 앱 호환: Authorization: Bearer <token> 헤더로 Supabase 클라이언트 생성
 * 쿠키가 없는 환경(Expo 앱)에서 웹 API Route 호출할 때 사용
 */
export function createClientFromToken(accessToken: string) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }
  );
}

/**
 * Request에서 인증된 Supabase 클라이언트 생성
 * 1순위: Authorization Bearer 토큰 (모바일)
 * 2순위: Request의 Cookie 헤더에서 직접 파싱 (Vercel 호환)
 * 3순위: Next.js cookies() (SSR)
 */
export async function createClientFromRequest(request: Request) {
  // 1순위: Bearer 토큰
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return createClientFromToken(authHeader.substring(7));
  }

  // 2순위: Request Cookie 헤더에서 직접 파싱
  const cookieHeader = request.headers.get("cookie") ?? "";
  const parsedCookies: Array<{ name: string; value: string }> = [];
  if (cookieHeader) {
    cookieHeader.split(";").forEach((c) => {
      const [name, ...rest] = c.trim().split("=");
      if (name) {
        parsedCookies.push({ name: name.trim(), value: rest.join("=").trim() });
      }
    });
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => parsedCookies,
        setAll: () => {},
      },
    }
  );
}
