/**
 * Builds a share URL from a browser location without carrying incidental
 * query parameters, fragments, credentials, or a different origin.
 */
export function buildShareablePageUrl(
  value: string,
  expectedOrigin: string,
): string | null {
  try {
    const expected = new URL(expectedOrigin);
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      || parsed.origin !== expected.origin
      || parsed.username !== ""
      || parsed.password !== ""
    ) {
      return null;
    }

    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}
