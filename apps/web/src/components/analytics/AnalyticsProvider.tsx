"use client";

// PostHog 초기화 + App Router 페이지뷰 추적.
// NEXT_PUBLIC_POSTHOG_KEY 없으면 완전 no-op (개발·셀프호스트 환경 안전).
// UTM 파라미터는 $pageview의 $current_url에서 PostHog이 자동 추출한다.
import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import {
  POSTHOG_SENSITIVE_QUERY_KEYS,
  redactSensitiveAnalyticsCapture,
  redactSensitiveNetworkCapture,
  redactSensitiveUrl,
} from "@/lib/analytics/urlPrivacy";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

let initialized = false;
function ensureInit() {
  if (initialized || typeof window === "undefined" || !POSTHOG_KEY) return;
  initialized = true;
  posthog.init(POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    // Feature flags are unused. This blocks the SDK's flags/remote-config
    // requests, whose initial-person payload is created before before_send.
    advanced_disable_flags: true,
    // Scrub SDK-generated current/referrer URLs before they are persisted or
    // attached to any request, in addition to our event-level before_send hook.
    mask_personal_data_properties: true,
    custom_personal_data_properties: [...POSTHOG_SENSITIVE_QUERY_KEYS],
    capture_pageview: false, // App Router 라우트 전환은 아래에서 수동 캡처
    capture_pageleave: true,
    persistence: "localStorage+cookie",
    session_recording: {
      maskAllInputs: true,
      recordBody: false,
      recordHeaders: false,
      maskCapturedNetworkRequestFn: redactSensitiveNetworkCapture,
    },
    before_send: redactSensitiveAnalyticsCapture,
  });
}

function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!POSTHOG_KEY || !pathname) return;
    ensureInit();
    const qs = searchParams?.toString();
    posthog.capture("$pageview", {
      $current_url: redactSensitiveUrl(
        window.location.origin + pathname + (qs ? `?${qs}` : "")
      ),
    });
  }, [pathname, searchParams]);

  return null;
}

export default function AnalyticsProvider() {
  if (!POSTHOG_KEY) return null;
  return (
    <Suspense fallback={null}>
      <PageViewTracker />
    </Suspense>
  );
}
