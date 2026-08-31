import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SIGNUP_CONSENT_PATH, hasRecordedSignupConsent } from "@hanbang/shared";

// 인증이 필요한 보호 경로만 정의
const CUSTOMER_PATHS = [
  "/lounge", "/dashboard", "/chat", "/budget", "/checklist", "/schedule", "/settings", "/bookings",
  "/money", "/onboarding",
  "/wedding/lounge", "/wedding/dashboard", "/wedding/chat", "/wedding/budget", "/wedding/checklist", "/wedding/schedule",
  "/wedding/settings", "/wedding/bookings",
  "/wedding/money", "/wedding/vendors", "/wedding/favorites",
  "/wedding/onboarding",
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

/**
 * 루트(`/`)는 앱의 문이다 — 세션이 있으면 라운지로, 없으면 랜딩으로.
 * 로그아웃 목적지는 2026-08-27 파운더 결정으로 `/login` 에서 `/landing` 이 됐다.
 *
 * ## 왜 페이지가 아니라 여기서 판정하는가
 *
 * **진짜 307을 내보내기 위해서다.** 같은 판정을 서버 컴포넌트(`app/page.tsx`)의
 * `redirect()`로 하면, 세션을 물어보는 동안 응답이 이미 스트리밍으로 나가기 시작해서
 * 브라우저에는 `200 + HTML`이 도착하고 리다이렉트는 클라이언트에서 일어난다. 사람
 * 눈에는 같아 보이지만 (1) 크롤러에게는 리다이렉트가 아니라 폴백 문서가 정답으로
 * 보이고 (2) 그 문서가 한 번 그려졌다 사라진다.
 *
 * `app/page.tsx`의 같은 판정은 **폴백으로 남겨둔다** — 미들웨어가 돌지 않거나 Supabase
 * 설정이 없는 환경에서도 루트는 랜딩이 아니라 문으로 동작해야 한다. 두 곳의 판정
 * 결과는 같아야 하며, 갈리면 로그인한 사람이 두 화면 사이를 오간다.
 *
 * ## 체험(demo_mode) 쿠키를 여기서 보지 않는 이유
 *
 * `demo_mode`는 누구나 한 줄로 세팅할 수 있는 **표식**일 뿐이고, 체험의 진짜 자격은
 * 서명된 `demo_session` 토큰이다(`lib/demoSession.ts`의
 * `hasSignedDemoSessionFromCookieHeader`). 표식만 믿고 라운지로 보내면 **만료된 체험
 * 쿠키를 든 사람이 라운지에 갔다가 다시 로그인으로 튕기고**, 그 튕김은 클라이언트에서
 * 일어나서 UTM까지 함께 사라진다(로컬에서 재현했다). 로그인 화면에는 "로그인 없이
 * 체험하기"가 그대로 있으니 체험하려던 사람도 거기서 한 번에 이어갈 수 있다.
 *
 * 아래 `updateSession`이 이미 방문한 경로를 **통과**시킬 때 표식만 보는 것과는 다른
 * 판단이다 — 그건 목적지를 고르는 게 아니라 막지 않는 것이다.
 *
 * 서명 검증이 **불가능해서**가 아니다. 이 저장소의 미들웨어 진입점(`src/proxy.ts`)은
 * Next 16의 Proxy 파일이라 항상 Node.js 런타임으로 컴파일되고(빌드 산출물
 * `.next/server/functions-config-manifest.json`의 `"/_middleware": {"runtime":"nodejs"}`),
 * `node:crypto`를 그대로 쓸 수 있다. 그래서 여기서 `hasSignedDemoSessionFromCookieHeader`를
 * 호출해 **살아 있는 체험만 라운지로 보내는 선택도 가능하다.** 지금 그렇게 하지 않은
 * 이유는 두 가지다. (1) 그건 누가 어디에 착지하는지를 바꾸는 제품 결정이고, 이 변경의
 * 목적은 목적지가 아니라 전달 방식(200 → 307)이었다. (2) 정문이 Node 전용 API에 묶이면
 * 나중에 이 파일을 Edge로 옮길 수 없다. 바꾸려면 그 두 가지를 알고 바꿔라.
 *
 * ## 온보딩 여부는 보지 않는다
 *
 * 세션이 있으면 라운지로 보내고, 온보딩을 아직 안 마쳤으면 그 다음 요청에서
 * `updateSession`이 온보딩으로 돌린다. 여기서 프로필까지 읽으면 같은 판정을 두 곳에서
 * 하게 된다.
 */
async function redirectAppDoor(request: NextRequest): Promise<NextResponse> {
  const cookiesToApply: { name: string; value: string; options?: CookieOptions }[] = [];
  let signedIn = false;

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            // 토큰이 갱신됐다면 그 쿠키를 리다이렉트 응답에 실어 보내야 한다.
            // 여기서 흘리면 다음 요청이 다시 로그아웃 상태로 도착한다.
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value);
              cookiesToApply.push({ name, value, options });
            });
          },
        },
      },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);
  } catch {
    // 세션을 못 물어보는 상황이면 랜딩으로 보낸다 — 그 화면은 누구에게나 열려 있고,
    // 거기에 로그인 링크가 있다. 도메인 루트가 통째로 오류가 되면 안 된다.
    signedIn = false;
  }

  const destination = request.nextUrl.clone();
  destination.pathname = signedIn ? "/wedding/lounge" : "/landing";
  // UTM 같은 유입 표식은 목적지까지 들고 간다 — clone이 search를 그대로 들고 온다.

  const response = NextResponse.redirect(destination);
  cookiesToApply.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options),
  );
  return response;
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

  // 루트는 공개 경로가 아니라 **문**이다. isProtectedPath보다 먼저 봐야 한다.
  // 로그아웃이면 랜딩, 로그인돼 있으면 라운지 — 이유는 `app/page.tsx` 주석에 있다.
  if (pathname === "/") {
    return await redirectAppDoor(request);
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
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 미인증 → 로그인 페이지로 리다이렉트
  if (!user) {
    const url = protectedType === "customer"
      ? buildCustomerGateRedirect(request, "/login")
      : request.nextUrl.clone();
    if (protectedType === "admin") url.pathname = "/admin/login";
    return NextResponse.redirect(url);
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
    && !hasRecordedSignupConsent(user.user_metadata)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = SIGNUP_CONSENT_PATH;
    url.search = `?redirect=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
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
      return NextResponse.redirect(url);
    }
  }

  return finalResponse;
}
