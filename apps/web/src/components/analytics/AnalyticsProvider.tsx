"use client";

// PostHog 초기화 + App Router 페이지뷰 추적.
// NEXT_PUBLIC_POSTHOG_KEY 없으면 완전 no-op (개발·셀프호스트 환경 안전).
import { useEffect, Suspense } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { sanitizeTelemetryRecord } from "@/lib/telemetryPrivacy";
import { THIRD_PARTY_TELEMETRY_ENABLED } from "@/lib/telemetryPolicy";
import {
  POSTHOG_SENSITIVE_QUERY_KEYS,
  redactSensitiveAnalyticsCapture,
  redactSensitiveNetworkCapture,
  redactSensitiveUrl,
} from "@/lib/analytics/urlPrivacy";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

let initialized = false;
function ensureInit() {
  if (!THIRD_PARTY_TELEMETRY_ENABLED || initialized || typeof window === "undefined" || !POSTHOG_KEY) return;
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
    capture_pageleave: false,
    autocapture: false,
    disable_session_recording: true,
    persistence: "localStorage+cookie",
    // Defense in depth if telemetry is explicitly re-approved later. Replay is
    // still disabled above, and network bodies/headers remain uncollectable.
    session_recording: {
      maskAllInputs: true,
      recordBody: false,
      recordHeaders: false,
      maskCapturedNetworkRequestFn: redactSensitiveNetworkCapture,
    },
    before_send: (event) => {
      const redacted = redactSensitiveAnalyticsCapture(event);
      if (!redacted) return null;
      return {
        ...redacted,
        properties: sanitizeTelemetryRecord(redacted.properties) ?? {},
        $set: sanitizeTelemetryRecord(redacted.$set),
        $set_once: sanitizeTelemetryRecord(redacted.$set_once),
      };
    },
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
      $current_url: redactSensitiveUrl(window.location.origin + pathname),
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
