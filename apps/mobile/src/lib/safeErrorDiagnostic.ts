export type SafeErrorDiagnostic = {
  name: string;
  code: string;
  status: number | null;
};

const SAFE_ERROR_NAMES = new Set([
  "AbortError",
  "AuthApiError",
  "DOMException",
  "Error",
  "FunctionsFetchError",
  "FunctionsHttpError",
  "FunctionsRelayError",
  "PostgrestError",
  "RangeError",
  "RealtimeError",
  "StorageApiError",
  "SyntaxError",
  "TypeError",
]);

const SAFE_ERROR_CODES = new Set([
  "bad_jwt",
  "email_exists",
  "email_not_confirmed",
  "invalid_credentials",
  "over_email_send_rate_limit",
  "over_request_rate_limit",
  "refresh_token_not_found",
  "session_not_found",
  "signup_disabled",
  "user_not_found",
  "weak_password",
]);

function safeName(value: unknown, fallback: string): string {
  return typeof value === "string" && SAFE_ERROR_NAMES.has(value) ? value : fallback;
}

function safeCode(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  if (SAFE_ERROR_CODES.has(value)) return value;
  if (/^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/u.test(value)) return value;
  return "unknown";
}

function safeStatus(value: unknown): number | null {
  const status = typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : null;
}

/** Never serialize provider messages, request data, tokens, or user content. */
export function safeErrorDiagnostic(error: unknown): SafeErrorDiagnostic {
  const record = typeof error === "object" && error !== null
    ? error as Record<string, unknown>
    : {};

  return {
    name: safeName(record.name, error instanceof Error ? "Error" : "UnknownError"),
    code: safeCode(record.code),
    status: safeStatus(record.status ?? record.statusCode),
  };
}
