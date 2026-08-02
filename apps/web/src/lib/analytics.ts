import { sanitizeTelemetryObject } from "@/lib/telemetryPrivacy";
import { hasExplicitThirdPartyAnalyticsConsent } from "@/lib/analyticsPrivacy";
import { useAuthStore } from "@/stores/authStore";

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
let analyticsIdentityEpoch = 0;
let analyticsActorId = useAuthStore.getState().user?.id ?? null;
let analyticsResetPending = false;

function reconcileAnalyticsIdentity(posthog?: PostHogModule | null): number {
  const nextActorId = useAuthStore.getState().user?.id ?? null;
  if (nextActorId !== analyticsActorId) {
    analyticsActorId = nextActorId;
    analyticsIdentityEpoch += 1;
    analyticsResetPending = true;
  }
  if (posthog && analyticsResetPending) {
    posthog.reset();
    analyticsResetPending = false;
  }
  return analyticsIdentityEpoch;
}

/** Invalidates queued captures and rotates PostHog's memory-only anonymous id. */
export function resetAnalyticsIdentityBoundary(): void {
  analyticsIdentityEpoch += 1;
  analyticsActorId = useAuthStore.getState().user?.id ?? null;
  analyticsResetPending = true;
  if (clientPromise) {
    const resetEpoch = analyticsIdentityEpoch;
    void clientPromise.then((posthog) => {
      if (!posthog || resetEpoch !== analyticsIdentityEpoch) return;
      reconcileAnalyticsIdentity(posthog);
    }).catch(() => undefined);
  }
}

function whenIdle(run: () => void) {
  const idle = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
  }).requestIdleCallback;
  if (idle) idle(run, { timeout: 3_000 });
  else window.setTimeout(run, 1_200);
}

/** 유휴 시점에 posthog-js를 내려받아 1회 초기화한다. 키가 없으면 null. */
export function loadPostHog(): Promise<PostHogModule | null> {
  if (
    typeof window === "undefined"
    || !POSTHOG_KEY
    || !hasExplicitThirdPartyAnalyticsConsent()
  ) {
    return Promise.resolve(null);
  }
  if (clientPromise) return clientPromise;
  clientPromise = new Promise<PostHogModule | null>((resolve) => {
    whenIdle(() => {
      void import("posthog-js")
        .then(({ default: posthog }) => {
          posthog.init(POSTHOG_KEY, {
            // Keep the browser transfer destination identical to the reviewed
            // processor disclosure and the exact CSP allowlist.
            api_host: "https://us.i.posthog.com",
            capture_pageview: false, // App Router 라우트 전환은 Provider에서 수동 캡처
            // 명시적으로 정의한 퍼널 이벤트만 보낸다. 자동 클릭·DOM·세션 녹화는
            // 웨딩 답변, 자유 텍스트, 공유 링크를 제3자에게 실어 보낼 수 있다.
            autocapture: false,
            capture_pageleave: false,
            disable_session_recording: true,
            disable_surveys: true,
            disable_external_dependency_loading: true,
            advanced_disable_flags: true,
            mask_personal_data_properties: true,
            respect_dnt: true,
            save_campaign_params: false,
            save_referrer: false,
            // 분석 식별자는 탭 수명 안에서만 유지한다. 장기 쿠키/localStorage와
            // PostHog 사용자 프로필은 제품 기능에 필요하지 않으므로 만들지 않는다.
            persistence: "memory",
            person_profiles: "never",
            before_send: (event) => event
              ? sanitizeTelemetryObject(event)
              : event,
          });
          resolve(posthog);
        })
        .catch(() => resolve(null));
    });
  });
  return clientPromise;
}

export function captureEvent(event: string, properties?: Record<string, unknown>) {
  if (!hasExplicitThirdPartyAnalyticsConsent()) return;
  const captureEpoch = reconcileAnalyticsIdentity();
  void loadPostHog()
    .then((posthog) => {
      reconcileAnalyticsIdentity(posthog);
      if (captureEpoch !== analyticsIdentityEpoch) return;
      posthog?.capture(event, properties);
    })
    .catch(() => {
      // 분석 실패가 기능을 깨면 안 됨
    });
}
