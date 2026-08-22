const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;
const ENCODED_UNSAFE_PATH_BYTE = /%(?:25)*(?:0[0-9a-f]|1[0-9a-f]|7f|2f|5c)/i;
const AUTH_RETURN_BLOCKED_PATHS = new Set([
  "/api/auth/callback",
  "/login",
  "/wedding/onboarding",
]);
const AUTH_RETURN_BLOCKED_PREFIXES = [
  "/_next",
  "/admin",
  "/api",
  "/auth",
  "/demo/login",
  "/login",
];

function normalizeSameOriginPath(candidate: string, origin: string): string | null {
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
  if (CONTROL_OR_BACKSLASH.test(candidate)) return null;

  const rawPath = candidate.split(/[?#]/, 1)[0] ?? "";
  if (ENCODED_UNSAFE_PATH_BYTE.test(rawPath)) return null;

  try {
    const base = new URL(origin);
    const destination = new URL(candidate, base);
    if (destination.origin !== base.origin) return null;
    if (!destination.pathname.startsWith("/") || destination.pathname.startsWith("//")) {
      return null;
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return null;
  }
}

export function getOptionalSameOriginRedirectPath(
  candidate: string | null | undefined,
  origin: string,
): string | null {
  return normalizeSameOriginPath(candidate ?? "", origin);
}

export function getSameOriginRedirectPath(
  candidate: string,
  origin: string,
  fallback = "/login",
): string {
  return getOptionalSameOriginRedirectPath(candidate, origin)
    ?? normalizeSameOriginPath(fallback, origin)
    ?? "/login";
}

/**
 * 로그인 이후 되돌아갈 수 있는 경로만 남긴다 — 다른 출처, 인증 화면 자체,
 * API 경로는 버린다. 메일 링크를 만들 때도 이 검사를 통과한 값만 싣는다
 * (`api/auth/signup`). 검사를 건너뛰면 우리가 보낸 메일이 사용자를 아무 데로나
 * 데려가는 링크가 된다.
 */
export function getRequestedAuthRedirectPath(search: string, origin: string): string | null {
  const requested = getOptionalSameOriginRedirectPath(
    new URLSearchParams(search).get("redirect"),
    origin,
  );
  if (!requested) return null;

  const pathname = new URL(requested, origin).pathname.replace(/\/+$/, "") || "/";
  const blockedPrefix = AUTH_RETURN_BLOCKED_PREFIXES.some((prefix) => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  ));
  return AUTH_RETURN_BLOCKED_PATHS.has(pathname) || blockedPrefix ? null : requested;
}

export function getAuthRedirectPath(search: string, origin: string): string {
  return getRequestedAuthRedirectPath(search, origin) ?? "/wedding/lounge";
}

export function buildOnboardingRedirectPath(search: string, origin: string): string {
  const requested = getRequestedAuthRedirectPath(search, origin);
  if (!requested) return "/wedding/onboarding";
  return `/wedding/onboarding?${new URLSearchParams({ redirect: requested })}`;
}

export function getPostLoginRedirectPath(
  search: string,
  origin: string,
  onboardingCompleted: boolean,
): string {
  return onboardingCompleted
    ? getAuthRedirectPath(search, origin)
    : buildOnboardingRedirectPath(search, origin);
}

export function buildOAuthCallbackUrl(search: string, origin: string): string {
  const callback = new URL("/api/auth/callback", origin);
  const safePath = getRequestedAuthRedirectPath(search, origin);
  if (safePath) callback.searchParams.set("redirect", safePath);
  return callback.toString();
}
