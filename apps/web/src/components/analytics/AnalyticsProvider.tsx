"use client";

// PostHog 초기화 + App Router 페이지뷰 추적.
// NEXT_PUBLIC_POSTHOG_KEY 없으면 완전 no-op (개발·셀프호스트 환경 안전).
import { useEffect, Suspense } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { sanitizeTelemetryRecord } from "@/lib/telemetryPrivacy";
import { THIRD_PARTY_TELEMETRY_ENABLED } from "@/lib/telemetryPolicy";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

let initialized = false;
function ensureInit() {
  if (!THIRD_PARTY_TELEMETRY_ENABLED || initialized || typeof window === "undefined" || !POSTHOG_KEY) return;
  initialized = true;
  posthog.init(POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    capture_pageview: false, // App Router 라우트 전환은 아래에서 수동 캡처
    capture_pageleave: false,
    autocapture: false,
    disable_session_recording: true,
    persistence: "localStorage+cookie",
    before_send: (event) => event ? {
      ...event,
      properties: sanitizeTelemetryRecord(event.properties) ?? {},
      $set: sanitizeTelemetryRecord(event.$set),
      $set_once: sanitizeTelemetryRecord(event.$set_once),
    } : null,
  });
}

function PageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!THIRD_PARTY_TELEMETRY_ENABLED || !POSTHOG_KEY || !pathname) return;
    ensureInit();
    posthog.capture("$pageview", {
      // Bearer-like query parameters (for example wedding-code ct) must never
      // leave the browser through analytics.
      $current_url: window.location.origin + pathname,
    });
  }, [pathname]);

  return null;
}

export default function AnalyticsProvider() {
  if (!THIRD_PARTY_TELEMETRY_ENABLED || !POSTHOG_KEY) return null;
  return (
    <Suspense fallback={null}>
      <PageViewTracker />
    </Suspense>
  );
}
