import { NextResponse, type NextRequest } from "next/server";

import { isPreviewStubMode } from "@/lib/previewStub";
import { updateSession } from "@/lib/supabase/middleware";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const NON_BROWSER_MUTATION_EXEMPTIONS = new Set([
  // React Native has no browser Origin/Sec-Fetch metadata before a session
  // exists. Both endpoints require a one-time, server-verified Turnstile token.
  "/api/auth/signup",
  "/api/auth/forgot-password",
  // This route is a read-only POST sentinel used to prove the independent
  // production write fence. Reaching it must keep returning its canonical 409.
  "/api/release/write-fence-probe",
  // Exact server-to-server route. Its handler independently requires the
  // strong internal bearer token; new /api/internal routes are not exempt by
  // default because that would silently disable the browser mutation fence.
  "/api/internal/vendors/recommend",
]);

// This legacy GET lazily creates an invite code. Treat it like every other
// cookie-authenticated mutation so a cross-site top-level navigation cannot
// create account state with ambient cookies. OAuth callback GETs remain
// outside this set because their PKCE/state boundary is intentionally reached
// from the external identity provider.
const ORIGIN_GUARDED_MUTATING_GETS = new Set([
  "/api/couple/code",
]);

function isApiMutationOriginExempt(pathname: string): boolean {
  return NON_BROWSER_MUTATION_EXEMPTIONS.has(pathname);
}

function fenceAuthenticatedApiResponseCache(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  const hasAmbientIdentity = Boolean(
    request.headers.get("authorization")
    || request.headers.get("cookie"),
  );
  if (!hasAmbientIdentity) return response;

  // Route handlers are expected to mark identity-scoped data private, but a
  // single omission must not let a browser, proxy, or future CDN reuse one
  // person's response for another. This edge-level fence covers both native
  // Bearer sessions and browser cookie sessions, including error responses.
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  response.headers.set("Pragma", "no-cache");
  const vary = new Map<string, string>();
  for (const value of (response.headers.get("Vary") ?? "").split(",")) {
    const normalized = value.trim();
    if (normalized) vary.set(normalized.toLowerCase(), normalized);
  }
  vary.set("authorization", "Authorization");
  vary.set("cookie", "Cookie");
  response.headers.set("Vary", [...vary.values()].join(", "));
  return response;
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

function stripRetiredSensitiveNavigationQuery(request: NextRequest): NextResponse | null {
  const pathname = request.nextUrl.pathname;
  const keys = pathname === "/chat" || pathname === "/wedding/chat"
    ? ["prefill"]
    : pathname === "/community/post/write" || pathname === "/wedding/community/post/write"
      ? ["prefill", "title", "body"]
      : pathname === "/wedding-code" || pathname === "/wedding-code/result"
        ? ["a", "b", "ct"]
        : [];
  if (!keys.some((key) => request.nextUrl.searchParams.has(key))) return null;

  const url = request.nextUrl.clone();
  keys.forEach((key) => url.searchParams.delete(key));
  if (pathname === "/wedding-code/result") url.pathname = "/wedding-code";
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
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
      "/api/community/cohort",
      "/api/couple/code",
    ].includes(request.nextUrl.pathname);

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

  if (
    isPreviewStubMode() &&
    isApiPath
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
  const requiresMutationOrigin = isUnsafeApiMethod
    || (
      ["GET", "HEAD"].includes(request.method.toUpperCase())
      && ORIGIN_GUARDED_MUTATING_GETS.has(request.nextUrl.pathname)
    );
  if (
    requiresMutationOrigin
    && !isApiMutationOriginExempt(request.nextUrl.pathname)
    && !isTrustedMutationRequest(request)
  ) {
    return NextResponse.json(
      { error: "api_mutation_origin_not_allowed" },
      {
        status: 403,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Vary: "Origin, Sec-Fetch-Site, Authorization",
        },
      },
    );
  }

  const sanitizedNavigation = stripRetiredSensitiveNavigationQuery(request);
  if (sanitizedNavigation) return sanitizedNavigation;

  if (
    request.nextUrl.pathname === "/wedding-code/result"
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/wedding-code";
    const response = NextResponse.redirect(url);
    response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
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

  const response = await updateSession(request);
  return isApiPath
    ? fenceAuthenticatedApiResponseCache(request, response)
    : response;
}

export const config = {
  matcher: [
    "/api/:path*",
    "/_next/image",
    "/((?!_next/static|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
