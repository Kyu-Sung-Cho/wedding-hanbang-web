const INSTALL_KEY = Symbol.for("hanbang.server-console-privacy.installed");

// Only exact, source-controlled event names may survive the console boundary.
// A shape-only regex would turn uppercase fragments from exception messages or
// request bodies into accidental log exfiltration channels.
const SAFE_EVENT_CODES = new Set([
  "ADMIN_AUTH_ADMIN_INVENTORY_LOOKUP_FAILED",
  "ADMIN_AUTH_COMPENSATION_FAILED",
  "ADMIN_AUTH_PROFILE_LOOKUP_FAILED",
  "ADMIN_AUTH_PROFILE_WRITE_FAILED",
  "ADMIN_AUTH_UNEXPECTED_FAILURE",
  "ADMIN_AUTH_USER_CREATE_FAILED",
  "ADMIN_REGISTRATIONS_EXPIRED_PURGE_FAILED",
  "ADMIN_REGISTRATIONS_INVALID_CURSOR",
  "ADMIN_REGISTRATIONS_QUERY_FAILED",
  "ADMIN_REGISTRATIONS_SAFE_CAP_EXCEEDED",
  "ADMIN_REGISTRATIONS_UNEXPECTED_FAILURE",
  "AI_LOG_INSERT_FAILED",
  "AI_LOG_UNEXPECTED_FAILURE",
  "AUTH_PROFILE_ENSURE_FAILED",
  "AUTH_PROFILE_LOOKUP_AFTER_ENSURE_FAILED",
  "AUTH_PROFILE_LOOKUP_FAILED",
  "AUTH_RECOVERY_EMAIL_DELIVERY_FAILED",
  "AUTH_RECOVERY_LINK_GENERATION_FAILED",
  "AUTH_RECOVERY_LINK_MISSING",
  "AUTH_RECOVERY_UNEXPECTED_FAILURE",
  "AUTH_SIGNUP_COMPENSATION_FAILED",
  "AUTH_SIGNUP_COMPENSATION_IMPOSSIBLE",
  "AUTH_SIGNUP_DELIVERY_FAILED_COMPENSATED",
  "AUTH_SIGNUP_EMAIL_DELIVERY_FAILED",
  "AUTH_SIGNUP_LINK_GENERATION_FAILED",
  "RATE_LIMIT_PERSISTENCE_CONFIGURATION_UNAVAILABLE",
  "RATE_LIMIT_PERSISTENCE_EXCEPTION",
  "RATE_LIMIT_PERSISTENCE_FAILED",
  "RATE_LIMIT_STRICT_CONFIGURATION_UNAVAILABLE",
  "RATE_LIMIT_STRICT_PERSISTENCE_EXCEPTION",
  "RATE_LIMIT_STRICT_PERSISTENCE_FAILED",
  "RESEARCH_COHORT_EXPIRED_PURGE_FAILED",
  "RESEARCH_COHORT_CONCURRENT_LOOKUP_FAILED",
  "RESEARCH_COHORT_INSERT_FAILED",
  "RESEARCH_COHORT_INSERT_ID_MISSING",
  "RESEARCH_COHORT_LOOKUP_FAILED",
  "RESEARCH_COHORT_RECEIPT_EMAIL_PENDING",
  "RESEARCH_COHORT_RECEIPT_STATUS_UPDATE_FAILED",
  "RESEARCH_COHORT_UNEXPECTED_FAILURE",
  "RESEARCH_EMAIL_VERIFICATION_LOOKUP_FAILED",
  "RESEARCH_EMAIL_VERIFICATION_NOT_CONFIGURED",
  "RESEARCH_EMAIL_VERIFICATION_UNEXPECTED_FAILURE",
  "RESEARCH_EMAIL_VERIFICATION_UPDATE_FAILED",
  "VENDOR_APPROVAL_EMAIL_SEND_FAILED",
  "VENDOR_REJECTION_EMAIL_SEND_FAILED",
]);

const COMPENSATION_EVENTS = new Set([
  "AUTH_SIGNUP_COMPENSATION_FAILED",
  "AUTH_SIGNUP_COMPENSATION_IMPOSSIBLE",
  "AUTH_SIGNUP_DELIVERY_FAILED_COMPENSATED",
]);

