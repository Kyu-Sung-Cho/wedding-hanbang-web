import * as Sentry from "@sentry/nextjs";
import { sanitizeSentryEvent } from "./src/lib/telemetryPrivacy";
import { THIRD_PARTY_TELEMETRY_ENABLED } from "./src/lib/telemetryPolicy";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: THIRD_PARTY_TELEMETRY_ENABLED && Boolean(dsn),
  environment: process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend: (event) => sanitizeSentryEvent(event),
  beforeSendTransaction: (event) => sanitizeSentryEvent(event),
});
