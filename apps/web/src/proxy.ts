import { NextResponse, type NextRequest } from "next/server";

import { isPreviewStubMode } from "@/lib/previewStub";
import { updateSession } from "@/lib/supabase/middleware";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const PUBLIC_NON_AMBIENT_MUTATION_PATHS = new Set([
  // Native signup and password recovery have no ambient cookie or Bearer yet.
  // Both routes enforce their own bounded Turnstile proof before any write.
  "/api/auth/signup",
  "/api/auth/forgot-password",
  // This read-only POST exists solely to prove whether the production write
  // fence intercepted it before the handler.
  "/api/release/write-fence-probe",
]);

/**
 * 릴리스 평가기가 지나가야 하는 두 경로.
 *
 * ## 왜 여기까지 손대야 했나
 *
 * 운영 대화 평가가 2026-08-03 이후 한 번도 못 돌았다. 데모 세션을 만드는 첫 걸음에서
 * 미들웨어가 403 을 냈고, 아무도 몰랐다.
 *
 *     Error: Demo session failed: 403 {"error":"untrusted_mutation_origin"}
 *
 * 라우트만 고쳐서는 안 된다 — 요청이 라우트에 닿지도 못한다.
 *
 * ## 왜 헤더 존재만 보는가
 *
 * 이 관문은 **브라우저의 교차 출처 요청**을 막는 장치다. 그런데 브라우저는 교차 출처
 * 요청에 임의 헤더를 붙이지 못한다 — 프리플라이트가 먼저 가고, 우리 API 는 그것을
 * 허용하지 않는다. 폼 전송도 커스텀 헤더를 만들 수 없다. 그래서 **커스텀 헤더의 존재
 * 자체가 CSRF 방어**이고, 이 관문이 지키려던 성질을 잃지 않는다.
 *
 * 암호 검증은 여기서 하지 않는다. 미들웨어는 Edge 런타임이라 `node:crypto` 가 없고,
 * HMAC 을 두 번 구현하면 두 곳이 갈라진다. 실제 구속은 라우트가 한다 —
 * `/api/demo/start` 와 `/api/chat` 둘 다 토큰이 틀리면 **401** 을 낸다.
 * 즉 여기는 문을 여는 곳이 아니라, 문 앞까지 오게 두는 곳이다.
 *
 * 스크립트가 Origin 헤더를 지어내게 하는 방법은 쓰지 않았다. 그건 도구가 브라우저인
 * 척하는 것이고, 무엇이 왜 통과하는지 코드에 남지 않는다.
 */
const AMORA_EVAL_HEADER_NAME = "x-amora-eval";
const RELEASE_EVALUATION_PATHS = new Set(["/api/demo/start", "/api/chat"]);

function looksLikeReleaseEvaluation(request: NextRequest): boolean {
  if (!RELEASE_EVALUATION_PATHS.has(request.nextUrl.pathname)) return false;
  const token = request.headers.get(AMORA_EVAL_HEADER_NAME);
  // 길이만 본다. 값의 진위는 라우트가 HMAC 으로 판정한다.
  return typeof token === "string" && token.length > 0 && token.length <= 200;
}

function isAllowedWeddingCodePreviewAsset(request: NextRequest): boolean {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next/static/")
    || pathname === "/_next/webpack-hmr"
    || pathname.startsWith("/fonts/paperlogy/")
    || pathname === "/favicon.ico"
    || pathname === "/images/favicon.png"
  ) {
    return true;
  }

  if (pathname !== "/_next/image") return false;

  const imageSource = request.nextUrl.searchParams.get("url");
  if (!imageSource) return false;

  try {
    const sourceUrl = new URL(imageSource, request.nextUrl.origin);
    return sourceUrl.origin === request.nextUrl.origin
      && (
        sourceUrl.pathname.startsWith("/images/")
        || sourceUrl.pathname === "/favicon.ico"
      );
  } catch {
    return false;
  }
}

