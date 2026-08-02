const FILTERED_VALUE = "FILTERED";

const AUTH_URL_PARAMETER_NAMES = [
  "access_token",
  "refresh_token",
  "id_token",
  "provider_token",
  "provider_refresh_token",
  "token",
  "token_hash",
  "recovery_token",
  "confirmation_token",
  "email_change_token_current",
  "email_change_token_new",
  "code",
  "auth_code",
  "authorization_code",
  "code_verifier",
  "client_secret",
  "otp",
  "state",
] as const;

const AUTH_CALLBACK_ERROR_PARAMETER_NAMES = [
  "error",
  "error_code",
  "error_description",
  "error_message",
  "error_reason",
  "error_uri",
] as const;

const PRIVATE_URL_PARAMETER_NAMES = [
  ...AUTH_URL_PARAMETER_NAMES,
  ...AUTH_CALLBACK_ERROR_PARAMETER_NAMES,
] as const;

const AUTH_OBJECT_PROPERTY_NAMES = new Set([
  ...AUTH_URL_PARAMETER_NAMES.filter((name) => name !== "code" && name !== "state"),
  "error_description",
  "error_message",
  "error_reason",
  "error_uri",
  "authorization",
  "bank_account",
  "cookie",
  "data",
  "email",
  "email_address",
  "extra",
  "full_name",
  "home_address",
  "ip_address",
  "mobile",
  "mobile_number",
  "password",
  "phone",
  "phone_number",
  "resident_registration_number",
  "set-cookie",
  "x-api-key",
  "session_token",
  "user",
  "username",
]);

const WEDDING_CODE_PARAMETER_NAMES = ["a", "b", "ct"] as const;
const QUERY_CONTAINER_NAMES = new Set([
  "query",
  "query_string",
  "querystring",
  "search",
  "searchparams",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWeddingCodeUrl(value: string): boolean {
  try {
    const pathname = new URL(value, "https://telemetry.invalid").pathname;
    return pathname === "/wedding-code" || pathname.startsWith("/wedding-code/");
  } catch {
    return /(?:^|\s|["'])(?:https?:\/\/[^/\s]+)?\/wedding-code(?:[/?#]|$)/i.test(value);
  }
}

function redactPrivateText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, FILTERED_VALUE)
    .replace(/(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, FILTERED_VALUE)
    .replace(/\b\d{6}-?[1-4]\d{6}\b/g, FILTERED_VALUE)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, FILTERED_VALUE)
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{12,}\b/gi, `Bearer ${FILTERED_VALUE}`)
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{12,}(?:\.[A-Za-z0-9_-]{12,})?\b/g, FILTERED_VALUE)
    .replace(/\b(?:sk-(?:proj-)?|sbp_|sb_secret_|sntrys_)[A-Za-z0-9_-]{16,}\b/g, FILTERED_VALUE);
}

function stripStandaloneUrlDetails(value: string): string {
  const trimmed = value.trim();
  const isAbsoluteHttpUrl = /^https?:\/\//i.test(trimmed);
  const isRootRelativeUrl = trimmed.startsWith("/");
  if ((!isAbsoluteHttpUrl && !isRootRelativeUrl) || /\s/.test(trimmed)) return value;

  try {
    const parsed = new URL(trimmed, "https://telemetry.invalid");
    return isAbsoluteHttpUrl
      ? `${parsed.origin}${parsed.pathname}`
      : parsed.pathname;
  } catch {
    return value;
  }
}

function redactParameters(value: string, names: readonly string[]): string {
  let sanitized = value;

  for (const name of names) {
    const escapedName = escapeRegExp(name);
    const ordinaryParameter = new RegExp(
      `(^|[?&#;])(${escapedName})=([^&#;\\s]*)`,
      "gi",
    );
    sanitized = sanitized.replace(
      ordinaryParameter,
      (_match, prefix: string, parameterName: string) =>
        `${prefix}${parameterName}=${FILTERED_VALUE}`,
    );

    // Sentry fields can contain an already URL-encoded callback URL.
    const encodedParameter = new RegExp(
      `((?:%3[fF]|%26|%23|%3[bB])${escapedName}%3[dD])(.+?)(?=%26|%23|%3[bB]|$)`,
      "gi",
    );
    sanitized = sanitized.replace(
      encodedParameter,
      (_match, prefix: string) => `${prefix}${FILTERED_VALUE}`,
    );
  }

  return sanitized;
}

export interface TelemetryUrlSanitizationOptions {
  redactWeddingCodeAnswers?: boolean;
}

/**
 * Removes reusable auth credentials, one-time auth codes, and private
 * WeddingCode answer payloads from a URL-like telemetry string.
 */
export function sanitizeTelemetryUrl(
  value: string,
  options: TelemetryUrlSanitizationOptions = {},
): string {
  const withoutUrlDetails = stripStandaloneUrlDetails(value);
  const redactWeddingCodeAnswers = options.redactWeddingCodeAnswers
    ?? isWeddingCodeUrl(withoutUrlDetails);
  const withoutAuthSecrets = redactParameters(withoutUrlDetails, PRIVATE_URL_PARAMETER_NAMES);

  const sanitized = redactWeddingCodeAnswers
    ? redactParameters(withoutAuthSecrets, WEDDING_CODE_PARAMETER_NAMES)
    : withoutAuthSecrets;
  return redactPrivateText(sanitized);
}

