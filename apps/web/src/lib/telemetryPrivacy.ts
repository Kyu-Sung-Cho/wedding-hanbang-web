const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "ct",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "code",
  "query",
  "query_string",
  "search",
  "search_params",
]);

function normalizedKey(key: string): string {
  return key.trim().toLowerCase().replace(/-/g, "_");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key).replace(/^\$+/, "");
  return SENSITIVE_KEYS.has(normalized) ||
    normalized.endsWith("_token") ||
    normalized.endsWith("_secret") ||
    normalized.endsWith("_password");
}

function isUrlKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return normalized.includes("url") ||
    normalized.includes("uri") ||
    normalized.includes("href") ||
    normalized.includes("referrer") ||
    normalized.includes("referer");
}

export function stripUrlQueryAndHash(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed, "https://telemetry.invalid");
    if (parsed.origin === "https://telemetry.invalid") {
      return parsed.pathname;
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return trimmed.split(/[?#]/, 1)[0];
  }
}

export function redactTelemetryText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/([?&#]|\b)(ct|access_token|refresh_token|id_token|token|code)=([^\s&#]+)/gi,
      (_match, prefix: string, key: string) => `${prefix}${key}=[redacted]`);
}

function sanitizeDiagnosticText(value: string): string {
  return redactTelemetryText(value).replace(
    /((?:https?:\/\/|\/)[^\s?#]+)[?#][^\s]*/gi,
    "$1"
  );
}

function sanitizeTelemetryValue(item: unknown, parentKey: string): unknown {
  if (typeof item === "string") {
    return isUrlKey(parentKey)
      ? stripUrlQueryAndHash(item)
      : sanitizeDiagnosticText(item);
  }
  if (Array.isArray(item)) {
    return item.map((entry) => sanitizeTelemetryValue(entry, parentKey));
  }
  if (item && typeof item === "object") {
    return sanitizeTelemetryRecord(item as Record<string, unknown>);
  }
  return item;
}

export function sanitizeTelemetryRecord(
  value: Record<string, unknown> | undefined | null
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    sanitized[key] = sanitizeTelemetryValue(item, key);
  }
  return sanitized;
}

type SentryLikeEvent = {
  request?: {
    url?: string;
    query_string?: unknown;
    headers?: Record<string, unknown>;
    data?: unknown;
    [key: string]: unknown;
  };
  user?: unknown;
  message?: string;
  transaction?: string;
  exception?: { values?: Array<{ value?: string; [key: string]: unknown }> };
  breadcrumbs?: Array<{
    message?: string;
    data?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  [key: string]: unknown;
};

export function sanitizeSentryEvent<T>(event: T): T {
  const mutable = event as unknown as SentryLikeEvent;
  if (typeof mutable.message === "string") {
    mutable.message = sanitizeDiagnosticText(mutable.message);
  }
  if (typeof mutable.transaction === "string") {
    mutable.transaction = sanitizeDiagnosticText(mutable.transaction);
  }
  mutable.exception?.values?.forEach((exception) => {
    if (typeof exception.value === "string") {
      exception.value = sanitizeDiagnosticText(exception.value);
    }
  });
  if (mutable.request) {
    if (typeof mutable.request.url === "string") {
      mutable.request.url = stripUrlQueryAndHash(mutable.request.url);
    }
    delete mutable.request.query_string;
    mutable.request.headers = sanitizeTelemetryRecord(mutable.request.headers);
    if (typeof mutable.request.data === "string") {
      mutable.request.data = "[redacted]";
    } else if (mutable.request.data && typeof mutable.request.data === "object") {
      mutable.request.data = sanitizeTelemetryRecord(
        mutable.request.data as Record<string, unknown>
      );
    }
  }
  delete mutable.user;
  mutable.extra = sanitizeTelemetryRecord(mutable.extra);
  mutable.contexts = sanitizeTelemetryRecord(mutable.contexts);
  mutable.tags = sanitizeTelemetryRecord(mutable.tags);
  mutable.breadcrumbs = mutable.breadcrumbs?.map((breadcrumb) => ({
    ...breadcrumb,
    ...(typeof breadcrumb.message === "string"
      ? { message: sanitizeDiagnosticText(breadcrumb.message) }
      : {}),
    data: sanitizeTelemetryRecord(breadcrumb.data),
  }));
  return event;
}
