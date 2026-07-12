import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildResearchEmailVerificationUrl,
  createResearchEmailVerificationToken,
  hasResearchEmailVerificationConfig,
  RESEARCH_EMAIL_VERIFICATION_TTL_SECONDS,
  verifyResearchEmailVerificationToken,
} from "@/lib/researchEmailVerification";

const APPLICATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const COHORT_CODE = "research-2026-h2";
const NOW = Date.UTC(2026, 6, 12, 3, 0, 0);
const STRONG_SECRET = "R7vY0M5sK8qN2bF9xW4cL6jH1pT3dG5zA9uE";

function signArbitraryPayload(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", STRONG_SECRET)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

describe("research email verification token", () => {
  beforeEach(() => {
    vi.stubEnv("RESEARCH_EMAIL_VERIFICATION_SECRET", STRONG_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a signed application and cohort without embedding the email", () => {
    expect(hasResearchEmailVerificationConfig()).toBe(true);
    const token = createResearchEmailVerificationToken(
      { applicationId: APPLICATION_ID, cohortCode: COHORT_CODE },
      NOW
    );

    expect(token).not.toBeNull();
    expect(token).not.toContain("@");
    expect(verifyResearchEmailVerificationToken(token, NOW)).toEqual({
      ok: true,
      claims: { applicationId: APPLICATION_ID, cohortCode: COHORT_CODE },
    });
  });

  it("rejects a token whose signature was changed", () => {
    const token = createResearchEmailVerificationToken(
      { applicationId: APPLICATION_ID, cohortCode: COHORT_CODE },
      NOW
    )!;
    const replacement = token.endsWith("A") ? "B" : "A";
    const tampered = `${token.slice(0, -1)}${replacement}`;

    expect(verifyResearchEmailVerificationToken(tampered, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects alternate, non-canonical encodings of the same signature", () => {
    const token = createResearchEmailVerificationToken(
      { applicationId: APPLICATION_ID, cohortCode: COHORT_CODE },
      NOW
    )!;

    expect(verifyResearchEmailVerificationToken(`${token}=`, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("expires the single-purpose link after two hours", () => {
    const token = createResearchEmailVerificationToken(
      { applicationId: APPLICATION_ID, cohortCode: COHORT_CODE },
      NOW
    );
    const expiresAt = NOW + RESEARCH_EMAIL_VERIFICATION_TTL_SECONDS * 1000;

    expect(verifyResearchEmailVerificationToken(token, expiresAt - 1).ok).toBe(true);
    expect(verifyResearchEmailVerificationToken(token, expiresAt)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it.each([
    "short",
    "replace-with-at-least-32-random-characters",
    "a".repeat(64),
  ])("fails closed for a weak or placeholder secret", (secret) => {
    vi.stubEnv("RESEARCH_EMAIL_VERIFICATION_SECRET", secret);

    expect(createResearchEmailVerificationToken(
      { applicationId: APPLICATION_ID, cohortCode: COHORT_CODE },
      NOW
    )).toBeNull();
  });

  it("requires a secret dedicated to email verification", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", STRONG_SECRET);

    expect(createResearchEmailVerificationToken(
      { applicationId: APPLICATION_ID, cohortCode: COHORT_CODE },
      NOW
    )).toBeNull();
  });

  it.each([
    { applicationId: "not-a-uuid", cohortCode: COHORT_CODE },
    { applicationId: APPLICATION_ID, cohortCode: "../another-cohort" },
  ])("does not sign malformed application claims", (claims) => {
    expect(createResearchEmailVerificationToken(claims, NOW)).toBeNull();
  });

  it("rejects signed payloads whose time claims are malformed", () => {
    const token = signArbitraryPayload({
      v: 1,
      a: APPLICATION_ID,
      c: COHORT_CODE,
      iat: "now",
      exp: "later",
    });

    expect(verifyResearchEmailVerificationToken(token, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("builds a canonical, email-free verification URL", () => {
    const verificationUrl = buildResearchEmailVerificationUrl(
      { applicationId: APPLICATION_ID, cohortCode: COHORT_CODE },
      NOW,
      "https://hanbang.ai"
    );
    const parsed = new URL(verificationUrl!);

    expect(parsed.origin).toBe("https://hanbang.ai");
    expect(parsed.pathname).toBe("/beta/verify");
    expect(parsed.search).toBe("");
    const fragment = new URLSearchParams(parsed.hash.slice(1));
    expect([...fragment.keys()]).toEqual(["token"]);
    expect(verifyResearchEmailVerificationToken(fragment.get("token"), NOW).ok).toBe(true);
  });

  it.each([
    "https://lookalike.example",
    "https://hanbang.ai:444",
    "https://hanbang.ai/untrusted-path",
    "https://hanbang.ai?next=https://evil.example",
  ])("never sends a production capability to a non-canonical base URL", (siteUrl) => {
    vi.stubEnv("NODE_ENV", "production");

    expect(buildResearchEmailVerificationUrl(
      { applicationId: APPLICATION_ID, cohortCode: COHORT_CODE },
      NOW,
      siteUrl
    )).toBeNull();
  });

  it("allows an exact loopback origin only outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const verificationUrl = buildResearchEmailVerificationUrl(
      { applicationId: APPLICATION_ID, cohortCode: COHORT_CODE },
      NOW,
      "http://localhost:3100"
    );

    expect(new URL(verificationUrl!).origin).toBe("http://localhost:3100");
  });
});
