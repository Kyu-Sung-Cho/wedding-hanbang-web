"use client";

import { useCallback, useEffect, useRef } from "react";

interface TrackEventOptions {
  vendorId?: string;
  productId?: string;
  metadata?: Record<string, unknown>;
  durationSeconds?: number;
}

// 세션 ID 생성 (탭별 고유)
function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let sessionId = sessionStorage.getItem("event_session_id");
  if (!sessionId) {
    sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem("event_session_id", sessionId);
  }
  return sessionId;
}

// 중복 방지: 같은 이벤트 5초 내 재전송 차단
const recentEvents = new Map<string, number>();
function isDuplicate(key: string): boolean {
  const now = Date.now();
  const last = recentEvents.get(key);
  if (last && now - last < 5000) return true;
  recentEvents.set(key, now);
  return false;
}

function isDemoMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.includes("demo_mode=true");
}

async function sendEvent(eventType: string, options: TrackEventOptions = {}) {
  if (isDemoMode()) return;

  const key = `${eventType}:${options.vendorId || ""}:${options.productId || ""}`;
  if (isDuplicate(key)) return;

  try {
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType,
        vendorId: options.vendorId,
        productId: options.productId,
        metadata: options.metadata,
        durationSeconds: options.durationSeconds,
        sessionId: getSessionId(),
      }),
    });
  } catch {
    // 추적 실패는 무시 (UX에 영향 없음)
  }
}

export function useEventTracker() {
  const trackEvent = useCallback((eventType: string, options: TrackEventOptions = {}) => {
    sendEvent(eventType, options);
  }, []);

  return { trackEvent };
}

// 페이지뷰 자동 추적 훅 (클릭스트림)
export function usePageViewTracker(enabled = true) {
  const lastPath = useRef("");

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const trackPageView = () => {
      const path = window.location.pathname;
      if (path === lastPath.current) return;
      lastPath.current = path;
      sendEvent("page_view", {
        metadata: {
          path,
          referrer: document.referrer || undefined,
          timestamp: new Date().toISOString(),
        },
      });
    };

    // 첫 페이지뷰
    trackPageView();

    // SPA 네비게이션 감지
    const observer = new MutationObserver(() => {
      if (window.location.pathname !== lastPath.current) {
        trackPageView();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [enabled]);
}

// 체류시간 자동 추적 훅
export function useViewDuration(vendorId?: string, productId?: string) {
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!vendorId) return;
    startTimeRef.current = Date.now();

    return () => {
      const duration = Math.round((Date.now() - startTimeRef.current) / 1000);
      if (duration >= 3) {
        sendEvent("view_duration", {
          vendorId,
          productId,
          durationSeconds: duration,
        });
      }
    };
  }, [vendorId, productId]);
}
