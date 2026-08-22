import { buildSignupConsentSubmission, type SignupConsentState } from "@hanbang/shared";

import { publicApiFetch } from "@/lib/api";
import { isValidTurnstileToken } from "@/lib/turnstile";

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

function requireTurnstileToken(token: unknown): string {
  if (!isValidTurnstileToken(token)) {
    throw new Error("사람인지 확인을 먼저 완료해주세요.");
  }
  return token;
}

export async function requestMobileSignup(
  input: MobileSignupInput,
  turnstileToken: unknown,
): Promise<Response> {
  const verifiedToken = requireTurnstileToken(turnstileToken);
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
  const verifiedToken = requireTurnstileToken(turnstileToken);
  return publicApiFetch("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({
      email,
      turnstileToken: verifiedToken,
    }),
  });
}
