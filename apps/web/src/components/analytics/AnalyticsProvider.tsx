"use client";

// App Router 페이지뷰 추적. NEXT_PUBLIC_POSTHOG_KEY 없으면 완전 no-op.
// 개인정보가 들어갈 수 있는 query/fragment는 페이지뷰에 싣지 않는다.
// posthog-js 로드·초기화는 lib/analytics의 loadPostHog 하나로 모아 두었다
// (유휴 시점 동적 로드 — 하이드레이션과 경쟁시키지 않는다).
import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { captureEvent } from "@/lib/analytics";
import {
  hasExplicitThirdPartyAnalyticsConsent,
  isAnalyticsSuppressedLocation,
} from "@/lib/analyticsPrivacy";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (
      !POSTHOG_KEY
      || !hasExplicitThirdPartyAnalyticsConsent()
      || !pathname
      || isAnalyticsSuppressedLocation(pathname, searchParams)
    ) return;
    // 주소는 지금 값으로 고정한다 — 로드가 늦게 끝나도 실제 방문한 화면으로 기록된다.
    const url = window.location.origin + pathname;
    captureEvent("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

export default function AnalyticsProvider() {
  if (!POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_ENABLED !== "true") return null;
  return (
    <Suspense fallback={null}>
      <PageViewTracker />
    </Suspense>
  );
}
