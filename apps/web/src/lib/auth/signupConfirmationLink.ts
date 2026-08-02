import { getConfiguredSiteOrigin } from "@/lib/auth/passwordRecoveryLink";

const PRODUCTION_SITE_ORIGINS = new Set([
  "https://hanbang.ai",
  "https://www.hanbang.ai",
]);
const SIGNUP_VERIFY_PATH = "/auth/v1/verify";
const SIGNUP_LINK_KEYS = new Set(["type", "token", "redirect_to"]);
const SAFE_TOKEN = /^[A-Za-z0-9._~-]{8,2048}$/u;

export function getSignupSiteOrigin(
  rawSiteUrl: string | undefined,
  production: boolean,
): string | null {
  const origin = getConfiguredSiteOrigin(rawSiteUrl);
  if (!origin) return null;
  if (production && !PRODUCTION_SITE_ORIGINS.has(origin)) return null;
  return origin;
}

function getSupabaseOrigin(rawSupabaseUrl: string | undefined): string | null {
  const raw = rawSupabaseUrl?.trim();
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

/**
 * Accept only the documented Supabase signup verification URL shape generated
 * for this exact project and callback. The provider URL still needs HTML
 * escaping at the final rendering boundary.
 */
export function normalizeSignupConfirmationLink(
  rawActionLink: unknown,
  rawSupabaseUrl: string | undefined,
  expectedRedirectUrl: string,
): string | null {
  if (typeof rawActionLink !== "string" || rawActionLink.length > 4096) return null;
  const supabaseOrigin = getSupabaseOrigin(rawSupabaseUrl);
  if (!supabaseOrigin) return null;

  try {
    const url = new URL(rawActionLink);
    if (
      url.origin !== supabaseOrigin
      || url.pathname !== SIGNUP_VERIFY_PATH
      || url.username
      || url.password
      || url.hash
    ) {
      return null;
    }

    const keys = [...url.searchParams.keys()];
    if (
      keys.length !== SIGNUP_LINK_KEYS.size
      || new Set(keys).size !== keys.length
      || keys.some((key) => !SIGNUP_LINK_KEYS.has(key))
      || url.searchParams.get("type") !== "signup"
      || url.searchParams.get("redirect_to") !== expectedRedirectUrl
    ) {
      return null;
    }

    const token = url.searchParams.get("token") ?? "";
    if (!SAFE_TOKEN.test(token)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
