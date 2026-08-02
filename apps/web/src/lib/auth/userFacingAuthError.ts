const INVALID_CREDENTIALS_MESSAGE = "이메일 또는 비밀번호가 올바르지 않습니다.";
const EMAIL_NOT_CONFIRMED_MESSAGE = "이메일 인증이 완료되지 않았습니다.";
const RATE_LIMITED_MESSAGE = "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";

/**
 * Maps only reviewed Auth failures to fixed copy. Provider messages can include
 * account identifiers or internal diagnostics, so an unknown value must never
 * be rendered verbatim.
 */
export function userFacingSignInError(
  providerMessage: unknown,
  fallback = "로그인에 실패했습니다. 잠시 후 다시 시도해주세요.",
): string {
  if (providerMessage === "Invalid login credentials") {
    return INVALID_CREDENTIALS_MESSAGE;
  }
  if (providerMessage === "Email not confirmed") {
    return EMAIL_NOT_CONFIRMED_MESSAGE;
  }
  if (
    typeof providerMessage === "string"
    && /^(?:Too many requests|Request rate limit reached)/i.test(providerMessage)
  ) {
    return RATE_LIMITED_MESSAGE;
  }
  return fallback;
}
