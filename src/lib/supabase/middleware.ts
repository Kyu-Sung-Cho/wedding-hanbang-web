import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Supabase 설정이 없으면 미들웨어 스킵
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes("your-project")
  ) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 인증이 필요한 페이지 접근 시 로그인으로 리다이렉트
  const protectedPaths = [
    "/dashboard", "/chat", "/budget", "/schedule", "/fitting", "/vendors", "/etiquette", "/settings",
    "/vendor/dashboard", "/vendor/profile", "/vendor/products", "/vendor/timeslots", "/vendor/bookings", "/vendor/settings",
  ];
  const isProtectedPath = protectedPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );

  // 데모 모드 쿠키가 있으면 인증 없이 접근 허용
  const isDemoMode = request.cookies.get("demo_mode")?.value === "true";

  if (!user && !isDemoMode && isProtectedPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // 온보딩 미완료 유저가 앱 페이지 접근 시 온보딩으로 리다이렉트
  const appPaths = [
    "/dashboard", "/chat", "/budget", "/schedule", "/fitting", "/vendors", "/etiquette", "/settings",
  ];
  const isAppPath = appPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );

  if (user && !isDemoMode && isAppPath) {
    const onboardingComplete =
      request.cookies.get("onboarding_complete")?.value === "true";
    if (!onboardingComplete) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
