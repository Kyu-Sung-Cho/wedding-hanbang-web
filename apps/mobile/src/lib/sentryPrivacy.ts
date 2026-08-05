// 규칙 본체는 `@hanbang/shared`에 있다. 웹과 모바일이 서로 다른 Sentry SDK를 쓰지만
// 개인정보를 지우는 기준은 하나여야 한다. 여기서는 SDK 타입만 얹는다.
import type { Breadcrumb, ErrorEvent, TransactionEvent } from "@sentry/react-native";
import {
  sanitizeSentryBreadcrumb as sanitizeBreadcrumb,
  sanitizeSentryEvent as sanitizeEvent,
  sanitizeSentryTransaction as sanitizeTransaction,
} from "@hanbang/shared";

export function sanitizeSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  return sanitizeBreadcrumb(breadcrumb as never) as Breadcrumb;
}

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  return sanitizeEvent(event as never) as ErrorEvent;
}

export function sanitizeSentryTransaction(event: TransactionEvent): TransactionEvent {
  return sanitizeTransaction(event as never) as TransactionEvent;
}
