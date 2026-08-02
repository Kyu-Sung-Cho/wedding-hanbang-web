import { describe, expect, it } from "vitest";
import {
  createSignupConsentIntentToken,
  REVOKE_SIGNUP_CONSENT_INTENT_RPC,
  SIGNUP_CONSENT_INTENT_METADATA_KEY,
  SIGNUP_CONSENT_INTENT_RPC,
} from "./signupConsentIntent";

describe("signup consent intent token", () => {
  it("uses a fixed metadata/RPC contract and 256-bit base64url tokens", () => {
    expect(SIGNUP_CONSENT_INTENT_METADATA_KEY).toBe("signup_consent_intent");
    expect(SIGNUP_CONSENT_INTENT_RPC).toBe("issue_signup_consent_intent");
    expect(REVOKE_SIGNUP_CONSENT_INTENT_RPC).toBe("revoke_signup_consent_intent");

    const tokens = new Set(Array.from({ length: 64 }, () =>
      createSignupConsentIntentToken()));
    expect(tokens.size).toBe(64);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });
});
