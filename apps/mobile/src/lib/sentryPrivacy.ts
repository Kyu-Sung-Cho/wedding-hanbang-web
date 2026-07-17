import type { Breadcrumb, ErrorEvent, TransactionEvent } from "@sentry/react-native";

const REDACTED = "[redacted]";

function redactText(value: string | undefined): string | undefined {
  if (!value) return value;

  return value
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED)
    .replace(/(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, REDACTED)
    .replace(/\b\d{6}-?[1-4]\d{6}\b/g, REDACTED)
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}(?:\.[A-Za-z0-9_-]{12,})?\b/g, REDACTED)
    .replace(/\b(?:sk|sbp|sntrys)_[A-Za-z0-9_-]{16,}\b/g, REDACTED);
}

function removeCommonPrivateFields<T extends ErrorEvent | TransactionEvent>(event: T): T {
  event.user = undefined;
  event.request = undefined;
  event.extra = undefined;
  event.message = redactText(event.message);
  event.transaction = redactText(event.transaction);
  event.breadcrumbs = event.breadcrumbs
    ?.map(sanitizeSentryBreadcrumb)
    .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null);
  return event;
}

export function sanitizeSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  return {
    ...breadcrumb,
    message: redactText(breadcrumb.message),
    data: undefined,
  };
}

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  removeCommonPrivateFields(event);

  if (event.logentry) {
    event.logentry.message = redactText(event.logentry.message) ?? REDACTED;
    event.logentry.params = undefined;
  }

  for (const exception of event.exception?.values ?? []) {
    exception.value = redactText(exception.value);
  }

  return event;
}

export function sanitizeSentryTransaction(event: TransactionEvent): TransactionEvent {
  removeCommonPrivateFields(event);

  for (const span of event.spans ?? []) {
    span.description = redactText(span.description);
    span.data = {};
  }

  return event;
}
