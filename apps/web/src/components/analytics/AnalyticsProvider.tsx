"use client";

// App Router 페이지뷰 추적. NEXT_PUBLIC_POSTHOG_KEY 없으면 완전 no-op.
// 랜딩은 별도 전송 경계에서 경로만 남긴다. 다른 화면은 기존 주소 정리를 따른다.
// posthog-js 로드·초기화는 lib/analytics의 loadPostHog 하나로 모아 두었다
// (유휴 시점 동적 로드 — 하이드레이션과 경쟁시키지 않는다).
import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { capturePageview } from "@/lib/analytics";
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
    capturePageview({ $current_url: url });
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
