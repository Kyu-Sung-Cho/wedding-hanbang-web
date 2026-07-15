import { describe, expect, it } from "vitest";
import {
  VERIFIED_PARTNER_EXCLUDED_CONTEXT_POLICY,
  hasVerifiedPartnerExcludedProvenance,
} from "@/lib/ai/derivedMemoryPrivacy";

describe("Amora derived-memory privacy", () => {
  it("accepts only records that explicitly prove partner-only messages were excluded", () => {
    expect(hasVerifiedPartnerExcludedProvenance({
      ai_context_policy: VERIFIED_PARTNER_EXCLUDED_CONTEXT_POLICY,
      partner_messages_excluded: true,
    })).toBe(true);

    expect(hasVerifiedPartnerExcludedProvenance({})).toBe(false);
    expect(hasVerifiedPartnerExcludedProvenance({
      ai_context_policy: VERIFIED_PARTNER_EXCLUDED_CONTEXT_POLICY,
    })).toBe(false);
    expect(hasVerifiedPartnerExcludedProvenance({
      ai_context_policy: "legacy_visibility_only",
      partner_messages_excluded: true,
    })).toBe(false);
  });
});