interface SanitizationContext {
  weddingCode: boolean;
}

function normalizedPropertyName(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replaceAll("-", "_");
}

function isSensitiveObjectProperty(value: string): boolean {
  const normalized = normalizedPropertyName(value);
  return AUTH_OBJECT_PROPERTY_NAMES.has(normalized)
    || AUTH_OBJECT_PROPERTY_NAMES.has(normalized.replaceAll("_", "-"));
}

function isWeddingCodeParameter(value: string): boolean {
  return value === "a" || value === "b" || value === "ct";
}

function sanitizeObject(
  value: object,
  inheritedContext: SanitizationContext,
  seen: WeakSet<object>,
): void {
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (typeof item === "string") {
        value[index] = sanitizeTelemetryUrl(item, {
          redactWeddingCodeAnswers: inheritedContext.weddingCode,
        });
      } else if (typeof item === "object" && item !== null) {
        sanitizeObject(item, inheritedContext, seen);
      }
    });
    return;
  }

  const entries = Object.entries(value);
  const localWeddingCode = inheritedContext.weddingCode
    || entries.some(([, entryValue]) =>
      typeof entryValue === "string" && isWeddingCodeUrl(entryValue));

  for (const [propertyName, propertyValue] of entries) {
    const normalizedName = normalizedPropertyName(propertyName);

    // Query containers are free-text collection surfaces. Dropping the whole
    // value is safer than trying to distinguish product filters from search,
    // callback, or form data after an SDK has serialized it.
    if (QUERY_CONTAINER_NAMES.has(normalizedName)) {
      Reflect.set(value, propertyName, FILTERED_VALUE);
      continue;
    }

    if (
      isSensitiveObjectProperty(propertyName)
      || (localWeddingCode && isWeddingCodeParameter(normalizedName))
    ) {
      Reflect.set(value, propertyName, FILTERED_VALUE);
      continue;
    }

    if (typeof propertyValue === "string") {
      Reflect.set(
        value,
        propertyName,
        sanitizeTelemetryUrl(propertyValue, {
          redactWeddingCodeAnswers: localWeddingCode,
        }),
      );
      continue;
    }

    if (typeof propertyValue === "object" && propertyValue !== null) {
      sanitizeObject(
        propertyValue,
        { weddingCode: localWeddingCode },
        seen,
      );
    }
  }
}

/**
 * Sanitizes a telemetry payload in place so SDK-specific event types retain
 * their exact TypeScript shape without copying credentials into a second object.
 */
export function sanitizeTelemetryObject<T extends object>(payload: T): T {
  sanitizeObject(
    payload,
    { weddingCode: false },
    new WeakSet<object>(),
  );
  return payload;
}

/**
 * Sentry exception messages can be built from provider responses or user input.
 * Keep the exception type and stack frames for triage, but never upload the
 * free-form message itself.
 */
export function sanitizeSentryTelemetryEvent<T extends object>(payload: T): T {
  sanitizeTelemetryObject(payload);
  const event = payload as Record<string, unknown>;

  if (typeof event.message === "string") event.message = FILTERED_VALUE;

  const logentry = event.logentry;
  if (typeof logentry === "object" && logentry !== null) {
    const record = logentry as Record<string, unknown>;
    if (typeof record.message === "string") record.message = FILTERED_VALUE;
    if ("params" in record) record.params = FILTERED_VALUE;
  }

  const exception = event.exception;
  if (typeof exception === "object" && exception !== null) {
    const values = (exception as Record<string, unknown>).values;
    if (Array.isArray(values)) {
      for (const value of values) {
        if (typeof value !== "object" || value === null) continue;
        const record = value as Record<string, unknown>;
        if (typeof record.value === "string") record.value = FILTERED_VALUE;
      }
    }
  }

  return payload;
}

/** Console/UI breadcrumbs may stringify arbitrary request or form payloads. */
export function sanitizeSentryTelemetryBreadcrumb<T extends object>(payload: T): T {
  sanitizeTelemetryObject(payload);
  const breadcrumb = payload as Record<string, unknown>;
  if (typeof breadcrumb.message === "string") breadcrumb.message = FILTERED_VALUE;
  return payload;
}

/** Transaction spans can contain SQL, request bodies, or user-authored labels. */
export function sanitizeSentryTelemetryTransaction<T extends object>(payload: T): T {
  sanitizeTelemetryObject(payload);
  const transaction = payload as Record<string, unknown>;

  if (typeof transaction.transaction === "string") {
    const queryIndex = transaction.transaction.search(/[?#]/u);
    const withoutParameters = queryIndex >= 0
      ? transaction.transaction.slice(0, queryIndex)
      : transaction.transaction;
    transaction.transaction = redactPrivateText(withoutParameters);
  }

  const spans = transaction.spans;
  if (Array.isArray(spans)) {
    for (const span of spans) {
      if (typeof span !== "object" || span === null) continue;
      const record = span as Record<string, unknown>;
      if (typeof record.description === "string") record.description = FILTERED_VALUE;
      if ("data" in record) record.data = FILTERED_VALUE;
    }
  }

  return payload;
}
