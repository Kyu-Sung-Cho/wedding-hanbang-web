// Sentry 초기화 — DSN이 있을 때만 활성화
// Phase 1 에서 Sentry 프로젝트 생성 후 EXPO_PUBLIC_SENTRY_DSN 채우면 자동 on

import * as Sentry from "@sentry/react-native";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function initSentry() {
  if (!dsn) {
    if (__DEV__) {
      console.warn("[Sentry] DSN 없음 — Sentry 비활성화 (개발 중)");
    }
    return;
  }

  Sentry.init({
    dsn,
    debug: __DEV__,
    tracesSampleRate: __DEV__ ? 1.0 : 0.2,
    environment: __DEV__ ? "development" : "production",
    enableAutoPerformanceTracing: true,
    enableNativeCrashHandling: true,
  });
}

export { Sentry };