const SAFE_ERROR_NAMES = new Set([
  "AbortError",
  "AuthApiError",
  "AuthError",
  "DOMException",
  "Error",
  "FetchError",
  "PostgrestError",
  "RangeError",
  "SyntaxError",
  "TypeError",
]);

const SAFE_DIAGNOSTIC_CODES = new Set([
  "email_exists",
  "invalid_credentials",
  "over_request_rate_limit",
  "unexpected_failure",
  "user_not_found",
  "validation_failed",
]);

const SAFE_SQLSTATE_CLASSES = new Set([
  "22", "23", "28", "40", "42", "53", "54", "55", "57", "58", "P0", "XX",
]);

const SAFE_REASONS = new Set(["email_delivery_failed", "missing_action_link"]);
const SAFE_SEVERITIES = new Set(["critical", "error"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function diagnosticCode(values: readonly unknown[]): string {
  const candidate = values.map(asRecord).find((value) => value !== null);
  if (!candidate) return "no_structured_code";

  const parts = ["structured_failure"];
  if (typeof candidate.name === "string") {
    parts.push(SAFE_ERROR_NAMES.has(candidate.name)
      ? `name_${candidate.name}`
      : "name_other");
  }
  if (
    typeof candidate.status === "number"
    && Number.isSafeInteger(candidate.status)
    && candidate.status >= 100
    && candidate.status <= 599
  ) {
    parts.push(`status_${candidate.status}`);
  }
  if (typeof candidate.code === "string") {
    if (SAFE_DIAGNOSTIC_CODES.has(candidate.code)) {
      parts.push(`code_${candidate.code}`);
    } else if (/^[0-9A-Z]{5}$/.test(candidate.code)) {
      const sqlStateClass = candidate.code.slice(0, 2);
      parts.push(SAFE_SQLSTATE_CLASSES.has(sqlStateClass)
        ? `code_sqlstate_class_${sqlStateClass}`
        : "code_other");
    } else {
      parts.push("code_other");
    }
  }
  if (typeof candidate.type === "string") parts.push("type_present");

  return parts.length === 1 ? "no_structured_code" : parts.join(":");
}

function stableEventCode(values: readonly unknown[]): string {
  const first = values[0];
  return typeof first === "string" && SAFE_EVENT_CODES.has(first)
    ? first
    : "SERVER_DIAGNOSTIC";
}

function compensationMetadata(
  eventCode: string,
  values: readonly unknown[],
): string[] {
  if (!COMPENSATION_EVENTS.has(eventCode)) return [];
  const payload = asRecord(values[1]);
  if (!payload) return [];

  const metadata: string[] = [];
  if (typeof payload.incidentId === "string" && UUID.test(payload.incidentId)) {
    metadata.push(`incident_id:${payload.incidentId.toLowerCase()}`);
  }
  // The user id is necessary to remediate an orphan only when compensation
  // itself failed. Successful/ impossible events do not retain it.
  if (
    eventCode === "AUTH_SIGNUP_COMPENSATION_FAILED"
    && typeof payload.userId === "string"
    && UUID.test(payload.userId)
  ) {
    metadata.push(`user_id:${payload.userId.toLowerCase()}`);
  }
  if (typeof payload.reason === "string" && SAFE_REASONS.has(payload.reason)) {
    metadata.push(`reason:${payload.reason}`);
  }
  if (typeof payload.severity === "string" && SAFE_SEVERITIES.has(payload.severity)) {
    metadata.push(`severity:${payload.severity}`);
  }
  return metadata;
}

export function sanitizeServerConsoleArguments(
  level: "error" | "warn",
  values: readonly unknown[],
): readonly string[] {
  const eventCode = stableEventCode(values);
  return [
    level === "error" ? "SERVER_ERROR" : "SERVER_WARNING",
    eventCode,
    diagnosticCode(values.slice(1)),
    ...compensationMetadata(eventCode, values),
  ];
}

export function installServerConsolePrivacyBoundary(): void {
  const globalRecord = globalThis as unknown as Record<symbol, unknown>;
  if (globalRecord[INSTALL_KEY] === true) return;
  globalRecord[INSTALL_KEY] = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  console.error = (...values: unknown[]) => {
    originalError(...sanitizeServerConsoleArguments("error", values));
  };
  console.warn = (...values: unknown[]) => {
    originalWarn(...sanitizeServerConsoleArguments("warn", values));
  };
}
