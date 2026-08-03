import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  hasExplicitThirdPartyAnalyticsConsent,
  isAnalyticsSuppressedLocation,
  isAnalyticsSuppressedPath,
  THIRD_PARTY_ANALYTICS_CONSENT_KEY,
} from "../analyticsPrivacy";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "../..");

describe("zero-I/O research analytics boundary", () => {
  it("fails third-party analytics closed until both deployment and current consent allow it", () => {
    window.localStorage.clear();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENABLED", "true");
    expect(hasExplicitThirdPartyAnalyticsConsent()).toBe(false);

    window.localStorage.setItem(THIRD_PARTY_ANALYTICS_CONSENT_KEY, "granted");
    expect(hasExplicitThirdPartyAnalyticsConsent()).toBe(true);

    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
    expect(hasExplicitThirdPartyAnalyticsConsent()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "false");

    vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENABLED", "false");
    expect(hasExplicitThirdPartyAnalyticsConsent()).toBe(false);
    vi.unstubAllEnvs();
    window.localStorage.clear();
  });

  it("suppresses WeddingCode research and answer-bearing public paths", () => {
    expect(isAnalyticsSuppressedPath("/internal/wedding-code-research")).toBe(true);
    expect(isAnalyticsSuppressedPath("/internal/wedding-code-research/session")).toBe(true);
    expect(isAnalyticsSuppressedPath("/internal/wedding-code-research-copy")).toBe(false);
    expect(isAnalyticsSuppressedPath("/wedding-code")).toBe(true);
    expect(isAnalyticsSuppressedPath("/wedding-code/result")).toBe(true);
    expect(isAnalyticsSuppressedPath("/wedding-code-copy")).toBe(false);
    expect(isAnalyticsSuppressedPath(null)).toBe(false);
  });

  it("suppresses analytics only for the exact admin vendor preview query", () => {
    expect(isAnalyticsSuppressedLocation(
      "/wedding/vendors",
      new URLSearchParams("preview=1"),
    )).toBe(true);
    expect(isAnalyticsSuppressedLocation(
      "/wedding/vendors/vendor-123",
      new URLSearchParams("preview=1"),
    )).toBe(true);
    expect(isAnalyticsSuppressedLocation(
      "/wedding/vendors",
      new URLSearchParams("preview=0"),
    )).toBe(false);
    expect(isAnalyticsSuppressedLocation(
      "/wedding/vendors",
      new URLSearchParams(),
    )).toBe(false);
    expect(isAnalyticsSuppressedLocation(
      "/wedding/lounge",
      new URLSearchParams("preview=1"),
    )).toBe(false);
  });

  it("keeps both global persistence entry points wired to the suppression guard", () => {
    const analytics = readFileSync(
      path.join(srcRoot, "components/analytics/AnalyticsProvider.tsx"),
      "utf8"
    );
    const utm = readFileSync(path.join(srcRoot, "components/analytics/UtmCapture.tsx"), "utf8");

    expect(analytics).toContain("isAnalyticsSuppressedLocation(pathname, searchParams)");
    expect(utm).toContain("isAnalyticsSuppressedLocation(");
  });
});
