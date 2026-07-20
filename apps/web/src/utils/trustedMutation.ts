import { parseAuthorizationHeader } from "@/utils/bearerAuthorization";

/**
 * Cookie-authenticated browser mutations require same-origin request metadata.
 * Native clients may omit browser fetch metadata, but their explicit Bearer
 * credential is non-ambient and is still cryptographically validated by the
 * route's authenticated Supabase client before any owner-scoped operation.
 */
export function isTrustedMutationRequest(request: Request): boolean {
  const authorization = parseAuthorizationHeader(request.headers.get("authorization"));
  if (authorization.kind === "bearer") return true;
  if (authorization.kind === "invalid") return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }

  return fetchSite === "same-origin";
}
