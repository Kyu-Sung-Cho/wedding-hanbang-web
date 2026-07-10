const REDACTED_VALUE = "[REDACTED]";

export const POSTHOG_SENSITIVE_QUERY_KEYS = [
  "ct",
  "code",
  "token",
  "access_token",
  "refresh_token",
  "invite_code",
  "couple_token",
] as const;

const SENSITIVE_QUERY_KEYS = new Set<string>(POSTHOG_SENSITIVE_QUERY_KEYS);

type AnalyticsCaptureLike = {
  properties?: unknown;
  $set?: unknown;
  $set_once?: unknown;
};

type NetworkCaptureLike = {
  name: string;
  requestBody?: string | null;
  responseBody?: string | null;
  requestHeaders?: unknown;
  responseHeaders?: unknown;
};

function isSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return SENSITIVE_QUERY_KEYS.has(normalized) || normalized.endsWith("_token");
}

function isUrlKey(key: string | undefined): boolean {
  if (!key) return false;
  const normalized = key.trim().toLowerCase();
  return (
    normalized === "url" ||
    normalized === "href" ||
    normalized === "src" ||
    normalized === "referrer" ||
    normalized === "$referrer" ||
    normalized === "$current_url" ||
    normalized.endsWith("_url")
  );
}

function looksLikeUrl(value: string): boolean {
  return /^(?:https?:\/\/|\/\/|\/|\?|#)/i.test(value);
}

function redactParams(params: URLSearchParams): void {
  for (const key of [...params.keys()]) {
    if (isSensitiveKey(key)) params.set(key, REDACTED_VALUE);
  }
}

function redactHash(hash: string): string {
  if (!hash || hash === "#") return hash;

  const content = hash.slice(1);
  const queryIndex = content.indexOf("?");
  const prefix = queryIndex >= 0 ? content.slice(0, queryIndex + 1) : "";
  const rawParams = queryIndex >= 0 ? content.slice(queryIndex + 1) : content;
  if (!rawParams.includes("=")) return hash;

  const params = new URLSearchParams(rawParams);
  redactParams(params);
  return `#${prefix}${params.toString()}`;
}

/**
 * Capability/auth query values must never leave the browser through analytics.
 * UTM and other non-sensitive parameters are intentionally preserved.
 */
export function redactSensitiveUrl(raw: string): string {
  if (!/[?&#]/.test(raw)) return raw;

  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(raw);
  const protocolRelative = raw.startsWith("//");
  const queryOnly = raw.startsWith("?");
  const hashOnly = raw.startsWith("#");

  try {
    const url = new URL(
      hashOnly ? `/${raw}` : raw,
      absolute ? undefined : "https://analytics-redaction.invalid"
    );
    redactParams(url.searchParams);
    url.hash = redactHash(url.hash);

    if (absolute) return url.toString();
    if (protocolRelative) return `//${url.host}${url.pathname}${url.search}${url.hash}`;
    if (queryOnly) return `${url.search}${url.hash}`;
    if (hashOnly) return url.hash;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // Non-URL analytics text is left intact. Secret-valued properties are still
    // removed by redactSensitiveAnalyticsValue based on their property key.
    return raw;
  }
}

function redactSensitiveAnalyticsValue(value: unknown, key?: string): unknown {
  if (key && isSensitiveKey(key)) return REDACTED_VALUE;
  if (typeof value === "string") {
    return isUrlKey(key) || looksLikeUrl(value) ? redactSensitiveUrl(value) : value;
  }
  if (Array.isArray(value)) return value.map((item) => redactSensitiveAnalyticsValue(item));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactSensitiveAnalyticsValue(entryValue, entryKey),
    ])
  );
}

/**
 * PostHog's before_send hook runs for pageview, pageleave, and replay snapshot
 * events. Recursing through event properties also removes URLs nested inside
 * session-replay payloads rather than protecting only our manual pageview.
 */
export function redactSensitiveAnalyticsCapture<T extends AnalyticsCaptureLike | null>(
  capture: T
): T {
  if (!capture) return capture;
  return {
    ...capture,
    properties: redactSensitiveAnalyticsValue(capture.properties),
    ...(capture.$set === undefined
      ? {}
      : { $set: redactSensitiveAnalyticsValue(capture.$set) }),
    ...(capture.$set_once === undefined
      ? {}
      : { $set_once: redactSensitiveAnalyticsValue(capture.$set_once) }),
  } as T;
}

/**
 * Session replay can optionally capture fetch/XHR details from remote config.
 * Bodies and headers are never needed for product analytics, so remove them
 * universally and scrub secret-bearing request URLs as defense in depth.
 */
export function redactSensitiveNetworkCapture<T extends NetworkCaptureLike>(capture: T): T {
  const safeName = redactSensitiveUrl(capture.name);
  return {
    ...capture,
    name: safeName,
    requestBody: null,
    responseBody: null,
    requestHeaders: undefined,
    responseHeaders: undefined,
  } as T;
}