function isCommunitySafetyIntakePath(pathname: string): boolean {
  return (
    /^\/api\/community\/(?:posts|comments)\/[^/]+\/report$/.test(pathname)
    || /^\/api\/community\/cohort\/[^/]+\/members\/[^/]+\/report$/.test(pathname)
    || pathname === "/api/community/moderation/appeals"
  );
}

function isCommunitySafetyExitRoute(pathname: string): boolean {
  return (
    /^\/api\/community\/responder-requests\/[^/]+\/decline$/.test(pathname)
    || /^\/api\/community\/responder-capacity\/[^/]+\/revoke$/.test(pathname)
  );
}

function isCommunitySafetyExitPath(request: NextRequest): boolean {
  return request.method.toUpperCase() === "POST"
    && isCommunitySafetyExitRoute(request.nextUrl.pathname);
}

/** 앱이 연결한 도메인은 apex 하나뿐이지만, 이 두 파일은 리다이렉트를 따라가지 않는다. */
const APP_LINK_PATHS = new Set([
  "/.well-known/apple-app-site-association",
  "/.well-known/assetlinks.json",
]);

/**
 * `www.hanbang.ai` → `hanbang.ai`. 경로와 쿼리를 그대로 들고 간다.
 *
 * ## 왜 필요한가
 *
 * 둘은 **서로 다른 오리진**이고, 인증 쿠키에 `domain` 을 주지 않으므로
 * (`lib/supabase/server.ts`) 세션이 호스트별로 갈린다 — www 에서 로그인한 사람이
 * apex 로 가면 로그아웃 상태다. 게다가 비밀번호 재설정 메일은 호스트와 무관하게 늘
 * apex 를 가리키므로(`api/auth/forgot-password` 의
 * `NEXT_PUBLIC_SITE_URL || "https://hanbang.ai"`), www 로 들어온 사람은 재설정 뒤
 * **세션이 없는 호스트**에 떨어진다.
 *
 * 2026-08-29 라이브 실측(수정 전):
 *
 *     https://hanbang.ai/       → 307 → hanbang.ai/landing        (맞다)
 *     https://www.hanbang.ai/   → 307 → www.hanbang.ai/landing    (www 에 머문다)
 *
 * ## 왜 `next.config.ts` 가 아니라 여기인가
 *
 * 거기 `source: "/:path*"` 를 쓰면 `/.well-known` 의 앱 링크 두 파일까지 삼킨다.
 * `lib/appLinks/__tests__/appLinkIdentity.test.ts` 가 그 catch-all 을 금지하고,
 * 그 파일에 `.well-known` 을 **언급하는 것 자체**도 막는다(예외를 적어 넣어 우회하지
 * 못하게). 그래서 여기서 그 두 경로만 비켜 간다.
 *
 * 앱이 연결한 도메인은 `applinks:hanbang.ai` 하나뿐이라(`apps/mobile/app.json`)
 * www 에서 그 파일을 가져가는 것은 없다. 그래도 비켜 두는 편이 싸다.
 *
 * ## 루트 판정을 가로채지 않는다
 *
 * 여기는 호스트만 보고 경로·query를 그대로 apex로 넘긴다. apex 도착 뒤
 * 미들웨어가 정확한 `/`를 `/landing`으로 보내며, 앱 주소는 기존 인증 관문을 따른다.
 * 루트 회귀 검사는 별도의 정적 redirect가 이 흐름과 충돌하지 않는지도 확인한다.
 */
