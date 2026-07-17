import * as Sentry from "@sentry/react-native";
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryTransaction,
} from "./sentryPrivacy";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

let initialized = false;
let navigationIntegration: ReturnType<typeof Sentry.reactNavigationIntegration> | null = null;

export function initSentry(): boolean {
  if (initialized) return true;

  if (!dsn) {
    if (__DEV__) {
      console.warn("[Sentry] DSN 없음 — Sentry 비활성화 (개발 중)");
    }
    return false;
  }

  navigationIntegration = Sentry.reactNavigationIntegration({
    enableTimeToInitialDisplay: true,
  });

  Sentry.init({
    dsn,
    debug: __DEV__,
    sampleRate: 1.0,
    tracesSampleRate: __DEV__ ? 1.0 : 0.03,
    environment: __DEV__ ? "development" : "production",
    integrations: [navigationIntegration],
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableCaptureFailedRequests: false,
    enableAutoPerformanceTracing: true,
    enableNativeCrashHandling: true,
    beforeBreadcrumb: sanitizeSentryBreadcrumb,
    beforeSend: sanitizeSentryEvent,
    beforeSendTransaction: sanitizeSentryTransaction,
  });

  initialized = true;
  return true;
}

export function registerSentryNavigationContainer(navigationContainerRef: unknown): void {
  navigationIntegration?.registerNavigationContainer(navigationContainerRef);
}

export { Sentry };
