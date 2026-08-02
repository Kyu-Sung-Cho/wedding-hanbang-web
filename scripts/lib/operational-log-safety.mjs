const OPERATIONAL_CODE = /^[A-Z][A-Z0-9_]{2,95}$/;

const SECRET_ASSIGNMENT = /\b(?:authorization|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const SECRET_VALUE = /\b(?:Bearer\s+\S+|(?:sk-(?:ant-)?|sb_(?:secret|publishable)_|github_pat_|gh[pousr]_|xox[bap]-|re_)[A-Za-z0-9._-]{6,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?)\b/giu;
const URL = /https?:\/\/[^\s"'<>]+/giu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const PROJECT_REF = /\b[a-z0-9]{20}\b/gu;
const LONG_DIGEST = /\b[0-9a-f]{40,128}\b/giu;
const WINDOWS_PATH = /(?:[A-Za-z]:\\|\\\\)[^\s,;"']+/gu;
const POSIX_PRIVATE_PATH = /\/(?:Users|home|tmp|var|private|mnt|workspace)\/[^\s,;"']+/gu;

export function trustedOperationalErrorCode(error, ExpectedError, fallback) {
  if (!(error instanceof ExpectedError)) return fallback;
  return typeof error.code === "string" && OPERATIONAL_CODE.test(error.code)
    ? error.code
    : fallback;
}

export function allowlistedOperationalStatus(value, allowed, fallback = "unexpected_status") {
  return typeof value === "string" && allowed.has(value) ? value : fallback;
}

export function sanitizeOperationalDiagnostic(value) {
  if (typeof value !== "string") return "operational validation failed";
  const sanitized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .replace(/[\r\n]+/gu, " ")
    .replace(SECRET_VALUE, "[secret redacted]")
    .replace(SECRET_ASSIGNMENT, "[secret-field redacted]")
    .replace(URL, "[url redacted]")
    .replace(EMAIL, "[email redacted]")
    .replace(UUID, "[identifier redacted]")
    .replace(PROJECT_REF, "[project-ref redacted]")
    .replace(LONG_DIGEST, "[digest redacted]")
    .replace(WINDOWS_PATH, "[path redacted]")
    .replace(POSIX_PRIVATE_PATH, "[path redacted]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 320);
  return sanitized || "operational validation failed";
}

export function operationalFailureLine(prefix, error, ExpectedError, fallback) {
  const code = trustedOperationalErrorCode(error, ExpectedError, fallback);
  return `${prefix} [${code}]\n`;
}
