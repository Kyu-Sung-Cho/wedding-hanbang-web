import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// 인증이 필요한 보호 경로만 정의
const CUSTOMER_PATHS = [
  "/lounge", "/dashboard", "/chat", "/budget", "/schedule", "/etiquette", "/settings", "/bookings",
  "/invitations", "/money", "/onboarding",
  "/wedding/lounge", "/wedding/dashboard", "/wedding/chat", "/wedding/budget", "/wedding/schedule",
  "/wedding/etiquette", "/wedding/settings", "/wedding/bookings", "/wedding/invitations",
  "/wedding/money", "/wedding/vendors", "/wedding/favorites",
  "/wedding/onboarding",
];
// /market-prices는 의도적 공개 — 한국소비자원 공공 데이터(하드코딩 상수)라 보호할 개인정보가 없고,
// "스드메 시세" 류 검색 유입의 유일한 입구다.
const VENDOR_PATHS = [
  "/vendor/dashboard", "/vendor/profile", "/vendor/products", "/vendor/timeslots", "/vendor/bookings",
  "/vendor/contracts", "/vendor/settlements", "/vendor/settings", "/vendor/messages", "/vendor/analytics", "/vendor/staff",
];

function isProtectedPath(pathname: string): "customer" | "vendor" | "admin" | null {
  if (CUSTOMER_PATHS.some((p) => pathname.startsWith(p))) return "customer";
  if (VENDOR_PATHS.some((p) => pathname.startsWith(p))) return "vendor";
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) return null;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  return null;
}

export async function updateSession(request: NextRequest) {
  const supabaseResponse = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;

  // Supabase 설정 없으면 스킵
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes("your-project")
  ) {
    return supabaseResponse;
  }

  // 공개 경로는 auth 체크 없이 즉시 통과 (핵심 최적화)
  const protectedType = isProtectedPath(pathname);
  if (!protectedType) {
    return supabaseResponse;
  }

  // 데모 모드는 고객 앱 shell에만 허용한다. 업체/관리자 보호 경로는 실제 인증 필요.
  if (protectedType === "customer" && request.cookies.get("demo_mode")?.value === "true") {
    return supabaseResponse;
  }

  // 보호 경로만 auth 체크 (네트워크 호출)
  let finalResponse = supabaseResponse;

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
          finalResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            finalResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 미인증 → 로그인 페이지로 리다이렉트
  if (!user) {
    const url = request.nextUrl.clone();
    if (protectedType === "vendor") {
      url.pathname = "/vendor/login";
    } else if (protectedType === "admin") {
      url.pathname = "/admin/login";
    } else {
      url.pathname = "/login";
    }
    return NextResponse.redirect(url);
  }

  // 온보딩 미완료 체크 (고객 앱 경로만)
  const isOnboardingPath = pathname.startsWith("/onboarding") || pathname.startsWith("/wedding/onboarding");

  if (protectedType === "customer" && !isOnboardingPath) {
    const onboardingComplete =
      request.cookies.get("onboarding_complete")?.value === "true";
    if (!onboardingComplete) {
      const url = request.nextUrl.clone();
      url.pathname = "/wedding/onboarding";
      return NextResponse.redirect(url);
    }
  }

  return finalResponse;
}
