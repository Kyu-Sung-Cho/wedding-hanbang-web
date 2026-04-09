import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const from = searchParams.get("from");
  // 데모 로그인에서 온 경우 에러 리다이렉트를 /demo/login으로
  const loginPath = from === "demo" ? "/demo/login" : "/login";

  if (!code) {
    console.error("콜백: code 파라미터 없음");
    return NextResponse.redirect(`${origin}${loginPath}?error=no_code`);
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
      return NextResponse.redirect(
        `${origin}${loginPath}?error=${encodeURIComponent(sessionError.message)}`
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error("콜백: 세션 교환 후 user가 null");
      return NextResponse.redirect(`${origin}${loginPath}?error=no_user`);
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
      const response = NextResponse.redirect(`${origin}/onboarding`);
      // 실제 로그인 시 데모 모드 쿠키 제거
      response.cookies.set("demo_mode", "", { path: "/", maxAge: 0 });
      return response;
    }

    // 일반 고객 → 대시보드
    const response = NextResponse.redirect(`${origin}/dashboard`);
    response.cookies.set("onboarding_complete", "true", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    // 실제 로그인 시 데모 모드 쿠키 제거
    response.cookies.set("demo_mode", "", { path: "/", maxAge: 0 });
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("콜백: 예외 발생:", msg);
    return NextResponse.redirect(
      `${origin}${loginPath}?error=${encodeURIComponent(msg)}`
    );
  }
}
