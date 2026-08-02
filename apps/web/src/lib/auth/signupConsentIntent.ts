import "server-only";

import { randomBytes } from "node:crypto";

export const SIGNUP_CONSENT_INTENT_METADATA_KEY = "signup_consent_intent" as const;
export const SIGNUP_CONSENT_INTENT_RPC = "issue_signup_consent_intent" as const;
export const REVOKE_SIGNUP_CONSENT_INTENT_RPC = "revoke_signup_consent_intent" as const;

/** Creates 256 bits of CSPRNG entropy encoded without padding for user metadata. */
export function createSignupConsentIntentToken(): string {
  return randomBytes(32).toString("base64url");
}
