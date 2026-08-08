"use client";

// App Router 페이지뷰 추적. NEXT_PUBLIC_POSTHOG_KEY 없으면 완전 no-op.
// UTM 파라미터는 $pageview의 $current_url에서 PostHog이 자동 추출한다.
// posthog-js 로드·초기화는 lib/analytics의 loadPostHog 하나로 모아 두었다
// (유휴 시점 동적 로드 — 하이드레이션과 경쟁시키지 않는다).
import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { loadPostHog } from "@/lib/analytics";
import {
  analyticsSafeSearchParams,
  isAnalyticsSuppressedLocation,
} from "@/lib/analyticsPrivacy";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (
      !POSTHOG_KEY
      || !pathname
      || isAnalyticsSuppressedLocation(pathname, searchParams)
    ) return;
    const qs = analyticsSafeSearchParams(pathname, searchParams);
    // 주소는 지금 값으로 고정한다 — 로드가 늦게 끝나도 실제 방문한 화면으로 기록된다.
    const url = window.location.origin + pathname + (qs ? `?${qs}` : "");
    void loadPostHog().then((posthog) => {
      posthog?.capture("$pageview", { $current_url: url });
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
