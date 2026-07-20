const MAX_AUTHORIZATION_LENGTH = 8 * 1024;
const BEARER_PATTERN = /^Bearer ([A-Za-z0-9._~+\/-]+={0,2})$/i;

export type ParsedAuthorization =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "bearer"; token: string };

/**
 * Parse an Authorization header once for every request trust boundary.
 * Bearer scheme matching is case-insensitive per HTTP, while whitespace and
 * token grammar stay deliberately strict. Any present but malformed value is
 * distinct from an absent header so callers cannot fall back to ambient cookies.
 */
export function parseAuthorizationHeader(value: string | null): ParsedAuthorization {
  if (value === null) return { kind: "absent" };
  if (value.length === 0 || value.length > MAX_AUTHORIZATION_LENGTH) {
    return { kind: "invalid" };
  }
  const match = BEARER_PATTERN.exec(value);
  if (!match) return { kind: "invalid" };
  return { kind: "bearer", token: match[1] };
}
