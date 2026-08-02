// Sentry 브라우저 SDK는 gzip 147KB로 이 앱 클라이언트 JS의 최대 덩어리다
// (2026-07-25 실측: 전체 388KB 중 Sentry 147 + PostHog 64). 초기 번들에 두면
// 하이드레이션과 경쟁해 "누르면 반응이 늦다"는 체감을 만든다.
//
// 그래서 유휴 시점에 동적 로드하되, 로드 전 구간이 감시 사각지대가 되지
// 않도록 그 사이의 error·unhandledrejection을 버퍼에 담았다가 준비되면
// 그대로 흘려보낸다. 결과적으로 잡히는 에러는 이전과 같고 첫 화면만 가벼워진다.
import {
  captureAndClearSensitiveAuthUrl,
} from "@/lib/auth/sensitiveAuthUrl";
import {
  sanitizeSentryTelemetryBreadcrumb,
  sanitizeSentryTelemetryEvent,
  sanitizeSentryTelemetryTransaction,
} from "@/lib/telemetryPrivacy";

type SentryModule = typeof import("@sentry/nextjs");

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

let sentry: SentryModule | null = null;
const buffered: unknown[] = [];
const MAX_BUFFERED = 20;

function bufferError(event: ErrorEvent) {
  if (buffered.length < MAX_BUFFERED) buffered.push(event.error ?? event.message);
}

function bufferRejection(event: PromiseRejectionEvent) {
  if (buffered.length < MAX_BUFFERED) buffered.push(event.reason);
}

function whenIdle(run: () => void) {
  const idle = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
  }).requestIdleCallback;
  if (idle) idle(run, { timeout: 3_000 });
  else window.setTimeout(run, 1_200);
}

if (typeof window !== "undefined") {
  captureAndClearSensitiveAuthUrl();
}

if (typeof window !== "undefined" && dsn) {
  window.addEventListener("error", bufferError);
  window.addEventListener("unhandledrejection", bufferRejection);

  whenIdle(() => {
    void import("@sentry/nextjs")
      .then((mod) => {
        mod.init({
          dsn,
          enabled: true,
          environment: process.env.NODE_ENV,
          sendDefaultPii: false,
          tracesSampleRate: 0.1,
          beforeSend: (event) => sanitizeSentryTelemetryEvent(event),
      beforeSendTransaction: (event) => sanitizeSentryTelemetryTransaction(event),
          beforeBreadcrumb: (breadcrumb) => sanitizeSentryTelemetryBreadcrumb(breadcrumb),
        });
        sentry = mod;
        for (const error of buffered) mod.captureException(error);
        buffered.length = 0;
      })
      .catch(() => {
        // 모니터링 로드 실패가 서비스를 막으면 안 된다.
      })
      .finally(() => {
        window.removeEventListener("error", bufferError);
        window.removeEventListener("unhandledrejection", bufferRejection);
      });
  });
}

// Next가 라우트 전환마다 동기로 호출한다 — SDK가 아직 없으면 조용히 넘긴다.
export function onRouterTransitionStart(
  ...args: Parameters<SentryModule["captureRouterTransitionStart"]>
) {
  sentry?.captureRouterTransitionStart(...args);
}
