import { describe, expect, it } from "vitest";

import {
  buildConsentReturnPath,
  DEFAULT_CONSENT_RETURN_PATH,
} from "@/lib/auth/consentReturnPath";

const origin = "https://hanbang.ai";

describe("community consent return path", () => {
  it("returns to the selected tool with its query and fragment", () => {
    const destination = "/wedding/community/quote-check?category=dress&from=landing#questions";
    const result = new URL(buildConsentReturnPath(destination, origin), origin);

    expect(result.pathname).toBe("/consent");
    expect(result.searchParams.get("redirect")).toBe(destination);
  });

  it("preserves encoded query values and an existing redirect parameter as data", () => {
    const destination = "/wedding/community/quote-check?question=a%26b&redirect=%2Fprice#selected";
    const result = new URL(buildConsentReturnPath(destination, origin), origin);

    expect(result.searchParams.get("redirect")).toBe(destination);
    expect([...result.searchParams.keys()]).toEqual(["redirect"]);
  });

  it.each([
    "",
    "https://attacker.example/steal",
    "https://hanbang.ai/wedding/community/quote-check",
    "//attacker.example/steal",
    "/\\attacker.example/steal",
    "javascript:alert(1)",
    "/wedding/community/quote-check\u0000",
    "/safe/%252F%252Fattacker.example",
    "/api/auth/consent",
    "/api",
    "/%61pi/auth/consent",
    "/auth/mobile-callback",
    "/%61uth/mobile-callback",
    "/login?redirect=%2Fwedding",
    "/admin/price",
    "/_next/static/asset.js",
    "/wedding/onboarding",
    "/consent",
    "/consent/",
    "/consent/retry?redirect=%2Fwedding",
    "/%63onsent?redirect=%2Fwedding",
    "/safe/../consent#again",
  ])("does not return to an unsafe or looping destination: %s", (destination) => {
    expect(buildConsentReturnPath(destination, origin)).toBe(DEFAULT_CONSENT_RETURN_PATH);
  });

  it("offers a public community destination when the path cannot be recovered", () => {
    const result = new URL(DEFAULT_CONSENT_RETURN_PATH, origin);
    expect(result.pathname).toBe("/consent");
    expect(result.searchParams.get("redirect")).toBe("/wedding");
  });

  it("fails closed if the origin cannot be parsed", () => {
    expect(buildConsentReturnPath("/wedding/community/quote-check", "invalid origin"))
      .toBe(DEFAULT_CONSENT_RETURN_PATH);
  });
});
