import * as Sentry from "@sentry/nextjs";
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryTransaction,
} from "@hanbang/shared";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  // 오류 리포팅은 사고를 보기 위한 것이지 대화를 보기 위한 것이 아니다.
  // 공용 로거가 `extra`에 임의 payload를 실을 수 있으므로 나가기 전에 지운다.
  beforeSend: (event) => sanitizeSentryEvent(event as never) as typeof event,
  beforeSendTransaction: (event) => sanitizeSentryTransaction(event as never) as typeof event,
  beforeBreadcrumb: (breadcrumb) => sanitizeSentryBreadcrumb(breadcrumb as never) as typeof breadcrumb,
});
