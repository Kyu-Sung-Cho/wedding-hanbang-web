import "server-only";

import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "./policyVersions";

export type TrustedSignupConsentMetadata = {
  terms_agreed_at: string;
  terms_version: typeof CURRENT_TERMS_VERSION;
  privacy_agreed_at: string;
  privacy_version: typeof CURRENT_PRIVACY_VERSION;
  marketing_agreed: boolean;
  marketing_agreed_at?: string;
};

/**
 * Builds service-role-only auth app metadata from the server clock. Caller
 * timestamps and policy versions are intentionally not accepted as input.
 */
export function createTrustedSignupConsentMetadata(
  marketingAgreed: boolean,
): TrustedSignupConsentMetadata {
  const acceptedAt = new Date().toISOString();

  return {
    terms_agreed_at: acceptedAt,
    terms_version: CURRENT_TERMS_VERSION,
    privacy_agreed_at: acceptedAt,
    privacy_version: CURRENT_PRIVACY_VERSION,
    marketing_agreed: marketingAgreed,
    ...(marketingAgreed ? { marketing_agreed_at: acceptedAt } : {}),
  };
}
