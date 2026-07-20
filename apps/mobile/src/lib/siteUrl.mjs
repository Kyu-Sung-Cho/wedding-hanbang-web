/* global URL */

const DEVELOPMENT_SITE_ORIGIN = "http://localhost:3000";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isLoopbackHostname(hostname) {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "[::1]";
}

export function resolveMobileSiteOrigin(
  configuredSiteUrl,
  { isDevelopment },
) {
  const configured = configuredSiteUrl?.trim();
  if (!configured && !isDevelopment) {
    throw new Error("EXPO_PUBLIC_SITE_URL_REQUIRED");
  }

  try {
    const parsed = new URL(configured || DEVELOPMENT_SITE_ORIGIN);
    const isHttps = parsed.protocol === "https:";
    const isDevelopmentHttp = isDevelopment
      && parsed.protocol === "http:"
      && isLoopbackHostname(parsed.hostname.toLowerCase());
    const isOriginOnly = parsed.pathname === "/"
      && parsed.search === ""
      && parsed.hash === "";

    if (
      (!isHttps && !isDevelopmentHttp)
      || !isOriginOnly
      || parsed.username !== ""
      || parsed.password !== ""
    ) {
      throw new Error("EXPO_PUBLIC_SITE_URL_INVALID");
    }

    return parsed.origin;
  } catch (error) {
    if (error instanceof Error && error.message === "EXPO_PUBLIC_SITE_URL_INVALID") {
      throw error;
    }
    throw new Error("EXPO_PUBLIC_SITE_URL_INVALID");
  }
}

export function buildMobileSiteUrl(pathname, siteOrigin) {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    throw new Error("MOBILE_SITE_PATH_INVALID");
  }
  const url = new URL(pathname, siteOrigin);
  if (url.origin !== siteOrigin) {
    throw new Error("MOBILE_SITE_PATH_INVALID");
  }
  return url.toString();
}

export function buildLegacyVendorDetailUrl(vendorId, siteOrigin) {
  if (typeof vendorId !== "string" || !UUID_PATTERN.test(vendorId)) return null;
  return buildMobileSiteUrl(`/price/vendor-id/${vendorId.toLowerCase()}`, siteOrigin);
}

export function normalizeMobileSiteUrl(value, siteOrigin) {
  if (!value || value.length > 2048) return null;

  try {
    const parsed = new URL(value);
    if (
      parsed.origin !== siteOrigin
      || parsed.username !== ""
      || parsed.password !== ""
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
