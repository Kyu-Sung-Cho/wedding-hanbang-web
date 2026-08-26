import * as Sentry from "@sentry/nextjs";
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryTransaction,
} from "@hanbang/shared";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

// Vercel 은 프리뷰도 NODE_ENV=production 으로 빌드하고 DSN 도 Preview·Production
// 양쪽에 켜져 있다. 그래서 예전 `environment: process.env.NODE_ENV` 는 브랜치 배포
// 오류를 운영 오류와 구분하지 못했다. VERCEL_ENV 는 서버에서 이미 6곳이 쓰고 있다.
const environment = process.env.VERCEL_ENV || process.env.NODE_ENV;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment,
  tracesSampleRate: 0.1,
  // 오류 리포팅은 사고를 보기 위한 것이지 대화를 보기 위한 것이 아니다.
  // 공용 로거가 `extra`에 임의 payload를 실을 수 있으므로 나가기 전에 지운다.
  beforeSend: (event) => sanitizeSentryEvent(event as never) as typeof event,
  beforeSendTransaction: (event) => sanitizeSentryTransaction(event as never) as typeof event,
  beforeBreadcrumb: (breadcrumb) => sanitizeSentryBreadcrumb(breadcrumb as never) as typeof breadcrumb,
});
