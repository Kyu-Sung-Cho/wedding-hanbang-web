const ALLOWED_POST_RESET_PATHS = new Set(["/login", "/admin/login"]);

export function getConfiguredSiteOrigin(rawSiteUrl: string | undefined): string | null {
  const raw = rawSiteUrl?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const localDevelopmentOrigin = url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !localDevelopmentOrigin) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function buildPasswordRecoveryLink(
  siteOrigin: string,
  hashedToken: string,
  requestedRedirect?: unknown,
): string | null {
  const canonicalOrigin = getConfiguredSiteOrigin(siteOrigin);
  const token = hashedToken.trim();
  if (!canonicalOrigin || !token || token.length > 2048) return null;

  const url = new URL("/reset-password", canonicalOrigin);
  if (typeof requestedRedirect === "string" && ALLOWED_POST_RESET_PATHS.has(requestedRedirect)) {
    url.searchParams.set("redirect", requestedRedirect);
  }
  // Fragments never reach Vercel/Next access logs. The reset page captures and
  // erases this material synchronously before initializing the auth client.
  url.hash = new URLSearchParams({
    token_hash: token,
    type: "recovery",
  }).toString();
  return url.toString();
}

export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
