/**
 * Routes that must not initialize product analytics or UTM persistence.
 * Keep this list narrow: these pages make an explicit zero-I/O research promise.
 */
const ANALYTICS_SUPPRESSED_PATH_PREFIXES = ["/internal/wedding-code-research"] as const;

export function isAnalyticsSuppressedPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return ANALYTICS_SUPPRESSED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
