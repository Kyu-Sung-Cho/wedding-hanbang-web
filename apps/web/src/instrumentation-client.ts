import * as Sentry from "@sentry/nextjs";
import { sanitizeSentryEvent } from "@/lib/telemetryPrivacy";
import { THIRD_PARTY_TELEMETRY_ENABLED } from "@/lib/telemetryPolicy";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: THIRD_PARTY_TELEMETRY_ENABLED && Boolean(dsn),
  environment: process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend: (event) => sanitizeSentryEvent(event),
  beforeSendTransaction: (event) => sanitizeSentryEvent(event),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
