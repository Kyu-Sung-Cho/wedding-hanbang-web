import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearDemoCookies } from "@/lib/demoSession";
import { withoutUnreadableSupabaseCookies } from "@/lib/supabase/authCookies";
import { resolvePostAuthLanding } from "@/lib/auth/postAuthLanding";
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
          // 상한 쿠키가 남아 있어도 새 로그인은 되어야 한다. 그대로 넘기면 세션 교환
          // 자체가 던져서 사용자가 스스로 회복할 수 없다.
          getAll() {
            return withoutUnreadableSupabaseCookies(cookieStore.getAll());
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
      // 원문은 로그에만 남긴다. URL 에 실으면 로그인 화면이 그것을 그대로
      // 출력했고(내부 표현 노출), 값이 URL 에서 오므로 링크만 보내면 누구나
      // 아무 문장이나 띄울 수 있었다.
      console.error("콜백: 세션 교환 에러:", sessionError.message);
      return NextResponse.redirect(loginErrorDestination(
        origin,
        loginPath,
        "session_failed",
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

    // 동의 -> 온보딩 -> 목적지 판정은 메일 링크(`/api/auth/confirm`)에도 똑같이
    // 필요하다. 복제하면 두 판정이 갈리는 날 사람이 두 화면 사이에 갇히므로
    // 한 곳에서만 정한다.
    const landing = await resolvePostAuthLanding({
      readOnboardingProfile: () => supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", user.id)
        .maybeSingle(),
      userMetadata: user.user_metadata,
      pendingPath: from === "demo"
        ? "/wedding/onboarding"
        : getPostLoginRedirectPath(search, origin, false),
      completedPath: postLoginPath,
    });

    const response = NextResponse.redirect(new URL(landing.path, origin));
    if (landing.markOnboardingComplete) {
      response.cookies.set("onboarding_complete", "true", {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    // 실제 로그인 시 데모 모드 쿠키 제거
    clearDemoCookies(response);
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("콜백: 예외 발생:", msg);
    return NextResponse.redirect(loginErrorDestination(
      origin,
      loginPath,
      "session_failed",
      requestedPostLoginPath,
    ));
  }
}
