import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isAnalyticsSuppressedPath } from "../analyticsPrivacy";

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

  it("keeps both global persistence entry points wired to the suppression guard", () => {
    const analytics = readFileSync(
      path.join(srcRoot, "components/analytics/AnalyticsProvider.tsx"),
      "utf8"
    );
    const utm = readFileSync(path.join(srcRoot, "components/analytics/UtmCapture.tsx"), "utf8");

    expect(analytics).toContain("isAnalyticsSuppressedPath(pathname)");
    expect(utm).toContain("isAnalyticsSuppressedPath(window.location.pathname)");
  });
});
