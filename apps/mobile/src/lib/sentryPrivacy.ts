import type { Breadcrumb, ErrorEvent, TransactionEvent } from "@sentry/react-native";

const REDACTED = "[redacted]";
const REDACTED_ERROR = "[redacted-error]";

function redactText(value: string | undefined): string | undefined {
  if (!value) return value;

  return value
    // React Navigation/Sentry can record root-relative route names. Strip
    // query strings and fragments before applying the broader text scrubbers.
    .replace(/(^|\s)(\/(?!\/)[^\s?#]*)[?#][^\s]*/gu, "$1$2")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED)
    .replace(/(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, REDACTED)
    .replace(/\b\d{6}-?[1-4]\d{6}\b/g, REDACTED)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, REDACTED)
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}(?:\.[A-Za-z0-9_-]{12,})?\b/g, REDACTED)
    .replace(/\b(?:sk-(?:proj-)?|sbp_|sb_secret_|sntrys_)[A-Za-z0-9_-]{16,}\b/g, REDACTED);
}

function removeCommonPrivateFields<T extends ErrorEvent | TransactionEvent>(event: T): T {
  event.user = undefined;
  event.request = undefined;
  event.extra = undefined;
  event.contexts = undefined;
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
    // Console/UI breadcrumbs can contain arbitrary form values even when they
    // do not look like an email, phone number, or token.
    message: breadcrumb.message ? REDACTED : breadcrumb.message,
    data: undefined,
  };
}

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  removeCommonPrivateFields(event);

  if (event.message) event.message = REDACTED_ERROR;

  if (event.logentry) {
    event.logentry.message = REDACTED_ERROR;
    event.logentry.params = undefined;
  }

  for (const exception of event.exception?.values ?? []) {
    // The type and stacktrace remain available for grouping and debugging.
    if (exception.value) exception.value = REDACTED_ERROR;
  }

  return event;
}

export function sanitizeSentryTransaction(event: TransactionEvent): TransactionEvent {
  removeCommonPrivateFields(event);

  for (const span of event.spans ?? []) {
    span.description = span.description ? REDACTED : span.description;
    span.data = {};
  }

  return event;
}