function redirectWwwToApex(request: NextRequest): NextResponse | null {
  // `Host` 헤더와 `nextUrl` 둘 다 본다. 헤더는 프록시 뒤에서 비어 오기도 하고,
  // `nextUrl.hostname` 은 요청 URL 에서 온다 — 어느 쪽이든 www 면 옮긴다.
  // 정확히 이 호스트 하나만이다. `www.` 로 시작하는 것을 통째로 묶으면
  // 프리뷰·로컬까지 끌려간다.
  const headerHost = request.headers.get("host")?.toLowerCase().split(":")[0] ?? "";
  const urlHost = request.nextUrl.hostname.toLowerCase();
  if (headerHost !== "www.hanbang.ai" && urlHost !== "www.hanbang.ai") return null;
  if (APP_LINK_PATHS.has(request.nextUrl.pathname)) return null;
  const target = new URL(request.nextUrl.toString());
  target.protocol = "https:";
  target.host = "hanbang.ai";
  target.port = "";
  return NextResponse.redirect(target, 308);
}

export async function proxy(request: NextRequest) {
  const wwwRedirect = redirectWwwToApex(request);
  if (wwwRedirect) return wwwRedirect;

  const isWeddingCodeResearchPath =
    request.nextUrl.pathname === "/internal/wedding-code-research" ||
    request.nextUrl.pathname.startsWith("/internal/wedding-code-research/");
  const isWeddingCodeResearchPreview =
    process.env.WEDDING_CODE_RESEARCH_PREVIEW === "true";

  if (isWeddingCodeResearchPreview) {
    const hostname = request.nextUrl.hostname.toLowerCase();
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    const isReadOnlyMethod = ["GET", "HEAD"].includes(request.method.toUpperCase());
    const isAllowedStaticPath = isAllowedWeddingCodePreviewAsset(request);
    if (
      process.env.NODE_ENV === "development"
      && isLoopback
      && isReadOnlyMethod
      && (isWeddingCodeResearchPath || isAllowedStaticPath)
    ) {
      const response = NextResponse.next({ request });
      response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
      response.headers.set("Pragma", "no-cache");
      if (isWeddingCodeResearchPath) {
        response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
      }
      return response;
    }

    return NextResponse.json(
      { error: "wedding_code_research_preview_io_disabled" },
      {
        status: 503,
        headers: { "Cache-Control": "private, no-store, max-age=0, must-revalidate" },
      },
    );
  }

  if (isWeddingCodeResearchPath) {
    const hostname = request.nextUrl.hostname.toLowerCase();
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    if (
      process.env.NODE_ENV !== "development" ||
      !isLoopback
    ) {
      return new NextResponse(null, {
        status: 404,
        headers: { "Cache-Control": "private, no-store, max-age=0, must-revalidate" },
      });
    }

    const response = NextResponse.next({ request });
    response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    return response;
  }

  const isApiPath =
    request.nextUrl.pathname === "/api" ||
    request.nextUrl.pathname.startsWith("/api/");
  const isKnownMutatingGetPath =
    request.nextUrl.pathname === "/api/cron" ||
    request.nextUrl.pathname.startsWith("/api/cron/") ||
    [
      "/api/auth/callback",
      // 메일 인증 링크가 도착하는 자리. GET 이지만 verifyOtp 로 세션을 세우고
      // 가입 확인을 확정하므로 callback 과 같은 부류다 — 쓰기를 막는 창에서
      // 한쪽만 통과하면 두 로그인 경로가 다르게 동작한다.
      "/api/auth/confirm",
      "/api/auth/me",
      "/api/couple/code",
      "/api/messages",
    ].includes(request.nextUrl.pathname) ||
    /^\/api\/vendors\/[^/]+$/.test(request.nextUrl.pathname);

  if (
    process.env.PRODUCTION_WRITE_FENCE_ENABLED === "true" &&
    isApiPath &&
    (
      !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase()) ||
      (["GET", "HEAD"].includes(request.method.toUpperCase()) && isKnownMutatingGetPath)
    )
  ) {
    const deploymentCommit = process.env.VERCEL_GIT_COMMIT_SHA;
    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      "Retry-After": "60",
    };
    if (/^[a-f0-9]{40}$/.test(deploymentCommit ?? "")) {
      headers["X-Hanbang-Deployment-Commit"] = deploymentCommit!;
    }
    return NextResponse.json(
      { error: "production_write_fence_enabled" },
      {
        status: 503,
        headers,
      }
    );
  }

  const isCommunityApiPath =
    request.nextUrl.pathname === "/api/community"
    || request.nextUrl.pathname.startsWith("/api/community/");
  const communityRuntimeMode = process.env.COMMUNITY_RUNTIME_MODE;
  const isCommunitySafetyIntake = isCommunitySafetyIntakePath(
    request.nextUrl.pathname,
  );
  const isCommunitySafetyExit = isCommunitySafetyExitPath(request);
  const isInvalidCommunitySafetyExitMethod =
    isCommunitySafetyExitRoute(request.nextUrl.pathname)
    && !isCommunitySafetyExit;
  const isCommunityMutation = !["GET", "HEAD", "OPTIONS"].includes(
    request.method.toUpperCase(),
  );
  const shouldFreezeCommunity =
    isCommunityApiPath
    && !isCommunitySafetyIntake
    && !isCommunitySafetyExit
    && (
      communityRuntimeMode === "disabled"
      || (
        communityRuntimeMode === "read_only"
        && (isCommunityMutation || isInvalidCommunitySafetyExitMethod)
      )
    );
  if (shouldFreezeCommunity) {
    return NextResponse.json(
      {
        error: communityRuntimeMode === "disabled"
          ? "community_disabled"
          : "community_read_only",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "60",
        },
      },
    );
  }

  if (
    isPreviewStubMode() &&
    isApiPath &&
    !(
      request.nextUrl.pathname === "/api/demo/start" &&
      request.method.toUpperCase() === "POST"
    )
  ) {
    return NextResponse.json(
      { error: "preview_stub_api_disabled" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  const isUnsafeApiMethod = isApiPath
    && !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
  const isRouteAuthenticatedServerMutation =
    request.nextUrl.pathname.startsWith("/api/internal/");
  if (
    isUnsafeApiMethod
    && !PUBLIC_NON_AMBIENT_MUTATION_PATHS.has(request.nextUrl.pathname)
    && !isRouteAuthenticatedServerMutation
    && !looksLikeReleaseEvaluation(request)
    && !isTrustedMutationRequest(request)
  ) {
    return NextResponse.json(
      { error: "untrusted_mutation_origin" },
      {
        status: 403,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Vary: "Authorization, Origin, Sec-Fetch-Site",
        },
      },
    );
  }

  if (
    request.nextUrl.pathname === "/wedding-code/result" ||
    (request.nextUrl.pathname === "/wedding-code" &&
      request.nextUrl.searchParams.has("ct"))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/wedding-code";
    url.searchParams.delete("ct");
    return NextResponse.redirect(url);
  }

  if (request.nextUrl.pathname === "/wedding/wedding" || request.nextUrl.pathname.startsWith("/wedding/wedding/")) {
    const url = request.nextUrl.clone();
    url.pathname = url.pathname.replace(/^\/wedding\/wedding(?=\/|$)/, "/wedding");
    return NextResponse.redirect(url);
  }

  if (request.nextUrl.pathname === "/dashboard" || request.nextUrl.pathname.startsWith("/dashboard/")) {
    const url = request.nextUrl.clone();
    url.pathname = url.pathname.replace(/^\/dashboard/, "/wedding/lounge");
    return NextResponse.redirect(url);
  }

  if (request.nextUrl.pathname === "/wedding/dashboard" || request.nextUrl.pathname.startsWith("/wedding/dashboard/")) {
    const url = request.nextUrl.clone();
    url.pathname = url.pathname.replace(/^\/wedding\/dashboard/, "/wedding/lounge");
    return NextResponse.redirect(url);
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/api/:path*",
    "/_next/image",
    "/((?!_next/static|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
