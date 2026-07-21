import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isAnalyticsSuppressedLocation,
  isAnalyticsSuppressedPath,
} from "../analyticsPrivacy";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "../..");

describe("zero-I/O research analytics boundary", () => {
  it("suppresses only the guarded WeddingCode research path", () => {
    expect(isAnalyticsSuppressedPath("/internal/wedding-code-research")).toBe(true);
    expect(isAnalyticsSuppressedPath("/internal/wedding-code-research/session")).toBe(true);
    expect(isAnalyticsSuppressedPath("/internal/wedding-code-research-copy")).toBe(false);
    expect(isAnalyticsSuppressedPath("/wedding-code")).toBe(false);
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
