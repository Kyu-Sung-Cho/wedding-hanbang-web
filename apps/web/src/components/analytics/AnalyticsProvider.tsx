"use client";

// PostHog 초기화 + App Router 페이지뷰 추적.
// NEXT_PUBLIC_POSTHOG_KEY 없으면 완전 no-op (개발·셀프호스트 환경 안전).
// UTM 파라미터는 $pageview의 $current_url에서 PostHog이 자동 추출한다.
import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

let initialized = false;
function ensureInit() {
  if (initialized || typeof window === "undefined" || !POSTHOG_KEY) return;
  initialized = true;
  posthog.init(POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    capture_pageview: false, // App Router 라우트 전환은 아래에서 수동 캡처
    capture_pageleave: true,
    persistence: "localStorage+cookie",
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
      $current_url: window.location.origin + pathname + (qs ? `?${qs}` : ""),
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
