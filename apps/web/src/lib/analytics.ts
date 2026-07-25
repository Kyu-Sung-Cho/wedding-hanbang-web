// 퍼널 이벤트 캡처 래퍼 — PostHog 미설정 시 no-op.
// 핵심 퍼널: $pageview(UTM 자동) → signup_started → chat_message_sent / quote_check_submitted
//
// 2026-07-25: 정적 import는 posthog-js 64KB(gzip)를 초기 번들에 묶어
// 하이드레이션과 경쟁한다. 유휴 시점에 한 번만 동적 로드·초기화하고,
// 그 전에 들어온 이벤트는 이 프라미스를 기다렸다가 순서대로 보낸다.
// 로더가 한 곳에 있어야 초기화 전에 capture가 새는 일이 없다.
type PostHogModule = typeof import("posthog-js").default;

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

let clientPromise: Promise<PostHogModule | null> | null = null;

function whenIdle(run: () => void) {
  const idle = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
  }).requestIdleCallback;
  if (idle) idle(run, { timeout: 3_000 });
  else window.setTimeout(run, 1_200);
}

/** 유휴 시점에 posthog-js를 내려받아 1회 초기화한다. 키가 없으면 null. */
export function loadPostHog(): Promise<PostHogModule | null> {
  if (typeof window === "undefined" || !POSTHOG_KEY) return Promise.resolve(null);
  if (clientPromise) return clientPromise;
  clientPromise = new Promise<PostHogModule | null>((resolve) => {
    whenIdle(() => {
      void import("posthog-js")
        .then(({ default: posthog }) => {
          posthog.init(POSTHOG_KEY, {
            api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
            capture_pageview: false, // App Router 라우트 전환은 Provider에서 수동 캡처
            capture_pageleave: true,
            persistence: "localStorage+cookie",
          });
          resolve(posthog);
        })
        .catch(() => resolve(null));
    });
  });
  return clientPromise;
}

export function captureEvent(event: string, properties?: Record<string, unknown>) {
  void loadPostHog()
    .then((posthog) => {
      posthog?.capture(event, properties);
    })
    .catch(() => {
      // 분석 실패가 기능을 깨면 안 됨
    });
}
