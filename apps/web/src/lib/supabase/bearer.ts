const MAX_BEARER_TOKEN_LENGTH = 8 * 1024;

/** HTTP authentication schemes are case-insensitive (RFC 9110 section 11.1). */
export function parseBearerAccessToken(value: string | null): string | null {
  if (value === null) return null;
  const match = /^Bearer[\t ]+([^\s,]+)[\t ]*$/i.exec(value);
  const token = match?.[1] ?? "";
  return token.length > 0 && token.length <= MAX_BEARER_TOKEN_LENGTH
    ? token
    : null;
}
