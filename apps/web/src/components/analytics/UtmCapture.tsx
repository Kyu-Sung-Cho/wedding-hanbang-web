"use client";

// 첫 페이지 로드 시 first-touch UTM을 sessionStorage에 보존.
// PostHog 키 유무와 무관하게 항상 동작해야 해서 AnalyticsProvider와 분리.
import { useEffect } from "react";
import { persistFirstTouchUtm } from "@/utils/utm";

export default function UtmCapture() {
  useEffect(() => {
    persistFirstTouchUtm();
  }, []);
  return null;
}
