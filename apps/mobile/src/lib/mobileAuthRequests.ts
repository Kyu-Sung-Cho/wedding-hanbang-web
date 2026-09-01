import { buildSignupConsentSubmission, type SignupConsentState } from "@hanbang/shared";

import { publicApiFetch } from "@/lib/api";
import { isValidTurnstileToken, turnstileTokenIsRequired } from "@/lib/turnstile";

export interface MobileSignupInput {
  email: string;
  password: string;
  name: string;
  /**
   * 화면에서 받은 동의. 예전에는 marketingAgreed 만 보내서, 필수 동의를
   * 받아 놓고도 서버에 기록이 남지 않았다.
   */
  consent: SignupConsentState;
}

/**
 * 서버와 같은 규칙으로 토큰을 검사한다.
 *
 * 사이트 키가 발급돼 있으면 유효한 토큰이 반드시 있어야 한다 — 그때 토큰 없이
 * 보내면 서버가 어차피 400 으로 막고, 여기서 먼저 막는 편이 사용자에게 낫다.
 *
 * 미발급이면 서버가 IP·이메일 속도 제한으로만 방어하며 토큰을 보지 않는다.
 * 그 상태에서 앱만 요구하면 앱 사용자만 가입을 못 한다.
 */
function turnstileTokenForRequest(token: unknown): string | undefined {
  if (!turnstileTokenIsRequired(process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY?.trim())) {
    // 발급 전에는 토큰 자체를 만들 수 없다. 서버도 이 경우 토큰을 보지 않는다.
    return isValidTurnstileToken(token) ? token : undefined;
  }
  if (!isValidTurnstileToken(token)) {
    throw new Error("사람인지 확인을 먼저 완료해주세요.");
  }
  return token;
}

export async function requestMobileSignup(
  input: MobileSignupInput,
  turnstileToken: unknown,
): Promise<Response> {
  const verifiedToken = turnstileTokenForRequest(turnstileToken);
  return publicApiFetch("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      name: input.name,
      ...buildSignupConsentSubmission(input.consent),
      turnstileToken: verifiedToken,
    }),
  });
}

export async function requestMobilePasswordReset(
  email: string,
  turnstileToken: unknown,
): Promise<Response> {
  const verifiedToken = turnstileTokenForRequest(turnstileToken);
  return publicApiFetch("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({
      email,
      turnstileToken: verifiedToken,
    }),
  });
}
