import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

const MAINTENANCE_ERROR = {
  code: "SERVICE_MAINTENANCE",
  message: "서비스 점검 중이에요. 잠시 후 다시 시도해 주세요.",
  error: "서비스 점검 중이에요. 잠시 후 다시 시도해 주세요.",
  retryAfterSeconds: 60,
} as const;

export async function proxy(request: NextRequest) {
  if (request.nextUrl.hostname === "www.hanbang.ai") {
    const url = request.nextUrl.clone();
    url.hostname = "hanbang.ai";
    return NextResponse.redirect(url, 308);
  }

  const pathname = request.nextUrl.pathname;
  const maintenanceActive = process.env.MAINTENANCE_MODE === "true";
  const maintenanceExempt = pathname === "/maintenance"
    || pathname === "/api/health/maintenance";

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
