import { NextResponse, type NextRequest } from "next/server";

import { isPreviewStubMode } from "@/lib/previewStub";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const isWeddingCodeResearchPath =
    request.nextUrl.pathname === "/internal/wedding-code-research" ||
    request.nextUrl.pathname.startsWith("/internal/wedding-code-research/");

  if (isWeddingCodeResearchPath) {
    const host = request.headers.get("host")?.toLowerCase() ?? "";
    const hostname = host.startsWith("[") ? host.split("]")[0] + "]" : host.split(":")[0];
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    if (
      process.env.NODE_ENV !== "development" ||
      process.env.WEDDING_CODE_RESEARCH_PREVIEW !== "true" ||
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
      "/api/auth/me",
      "/api/community/cohort",
      "/api/community/profile",
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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
