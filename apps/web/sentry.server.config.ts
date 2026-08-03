import * as Sentry from "@sentry/nextjs";
import {
  sanitizeSentryTelemetryBreadcrumb,
  sanitizeSentryTelemetryEvent,
  sanitizeSentryTelemetryTransaction,
} from "./src/lib/telemetryPrivacy";
import { isPreviewStubMode } from "./src/lib/previewStub";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn) && !isPreviewStubMode(),
  environment: process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  beforeSend: (event) => sanitizeSentryTelemetryEvent(event),
  beforeSendTransaction: (event) => sanitizeSentryTelemetryTransaction(event),
  beforeBreadcrumb: (breadcrumb) => sanitizeSentryTelemetryBreadcrumb(breadcrumb),
});
