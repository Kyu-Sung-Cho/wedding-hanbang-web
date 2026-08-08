import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  analyticsCaptureTouchesSuppressedPath,
  analyticsSafeSearchParams,
  isAnalyticsSuppressedLocation,
  isAnalyticsSuppressedPath,
} from "../analyticsPrivacy";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "../..");

describe("zero-I/O research analytics boundary", () => {
  it("suppresses the guarded research path and public WeddingCode answer links", () => {
    expect(isAnalyticsSuppressedPath("/internal/wedding-code-research")).toBe(true);
    expect(isAnalyticsSuppressedPath("/internal/wedding-code-research/session")).toBe(true);
    expect(isAnalyticsSuppressedPath("/internal/wedding-code-research-copy")).toBe(false);
    expect(isAnalyticsSuppressedPath("/wedding-code")).toBe(true);
    expect(isAnalyticsSuppressedPath("/wedding-code/result")).toBe(true);
    expect(isAnalyticsSuppressedPath("/wedding-code-copy")).toBe(false);
    expect(isAnalyticsSuppressedPath(null)).toBe(false);
  });

  it("drops delayed analytics events that contain a WeddingCode answer URL", () => {
    expect(analyticsCaptureTouchesSuppressedPath(
      { properties: { $current_url: "https://hanbang.ai/wedding-code?v=v0.7&a=AAAA" } },
      "/landing",
    )).toBe(true);
    expect(analyticsCaptureTouchesSuppressedPath(
      { properties: { $referrer: "/wedding-code#v=v0.7&a=AAAA" } },
      "/landing",
    )).toBe(true);
    expect(analyticsCaptureTouchesSuppressedPath(
      { properties: { $current_url: "https://hanbang.ai/landing?utm_source=test" } },
      "/landing",
    )).toBe(false);
    expect(analyticsCaptureTouchesSuppressedPath(null, "/wedding-code")).toBe(true);
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

  it("removes community searches and draft content from pageview URLs", () => {
    expect(analyticsSafeSearchParams(
      "/wedding",
      new URLSearchParams("search=%EC%98%88%EC%8B%9D%EC%9E%A5&category=is_normal&sort=new&feed=all"),
    )).toBe("category=is_normal&sort=new&feed=all");
    expect(analyticsSafeSearchParams(
      "/wedding/community/post/write",
      new URLSearchParams("prefill=%EA%B3%84%EC%95%BD%EC%84%9C+%EB%82%B4%EC%9A%A9&category=is_normal"),
    )).toBe("category=is_normal");
    expect(analyticsSafeSearchParams(
      "/landing",
      new URLSearchParams("utm_source=test"),
    )).toBe("utm_source=test");
  });

  it("keeps both global persistence entry points wired to the suppression guard", () => {
    const analytics = readFileSync(
      path.join(srcRoot, "components/analytics/AnalyticsProvider.tsx"),
      "utf8"
    );
    const analyticsClient = readFileSync(path.join(srcRoot, "lib/analytics.ts"), "utf8");
    const utm = readFileSync(path.join(srcRoot, "components/analytics/UtmCapture.tsx"), "utf8");

    expect(analytics).toContain("isAnalyticsSuppressedLocation(pathname, searchParams)");
    expect(utm).toContain("isAnalyticsSuppressedLocation(");
    expect(analyticsClient).toContain("analyticsCaptureTouchesSuppressedPath");
    expect(analyticsClient).toContain("autocapture: false");
    expect(analyticsClient).toContain("disable_session_recording: true");
  });

  it("does not print chat response bodies or database errors in production browsers", () => {
    const chatStore = readFileSync(path.join(srcRoot, "stores/chatStore.ts"), "utf8");

    expect(chatStore).toContain('if (process.env.NODE_ENV === "production") return;');
    expect(chatStore).not.toMatch(/console\.error/);
    expect(chatStore).not.toContain("res.status, errText");
  });
});
