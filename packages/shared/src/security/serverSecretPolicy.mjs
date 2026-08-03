export const SERVER_SECRET_MIN_LENGTH = 32;
export const SERVER_SECRET_MAX_LENGTH = 512;

const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9._~+\/-]+={0,2}$/;
const PLACEHOLDER_PATTERN =
  /(?:placeholder|example|test-only|replace-with|not-a-real)/i;
const MIN_DISTINCT_CHARACTERS = 12;
const IDENTICAL_RUN_PATTERN = /(.)\1{7,}/;

function isRepeatedPattern(value) {
  for (let unitLength = 1; unitLength <= value.length / 2; unitLength += 1) {
    if (value.length % unitLength !== 0) continue;
    const unit = value.slice(0, unitLength);
    if (unit.repeat(value.length / unitLength) === value) return true;
  }
  return false;
}

/**
 * Canonical contract for machine-to-machine authentication secrets.
 *
 * Generate a value with a cryptographic RNG and prefer unpadded base64url (or
 * hexadecimal, which is a subset of this grammar). The accepted character set
 * matches the runtime Bearer parser so existing RFC 6750-style credentials are
 * not rejected only at deployment time.
 */
export function isValidServerSecret(value) {
  if (
    typeof value !== "string"
    || value.length < SERVER_SECRET_MIN_LENGTH
    || value.length > SERVER_SECRET_MAX_LENGTH
    || !BEARER_TOKEN_PATTERN.test(value)
    || PLACEHOLDER_PATTERN.test(value)
  ) {
    return false;
  }

  if (new Set(value).size < MIN_DISTINCT_CHARACTERS) return false;
  if (IDENTICAL_RUN_PATTERN.test(value)) return false;
  return !isRepeatedPattern(value);
}

/**
 * Resolve a canonical secret and a temporary legacy alias without weakening
 * either boundary. Any invalid configured value or conflicting pair fails
 * closed. An empty string is the only failure result so callers cannot
 * accidentally fall back after detecting an invalid configuration.
 */
export function resolveAliasedServerSecret(canonicalSecret, legacySecret) {
  const canonical = canonicalSecret ?? "";
  const legacy = legacySecret ?? "";

  if (
    (canonical.length > 0 && !isValidServerSecret(canonical))
    || (legacy.length > 0 && !isValidServerSecret(legacy))
    || (canonical.length > 0 && legacy.length > 0 && canonical !== legacy)
  ) {
    return "";
  }

  return canonical || legacy;
}
