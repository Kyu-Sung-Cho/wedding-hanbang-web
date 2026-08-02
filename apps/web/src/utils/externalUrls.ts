const ENCODED_CONTROL = /%(?:25)*(?:00|0a|0d)/iu;

function containsRawControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function hostMatches(hostname: string, allowedDomains: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return allowedDomains.some((rawDomain) => {
    const domain = rawDomain.trim().toLowerCase();
    return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
  });
}

export function normalizeExternalHttpsUrl(
  value: unknown,
  allowedDomains: readonly string[],
): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (
    !raw
    || raw.length > 2_048
    || containsRawControl(raw)
    || ENCODED_CONTROL.test(raw)
  ) {
    return null;
  }

  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || !hostMatches(url.hostname, allowedDomains)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
