import { publicApiFetch } from "@/lib/api";
import { isValidTurnstileToken } from "@/lib/turnstile";

export interface MobileSignupInput {
  email: string;
  password: string;
  name: string;
  termsAgreed: boolean;
  privacyAgreed: boolean;
  termsVersion: string;
  privacyVersion: string;
  marketingAgreed: boolean;
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
      ...input,
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
