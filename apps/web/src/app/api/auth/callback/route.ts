import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SIGNUP_CONSENT_PATH, hasRecordedSignupConsent } from "@hanbang/shared";
import { clearDemoCookies } from "@/lib/demoSession";
import {
  getOptionalSameOriginRedirectPath,
  getPostLoginRedirectPath,
} from "@/lib/auth/safeRedirect";

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
    return NextResponse.redirect(loginErrorDestination(
      origin,
      loginPath,
      "no_code",
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
      console.error("콜백: 세션 교환 에러:", sessionError.message);
      return NextResponse.redirect(loginErrorDestination(
        origin,
        loginPath,
        sessionError.message,
        requestedPostLoginPath,
      ));
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error("콜백: 세션 교환 후 user가 null");
      return NextResponse.redirect(loginErrorDestination(
        origin,
        loginPath,
        "no_user",
        requestedPostLoginPath,
      ));
    }

    // 소셜 로그인은 Supabase 가 계정을 직접 만든다. 그 경로로 처음 들어온
    // 사람은 가입 화면을 거치지 않았으므로 동의 화면을 본 적도, 기록도 없다.
    // 제품 화면에 들여보내기 전에 동의를 받는다. 온보딩보다 앞이다 —
    // 온보딩은 이미 제품 사용이다.
    if (!hasRecordedSignupConsent(user.user_metadata)) {
      const consentUrl = new URL(SIGNUP_CONSENT_PATH, origin);
      const intended = from === "demo"
        ? "/wedding/onboarding"
        : getPostLoginRedirectPath(search, origin, false);
      consentUrl.searchParams.set("redirect", intended);
      const response = NextResponse.redirect(consentUrl);
      clearDemoCookies(response);
      return response;
    }

    // 고객 전용: 프로필/온보딩 체크
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("onboarding_completed")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("콜백: 프로필 조회 에러:", profileError.message);
    }

    if (!profile || !profile.onboarding_completed) {
      const onboardingPath = from === "demo"
        ? "/wedding/onboarding"
        : getPostLoginRedirectPath(search, origin, false);
      const response = NextResponse.redirect(new URL(onboardingPath, origin));
      // 실제 로그인 시 데모 모드 쿠키 제거
      clearDemoCookies(response);
      return response;
    }

    // 일반 고객 → 대시보드
    const response = NextResponse.redirect(new URL(postLoginPath, origin));
    response.cookies.set("onboarding_complete", "true", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    // 실제 로그인 시 데모 모드 쿠키 제거
    clearDemoCookies(response);
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("콜백: 예외 발생:", msg);
    return NextResponse.redirect(loginErrorDestination(
      origin,
      loginPath,
      msg,
      requestedPostLoginPath,
    ));
  }
}
