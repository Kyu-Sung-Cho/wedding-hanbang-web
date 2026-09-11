import { getSignupConsentAccess, type SignupConsentUser } from "@hanbang/shared";

/** 배포 시 확정한 전환 시각. 코드 작성 시각을 운영 전환으로 가정하지 않는다. */
export function getWebSignupConsentAccess(user: SignupConsentUser) {
  return getSignupConsentAccess(user, process.env.SIGNUP_CONSENT_LEGACY_BEFORE);
}

export function hasWebSignupConsentAccess(user: SignupConsentUser): boolean {
  const access = getWebSignupConsentAccess(user);
  if (access === "configuration_error") throw new Error("SIGNUP_CONSENT_CONFIGURATION_REQUIRED");
  return access === "server_verified" || access === "legacy_unverified";
}
