export function getSameOriginRedirectPath(
  candidate: string,
  origin: string,
  fallback = "/login",
): string {
  if (!candidate.startsWith("/")) return fallback;

  try {
    const base = new URL(origin);
    const destination = new URL(candidate, base);
    if (destination.origin !== base.origin) return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}
