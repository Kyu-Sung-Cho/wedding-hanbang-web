import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearDemoCookies } from "@/lib/demoSession";
import {
  getOptionalSameOriginRedirectPath,
  getPostLoginRedirectPath,
} from "@/lib/auth/safeRedirect";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

const PRIVATE_NO_STORE = "private, no-store, max-age=0, must-revalidate";

function privateRedirect(destination: URL) {
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", PRIVATE_NO_STORE);
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function loginErrorDestination(
  origin: string,
  loginPath: string,
  error: string,
  requestedPath: string | null,
): URL {
  const destination = new URL(loginPath, origin);
  destination.searchParams.set("error", error);
  if (requestedPath) destination.searchParams.set("redirect", requestedPath);
  return destination;
}

export async function GET(request: Request) {
  const { search, searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const from = searchParams.get("from");
  const requestedPostLoginPath = getOptionalSameOriginRedirectPath(
    searchParams.get("redirect"),
    origin,
  );
  const postLoginPath = from === "demo"
    ? "/wedding/lounge"
    : getPostLoginRedirectPath(search, origin, true);
  // 데모 로그인에서 온 경우 에러 리다이렉트를 /demo/login으로
  const loginPath = from === "demo" ? "/demo/login" : "/login";

  if (!code) {
    console.error("콜백: code 파라미터 없음");
    return privateRedirect(loginErrorDestination(
      origin,
      loginPath,
      "no_code",
      requestedPostLoginPath,
    ));
  }

  const limited = await checkRateLimitPersistent(
    rateLimitKey("auth:callback", request),
    { maxRequests: 60, windowMs: 10 * 60 * 1000 },
  );
  if (limited) {
    return privateRedirect(loginErrorDestination(
      origin,
      loginPath,
      "rate_limited",
      requestedPostLoginPath,
    ));
  }

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
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
              // Server Component 에서 호출 시 무시
            }
          },
        },
      }
    );

    const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

    if (sessionError) {
      console.error("콜백: 세션 교환 에러:", safeErrorDiagnostic(sessionError));
      return privateRedirect(loginErrorDestination(
        origin,
        loginPath,
        "session_exchange_failed",
        requestedPostLoginPath,
      ));
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error("콜백: 세션 교환 후 user가 null");
      return privateRedirect(loginErrorDestination(
        origin,
        loginPath,
        "no_user",
        requestedPostLoginPath,
      ));
    }

    // 고객 전용: 프로필/온보딩 체크
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("onboarding_completed")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("콜백: 프로필 조회 에러:", safeErrorDiagnostic(profileError));
    }

    if (!profile || !profile.onboarding_completed) {
      const onboardingPath = from === "demo"
        ? "/wedding/onboarding"
        : getPostLoginRedirectPath(search, origin, false);
      const response = privateRedirect(new URL(onboardingPath, origin));
      // 실제 로그인 시 데모 모드 쿠키 제거
      clearDemoCookies(response);
      return response;
    }

    // 일반 고객 → 대시보드
    const response = privateRedirect(new URL(postLoginPath, origin));
    // 실제 로그인 시 데모 모드 쿠키 제거
    clearDemoCookies(response);
    return response;
  } catch (err) {
    console.error("콜백: 예외 발생:", safeErrorDiagnostic(err));
    return privateRedirect(loginErrorDestination(
      origin,
      loginPath,
      "callback_failed",
      requestedPostLoginPath,
    ));
  }
}
