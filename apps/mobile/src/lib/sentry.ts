// 처리위탁·리전·보유기간·국외처리 고지 승인 전에는 DSN과 무관하게 비활성화한다.

import * as Sentry from "@sentry/react-native";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
const THIRD_PARTY_TELEMETRY_ENABLED = false;

export function initSentry() {
  if (!THIRD_PARTY_TELEMETRY_ENABLED || !dsn) {
    if (__DEV__) {
      console.warn("[Sentry] 개인정보 처리 승인 전 코드 비활성화 상태");
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
