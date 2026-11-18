import { hasWebSignupConsentAccess } from "@/lib/auth/signupConsentAccess";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SIGNUP_CONSENT_PATH } from "@hanbang/shared";

// 인증이 필요한 보호 경로만 정의
const CUSTOMER_PATHS = [
  "/lounge", "/dashboard", "/chat", "/budget", "/checklist", "/schedule", "/settings", "/bookings",
  "/money", "/onboarding",
  // 2026-11-17 청첩장 디자인의 준비 순서·웨딩홀 비교(편지·상담 확정 포함). 라운지와 같은 커플 화면이다.
  "/journey", "/halls",
  "/wedding/lounge", "/wedding/dashboard", "/wedding/chat", "/wedding/budget", "/wedding/checklist", "/wedding/schedule",
  "/wedding/settings", "/wedding/bookings",
  "/wedding/money", "/wedding/vendors", "/wedding/favorites",
  "/wedding/onboarding",
  "/wedding/journey", "/wedding/halls",
];
// /market-prices는 의도적 공개 — 한국소비자원 공공 데이터(하드코딩 상수)라 보호할 개인정보가 없고,
// "스드메 시세" 류 검색 유입의 입구다(현재는 /price 허브로 리다이렉트된다).
// ※ /etiquette(가족 조율 안내)는 2026-07-26에 페이지째 제거됐다 — 여기 목록에도 없다.
function isProtectedPath(pathname: string): "customer" | "admin" | null {
  if (CUSTOMER_PATHS.some((p) => pathname.startsWith(p))) return "customer";
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) return null;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  return null;
}

function buildCustomerGateRedirect(
  request: NextRequest,
  gatePath: "/login" | "/wedding/onboarding",
): URL {
  const destination = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const url = request.nextUrl.clone();
  url.pathname = gatePath;
  url.search = "";
  url.hash = "";
  url.searchParams.set("redirect", destination);
  return url;
}

/** 루트는 공개 랜딩으로 보낸다. 명시적인 앱 주소의 인증·동의 판정과 분리한다. */
function redirectLandingDoor(request: NextRequest): NextResponse {
  const destination = request.nextUrl.clone();
  destination.pathname = "/landing";
  // 유입 query는 보존하고 인증 쿠키는 조회·갱신·삭제하지 않는다.
  return NextResponse.redirect(destination);
}

export async function updateSession(request: NextRequest) {
  const supabaseResponse = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;

  // 공개 루트는 Supabase 설정·세션 유무와 관계없이 같은 307을 반환한다.
  if (pathname === "/") return redirectLandingDoor(request);

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

  // 데모 모드는 고객 앱 shell에만 허용한다. 관리자 보호 경로는 실제 인증 필요.
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
          finalResponse.headers.set("Cache-Control", "private, no-store");
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirectWithSession = (url: URL) => {
    const response = NextResponse.redirect(url);
    // 동의·온보딩으로 이동해도 갱신·삭제한 세션 쿠키를 브라우저에 전달한다.
    finalResponse.cookies.getAll().forEach(cookie => response.cookies.set(cookie));
    const cacheControl = finalResponse.headers.get("Cache-Control");
    if (cacheControl) response.headers.set("Cache-Control", cacheControl);
    return response;
  };

  // 미인증 → 로그인 페이지로 리다이렉트
  if (!user) {
    const url = protectedType === "customer"
      ? buildCustomerGateRedirect(request, "/login")
      : request.nextUrl.clone();
    if (protectedType === "admin") url.pathname = "/admin/login";
    return redirectWithSession(url);
  }

  // 동의 관문이 온보딩보다 **먼저** 와야 한다.
  //
  // 소셜 로그인은 Supabase 가 계정을 직접 만들기 때문에 동의 기록이 없다. 그런
  // 계정이 다시 들어오면 아래 온보딩 검사가 `/wedding/onboarding` 으로 돌려세우는데,
  // 온보딩은 `(auth)` 라우트 그룹이라 `AuthenticatedAppShell`·`(community)/layout`
  // 의 동의 관문 밖이다. 그래서 관문을 하나도 지나지 않은 채 온보딩을 처음부터 끝까지
  // 채우고, 저장을 누르면 `/api/onboarding` 이 `SIGNUP_CONSENT_REQUIRED` 로 400 을
  // 낸다. 화면은 그 문장을 빨간 한 줄로만 그리고 갈 곳을 알려주지 않는다 —
  // 다시 눌러도 같은 결과이고, 사실상 첫 실행이 거기서 끝난다.
  //
  // 동의 화면 자체는 지나보낸다. 막으면 동의할 방법이 사라진다.
  // 가려던 곳은 `redirect` 로 넘긴다 — 동의를 마친 사람을 처음 자리로 돌려보낸다.
  if (
    protectedType === "customer"
    && pathname !== SIGNUP_CONSENT_PATH
    && !hasWebSignupConsentAccess(user)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = SIGNUP_CONSENT_PATH;
    url.search = `?${new URLSearchParams({ redirect: `${pathname}${request.nextUrl.search}` })}`;
    return redirectWithSession(url);
  }

  // 온보딩 미완료 체크 (고객 앱 경로만)
  const isOnboardingPath = pathname.startsWith("/onboarding") || pathname.startsWith("/wedding/onboarding");
  const isVendorAdminPreview = (
    pathname === "/wedding/vendors" || pathname.startsWith("/wedding/vendors/")
  ) && request.nextUrl.searchParams.get("preview") === "1";

  // 미리보기도 인증은 필수이며, 페이지의 verifyAdmin이 권한을 다시 fail-closed 검증한다.
  if (protectedType === "customer" && !isOnboardingPath && !isVendorAdminPreview) {
    const onboardingComplete =
      request.cookies.get("onboarding_complete")?.value === "true";
    if (!onboardingComplete) {
      const url = buildCustomerGateRedirect(request, "/wedding/onboarding");
      return redirectWithSession(url);
    }
  }

  return finalResponse;
}
