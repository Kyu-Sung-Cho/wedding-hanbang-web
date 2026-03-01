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

  // 관리자 쿠키 확인
  const isAdmin = request.cookies.get("admin_role")?.value === "true";

  // 경로별 보호 그룹 정의
  const customerPaths = [
    "/dashboard", "/chat", "/budget", "/schedule", "/fitting", "/vendors", "/etiquette", "/settings", "/bookings",
  ];
  const vendorPaths = [
    "/vendor/dashboard", "/vendor/profile", "/vendor/products", "/vendor/timeslots", "/vendor/bookings", "/vendor/contracts", "/vendor/settlements", "/vendor/settings", "/vendor/messages", "/vendor/analytics", "/vendor/staff",
  ];

  const pathname = request.nextUrl.pathname;
  const isCustomerPath = customerPaths.some((path) => pathname.startsWith(path));
  const isVendorPath = vendorPaths.some((path) => pathname.startsWith(path));
  const isAdminPath = pathname === "/admin";
  const isProtectedPath = isCustomerPath || isVendorPath || isAdminPath;

  // 데모 모드 쿠키가 있으면 고객 앱 인증 없이 접근 허용
  const isDemoMode = request.cookies.get("demo_mode")?.value === "true";

  if (!user && !isDemoMode && isProtectedPath) {
    const url = request.nextUrl.clone();
    if (isVendorPath) {
      // 업체 보호 경로 → 업체 로그인으로
      url.pathname = "/vendor/login";
    } else if (isAdminPath) {
      // 관리자 경로 → 관리자 로그인으로
      url.pathname = "/admin/login";
    } else {
      // 고객 보호 경로 → 고객 로그인으로
      url.pathname = "/login";
    }
    return NextResponse.redirect(url);
  }

  // 관리자는 모든 페이지 접근 가능 (온보딩 체크 건너뜀)
  if (isAdmin) {
    return supabaseResponse;
  }

  // 온보딩 미완료 유저가 앱 페이지 접근 시 온보딩으로 리다이렉트
  const appPaths = [
    "/dashboard", "/chat", "/budget", "/schedule", "/fitting", "/vendors", "/etiquette", "/settings", "/bookings",
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
