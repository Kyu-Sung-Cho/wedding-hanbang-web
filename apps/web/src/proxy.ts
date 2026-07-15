import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

const MAINTENANCE_ERROR = {
  code: "SERVICE_MAINTENANCE",
  message: "서비스 점검 중이에요. 잠시 후 다시 시도해 주세요.",
  error: "서비스 점검 중이에요. 잠시 후 다시 시도해 주세요.",
  retryAfterSeconds: 60,
} as const;

const LAUNCH_CLOSED_ERROR = {
  code: "SERVICE_NOT_LAUNCHED",
  message: "웨딩한방은 현재 정식 베타를 준비하고 있어요. 공개된 서비스 소개와 사용자 연구 안내를 확인해 주세요.",
  error: "웨딩한방은 현재 정식 베타를 준비하고 있어요. 공개된 서비스 소개와 사용자 연구 안내를 확인해 주세요.",
  retryAfterSeconds: 3600,
} as const;

const APP_ASSOCIATION_PATHS = new Set([
  "/apple-app-site-association",
  "/.well-known/apple-app-site-association",
  "/.well-known/assetlinks.json",
]);

const COMING_SOON_PUBLIC_PATHS = new Set([
  "/demo",
  "/beta",
  "/beta/verify",
  "/about",
  "/privacy",
  "/terms",
  "/ai-policy",
  "/support",
  "/maintenance",
  "/api/preregister",
  "/api/preregister/verify",
  "/api/health/maintenance",
  "/robots.txt",
  "/sitemap.xml",
  ...APP_ASSOCIATION_PATHS,
]);

function isComingSoonProtectedAdminPath(pathname: string): boolean {
  return pathname === "/admin"
    || pathname.startsWith("/admin/")
    || pathname === "/api/admin"
    || pathname.startsWith("/api/admin/");
}

function isLaunchClosed(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "NEXT_PUBLIC_LAUNCH_MODE">> = process.env,
): boolean {
  const configuredMode = environment.NEXT_PUBLIC_LAUNCH_MODE?.trim();
  if (configuredMode === "full") return false;
  if (configuredMode === "coming_soon") return true;

  // Unknown values are never a release authorization. Local development and
  // tests may omit the setting, but a production runtime must explicitly opt
  // in to the full service.
  return Boolean(configuredMode) || environment.NODE_ENV === "production";
}

const CAMPAIGN_QUERY_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export async function proxy(request: NextRequest) {
  if (request.nextUrl.hostname === "www.hanbang.ai") {
    const url = request.nextUrl.clone();
    url.hostname = "hanbang.ai";
    return NextResponse.redirect(url, 308);
  }

  const pathname = request.nextUrl.pathname;
  const maintenanceActive = process.env.MAINTENANCE_MODE === "true";
  const maintenanceExempt = pathname === "/maintenance"
    || pathname === "/api/health/maintenance"
    || APP_ASSOCIATION_PATHS.has(pathname);

  if (maintenanceActive && !maintenanceExempt) {
    const headers = {
      "Cache-Control": "no-store, max-age=0",
      "Retry-After": "60",
    };
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return NextResponse.json(
        MAINTENANCE_ERROR,
        { status: 503, headers }
      );
    }

    const url = request.nextUrl.clone();
    url.pathname = "/maintenance";
    url.search = "";
    return NextResponse.rewrite(url, { status: 503, headers });
  }

  if (isLaunchClosed()) {
    if (COMING_SOON_PUBLIC_PATHS.has(pathname)) {
      // 출시 전 공개 화면과 닫힌 사용자 연구 상태 확인에는 로그인 세션 갱신이 필요 없다.
      // Supabase middleware를 건너뛰어 공개 경로가 인증 장애에 종속되지 않게 한다.
      return NextResponse.next();
    }

    if (isComingSoonProtectedAdminPath(pathname)) {
      // 운영 화면은 공개 allowlist가 아니다. 기존 Supabase 세션 경계를 그대로
      // 통과시켜 /admin은 미인증 사용자를 /admin/login으로 보내고, 각
      // /api/admin 라우트는 verifyAdmin/strict auth 검사를 계속 수행하게 한다.
      return await updateSession(request);
    }

    const headers = {
      "Cache-Control": "no-store, max-age=0",
      "Retry-After": "3600",
    };
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return NextResponse.json(LAUNCH_CLOSED_ERROR, { status: 503, headers });
    }

    const url = request.nextUrl.clone();
    url.pathname = "/demo";
    url.search = "";
    for (const key of CAMPAIGN_QUERY_KEYS) {
      const value = request.nextUrl.searchParams.get(key);
      if (value && value.length <= 160) url.searchParams.set(key, value);
    }
    return NextResponse.redirect(url, {
      status: 307,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
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
    "/((?!_next/static|_next/image|fonts/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?|ttf|otf|eot)$).*)",
  ],
};
