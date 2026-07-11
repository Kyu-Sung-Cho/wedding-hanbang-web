const AUTH_RETURN_BASE = "https://hanbang.invalid";
const MAX_AUTH_RETURN_PATH_LENGTH = 6_000;

export function sanitizeAuthReturnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (
    !candidate ||
    candidate.length > MAX_AUTH_RETURN_PATH_LENGTH ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /[\u0000-\u001F\u007F]/.test(candidate)
  ) {
    return null;
  }

  try {
    const parsed = new URL(candidate, AUTH_RETURN_BASE);
    if (parsed.origin !== AUTH_RETURN_BASE) return null;
    if (parsed.pathname !== "/wedding" && !parsed.pathname.startsWith("/wedding/")) return null;
    if (parsed.pathname === "/wedding/onboarding") return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function pathWithAuthReturn(path: string, returnPath: string | null): string {
  if (!returnPath) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}next=${encodeURIComponent(returnPath)}`;
}
