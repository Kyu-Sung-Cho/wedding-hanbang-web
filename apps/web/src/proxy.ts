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

export async function proxy(request: NextRequest) {
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
