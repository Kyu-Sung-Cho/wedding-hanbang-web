import * as Sentry from "@sentry/nextjs";
import {
  sanitizeSentryTelemetryBreadcrumb,
  sanitizeSentryTelemetryEvent,
  sanitizeSentryTelemetryTransaction,
} from "./src/lib/telemetryPrivacy";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  beforeSend: (event) => sanitizeSentryTelemetryEvent(event),
  beforeSendTransaction: (event) => sanitizeSentryTelemetryTransaction(event),
  beforeBreadcrumb: (breadcrumb) => sanitizeSentryTelemetryBreadcrumb(breadcrumb),
});
