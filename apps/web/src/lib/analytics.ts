// 퍼널 이벤트 캡처 래퍼 — PostHog 미설정 시 no-op.
// 핵심 퍼널: $pageview → signup_started → chat_message_sent / quote_check_submitted
//
// 2026-07-25: 정적 import는 posthog-js 64KB(gzip)를 초기 번들에 묶어
// 하이드레이션과 경쟁한다. 유휴 시점에 한 번만 동적 로드·초기화하고,
// 그 전에 들어온 이벤트는 이 프라미스를 기다렸다가 순서대로 보낸다.
// 로더가 한 곳에 있어야 초기화 전에 capture가 새는 일이 없다.
import {
  analyticsCaptureTouchesSuppressedPath,
  isWeddingCodeFunnelAnalyticsEffective,
  isWeddingCodeFunnelEvent,
  sanitizeWeddingCodeFunnelCapture,
  stripAnalyticsUrlFragments,
  type WeddingCodeFunnelEvent,
} from "@/lib/analyticsPrivacy";
import {
  dispatchLandingAnalytics,
  isLandingAnalyticsCapture,
  observeLandingAnalytics,
  sanitizeLandingAnalyticsCapture,
} from "@/lib/landingAnalytics";

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
            // SDK는 before_send 전에 현재 주소를 저장한다. 답이 담긴 공유 주소가
            // 쿠키·브라우저 저장소에 남지 않도록 저장을 끄고 기존 SDK 저장도 지운다.
            disable_persistence: true,
            save_campaign_params: false,
            save_referrer: false,
            // 기능 플래그 요청은 before_send를 거치지 않아 별도로 차단한다.
            advanced_disable_flags: true,
            // 필요한 퍼널 이벤트만 명시적으로 보낸다. DOM 문구와 입력값 자동 수집은 하지 않는다.
            autocapture: false,
            disable_session_recording: true,
            // 억제 경로는 통째로 버리고, 살아 나가는 이벤트에서는 URL 속성의
            // 프래그먼트를 잘라낸다. `capture_pageleave`가 켜져 있어 posthog-js가
            // `$current_url`에 `location.href`를 스스로 넣는데, 커플 초대 코드가
            // 바로 그 `#` 뒤에 실려 다닌다.
            // 이동 전 랜딩 관측과 고지일 이후 웨딩코드 흐름만 별도 허용 목록으로 정리한다.
            before_send: (capture) => (
              isLandingAnalyticsCapture(capture)
                ? sanitizeLandingAnalyticsCapture(capture)
                : isWeddingCodeFunnelEvent(capture?.event)
                  ? sanitizeWeddingCodeFunnelCapture(capture)
                  : analyticsCaptureTouchesSuppressedPath(capture, window.location.pathname)
                    ? null
                    : stripAnalyticsUrlFragments(capture)
            ),
          });
          resolve(posthog);
        })
        .catch(() => resolve(null));
    });
  });
  return clientPromise;
}

/**
 * 웨딩코드 흐름 이벤트. 답·코드·링크는 받지 않도록 속성 모양을 좁혀 둔다 — 넘기더라도
 * `before_send`가 한 번 더 버린다.
 */
export function captureWeddingCodeEvent(
  event: WeddingCodeFunnelEvent,
  properties: Readonly<Record<string, string | number | boolean>> = {},
) {
  // 고지한 적용일 전에는 posthog를 내려받지도 않는다.
  if (!isWeddingCodeFunnelAnalyticsEffective()) return;
  // v4 링크를 연 첫 순간에는 서버가 주소의 # 뒤를 못 봐서 v3.1 화면이 먼저 그려지고, 그 화면의 조회 이벤트가 v4 로 바뀌기 전에 나간다.
  // 주소에 v4 표지가 있는데 이벤트의 판이 v4 가 아니면 그 조회는 v4 링크 수신자의 것이 아니므로 보내지 않는다(시험 통계가 부풀지 않게).
  if (typeof window !== "undefined" && eventContradictsV40LinkHash(window.location.hash, properties.version)) return;
  captureEvent(event, { ...properties });
}

/**
 * v4 판 이름. WEDDING_CODE_V40_VERSION(constants/weddingCodeV40.ts)과 같은 값이다. 그 파일은 문구 자료가 커서 초기 번들에 실리는 이 파일이 가져오지 않는다
 * (같은 값인지는 시험이 견준다).
 */
const V40_LINK_TAG = "v4.0-tendency";

/** 주소의 해시에 v4 링크 표지가 있는데 이벤트의 판(version 속성)이 v4 가 아니면 true. 퍼센트 인코딩된 해시도 같은 글자가 그대로 들어 있어 잡힌다. */
export function eventContradictsV40LinkHash(hash: string, version: unknown): boolean {
  return typeof hash === "string" && hash.includes(V40_LINK_TAG) && version !== V40_LINK_TAG;
}

export function captureEvent(event: string, properties?: Record<string, unknown>) {
  if (event === "landing_cta_click") {
    if (typeof window === "undefined") return;
    const observation = observeLandingAnalytics(event, window.location, properties?.source);
    if (observation) captureLandingObservation(observation);
    return;
  }
  void loadPostHog()
    .then((posthog) => {
      posthog?.capture(event, properties);
    })
    .catch(() => {
      // 분석 실패가 기능을 깨면 안 됨
    });
}

function captureLandingObservation(observation: NonNullable<ReturnType<typeof observeLandingAnalytics>>) {
  void loadPostHog()
    .then((posthog) => {
      if (!posthog) return;
      dispatchLandingAnalytics(observation, (properties, timestamp) => {
        posthog.capture(observation.event, properties, { timestamp });
      });
    })
    .catch(() => {
      // 분석 실패가 화면 이동을 막으면 안 된다.
    });
}

export function capturePageview(properties: { $current_url: string }) {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(properties.$current_url, window.location.origin);
    if (url.pathname === "/landing") {
      if (url.origin !== window.location.origin) return;
      const observation = observeLandingAnalytics("$pageview", window.location);
      if (observation) captureLandingObservation(observation);
      return;
    }
  } catch {
    return;
  }
  // 나머지 화면은 기존 페이지뷰와 억제 규칙을 유지한다.
  captureEvent("$pageview", properties);
}
