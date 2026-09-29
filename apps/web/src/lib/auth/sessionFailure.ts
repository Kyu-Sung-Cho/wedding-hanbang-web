import { isAuthApiError, isAuthSessionMissingError } from "@supabase/supabase-js";

/** 인증 장애와 실제로 종료된 세션을 모든 서버 진입점에서 같은 기준으로 나눈다. */
export function isConfirmedSignedOut(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) return true;
  if (!isAuthApiError(error)) return false;
  return error.status === 401 || (
    error.status >= 400 && error.status < 500 && error.status !== 429
    && [
      "bad_jwt", "no_authorization", "session_not_found", "session_expired",
      "refresh_token_not_found", "refresh_token_already_used", "user_not_found", "user_banned",
    ].includes(error.code ?? "")
  );
}
