// Sentry 브라우저 SDK는 gzip 147KB로 이 앱 클라이언트 JS의 최대 덩어리다
// (2026-07-25 실측: 전체 388KB 중 Sentry 147 + PostHog 64). 초기 번들에 두면
// 하이드레이션과 경쟁해 "누르면 반응이 늦다"는 체감을 만든다.
//
// 그래서 유휴 시점에 동적 로드하되, 로드 전 구간이 감시 사각지대가 되지
// 않도록 그 사이의 error·unhandledrejection을 버퍼에 담았다가 준비되면
// 그대로 흘려보낸다. 결과적으로 잡히는 에러는 이전과 같고 첫 화면만 가벼워진다.
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryTransaction,
} from "@hanbang/shared";

import { attachClientErrorSink, clearBufferedClientErrors } from "@/lib/observability/clientErrorReport";
import { resolveDeploymentEnvironment } from "@/lib/observability/deploymentEnvironment";
import { registerClientMonitoringPathCommit } from "@/lib/observability/clientMonitoringPathCommit";
import { isWeddingCodeLikertPath, valueTouchesWeddingCodeLikertPath } from "@/lib/analyticsPrivacy";

type SentryModule = typeof import("@sentry/nextjs");

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

/** 프리뷰 배포를 운영으로 착각하지 않게 하는 값. 판정 규칙과 이유는 도우미에 있다. */
function resolveEnvironment(): string {
  return resolveDeploymentEnvironment({
    vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
    hostname: typeof window !== "undefined" ? window.location.hostname : undefined,
    nodeEnv: process.env.NODE_ENV,
  });
}

let sentry: SentryModule | null = null;
const buffered: unknown[] = [];
const MAX_BUFFERED = 20;
let initializationPending = false;
let listenersAttached = false;
let errorSinkAttached = false;

function isLikertPage(): boolean {
  return typeof window !== "undefined" && isWeddingCodeLikertPath(window.location.pathname);
}

function touchesLikertPath(value: unknown): boolean {
  return valueTouchesWeddingCodeLikertPath(
    value,
    typeof window === "undefined" ? undefined : window.location.pathname,
  );
}

function isLikertDestination(value: unknown): boolean {
  if (typeof value !== "string" || (!value.startsWith("/") && !/^https?:\/\//i.test(value))) return false;
  try {
    return isWeddingCodeLikertPath(new URL(value, "https://hanbang.invalid").pathname);
  } catch {
    return false;
  }
}

function detachBufferedListeners() {
  if (!listenersAttached) return;
  window.removeEventListener("error", bufferError);
  window.removeEventListener("unhandledrejection", bufferRejection);
  listenersAttached = false;
}

function attachBufferedListeners() {
  if (listenersAttached || isLikertPage()) return;
  window.addEventListener("error", bufferError);
  window.addEventListener("unhandledrejection", bufferRejection);
  listenersAttached = true;
}

function clearPendingErrors() {
  buffered.length = 0;
  clearBufferedClientErrors();
}

function bufferError(event: ErrorEvent) {
  if (isLikertPage()) { clearPendingErrors(); return; }
  if (buffered.length < MAX_BUFFERED) buffered.push(event.error ?? event.message);
}

function bufferRejection(event: PromiseRejectionEvent) {
  if (isLikertPage()) { clearPendingErrors(); return; }
  if (buffered.length < MAX_BUFFERED) buffered.push(event.reason);
}

function whenIdle(run: () => void) {
  const idle = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
  }).requestIdleCallback;
  if (idle) idle(run, { timeout: 3_000 });
  else window.setTimeout(run, 1_200);
}

function attachSentryErrorSink(mod: SentryModule) {
  if (errorSinkAttached || isLikertPage()) return;
  attachClientErrorSink((error, context) => {
    if (isLikertPage()) return;
    mod.captureException(
      error,
      context.digest
        ? { tags: { next_digest: context.digest }, fingerprint: ["{{ default }}", context.digest] }
        : undefined,
    );
  });
  errorSinkAttached = true;
}

function scheduleSentryInitialization(allowLeavingLikert = false) {
  if (typeof window === "undefined" || !dsn || sentry || initializationPending
    || (isLikertPage() && !allowLeavingLikert)) return;
  initializationPending = true;
  attachBufferedListeners();

  whenIdle(() => {
    if (isLikertPage()) {
      clearPendingErrors();
      detachBufferedListeners();
      initializationPending = false;
      return;
    }
    attachBufferedListeners();
    void import("@sentry/nextjs")
      .then((mod) => {
        if (isLikertPage()) { clearPendingErrors(); return; }
        mod.init({
          dsn,
          enabled: true,
          environment: resolveEnvironment(),
          tracesSampleRate: 0.1,
          // 브라우저에서 잡히는 오류에는 사용자가 입력한 문장이 그대로 실릴 수 있다.
          // 서버·edge와 같은 규칙으로 나가기 전에 지운다.
          beforeSend: (event) => touchesLikertPath(event) ? null : sanitizeSentryEvent(event as never) as typeof event,
          beforeSendTransaction: (event) =>
            touchesLikertPath(event) ? null : sanitizeSentryTransaction(event as never) as typeof event,
          beforeBreadcrumb: (breadcrumb) =>
            touchesLikertPath(breadcrumb) ? null : sanitizeSentryBreadcrumb(breadcrumb as never) as typeof breadcrumb,
        });
        sentry = mod;
        if (isLikertPage()) clearPendingErrors();
        else for (const error of buffered) mod.captureException(error);
        buffered.length = 0;
        // 에러 경계가 담아 둔 것도 여기서 함께 흘린다. 경계가 잡은 오류는 위의
        // window 리스너에 안 걸리므로 이 통로가 유일하다.
        //
        // digest 를 fingerprint 에 넣는 이유: 운영 빌드의 서버 컴포넌트 오류는
        // 라우트와 무관하게 문구가 같고 스택도 비어 있어, 그냥 두면 전 라우트가
        // 한 이슈로 뭉쳐 "새 이슈" 알림이 한 번만 울린다.
        attachSentryErrorSink(mod);
      })
      .catch(() => {
        // 모니터링 로드 실패가 서비스를 막으면 안 된다.
      })
      .finally(() => {
        initializationPending = false;
        detachBufferedListeners();
      });
  });
}

if (typeof window !== "undefined" && dsn) {
  registerClientMonitoringPathCommit(() => {
    if (isLikertPage()) {
      clearPendingErrors();
      detachBufferedListeners();
      return;
    }
    scheduleSentryInitialization();
    if (sentry) attachSentryErrorSink(sentry);
  });
}

scheduleSentryInitialization();

// Next가 라우트 전환마다 동기로 호출한다 — SDK가 아직 없으면 조용히 넘긴다.
export function onRouterTransitionStart(
  ...args: Parameters<SentryModule["captureRouterTransitionStart"]>
) {
  if (isLikertDestination(args[0])) { clearPendingErrors(); return; }
  if (isLikertPage()) {
    clearPendingErrors();
    scheduleSentryInitialization(true);
    return;
  }
  scheduleSentryInitialization();
  if (sentry) attachSentryErrorSink(sentry);
  sentry?.captureRouterTransitionStart(...args);
}
