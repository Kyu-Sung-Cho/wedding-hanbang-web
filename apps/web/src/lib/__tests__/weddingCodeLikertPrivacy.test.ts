import { describe, expect, it } from "vitest";
import {
  analyticsCaptureTouchesSuppressedPath,
  analyticsCaptureTouchesLikertPath,
  isWeddingCodeLikertPath,
  isAnalyticsSuppressedLocation,
  isAnalyticsSuppressedPath,
} from "../analyticsPrivacy";

describe("Likert answer-link analytics privacy", () => {
  it("suppresses the entry and its children even when campaign parameters are present", () => {
    for (const pathname of ["/wedding-code", "/wedding-code/", "/wedding-code/result", "/wedding-code/together", "/wedding-code-next", "/wedding-code-next/", "/wedding-code-next/result", "/wedding-code-next/result/details"]) {
      expect(isAnalyticsSuppressedPath(pathname)).toBe(true);
      expect(isWeddingCodeLikertPath(pathname)).toBe(true);
      expect(isAnalyticsSuppressedLocation(pathname, new URLSearchParams("utm_source=synthetic&utm_campaign=synthetic"))).toBe(true);
    }
  });

  it("keeps route boundaries exact and preserves existing suppressed routes", () => {
    for (const pathname of ["/wedding-code-copy", "/wedding-codeish", "/wedding-code-next-copy", "/wedding-code-nextish", "/landing", null]) {
      expect(isAnalyticsSuppressedPath(pathname)).toBe(false);
      expect(isWeddingCodeLikertPath(pathname)).toBe(false);
      expect(isAnalyticsSuppressedLocation(pathname)).toBe(false);
    }
    for (const pathname of ["/wedding-code", "/wedding-code/result", "/invite", "/internal/wedding-code-research"]) {
      expect(isAnalyticsSuppressedPath(pathname)).toBe(true);
    }
  });

  it("drops captures created on the Likert page even without a URL property", () => {
    expect(analyticsCaptureTouchesSuppressedPath({ properties: { scene_index: 1 } }, "/wedding-code-next")).toBe(true);
    expect(analyticsCaptureTouchesSuppressedPath(null, "/wedding-code-next/result")).toBe(true);
  });

  it("drops delayed captures whose current URL or referrer still points to a Likert answer link", () => {
    for (const properties of [
      { $current_url: "https://hanbang.ai/wedding-code-next#wc-likert=synthetic" },
      { $referrer: "/wedding-code-next#wc-likert=synthetic" },
      { $current_url: "/wedding-code-next/result?utm_source=synthetic#wc-likert=synthetic" },
    ]) {
      expect(analyticsCaptureTouchesSuppressedPath({ properties }, "/landing")).toBe(true);
    }
  });

  it("drops a delayed Likert URL in nested initial-page properties without changing the capture", () => {
    const capture = {
      properties: { $set_once: { $initial_current_url: "https://hanbang.ai/wedding-code-next#wc-likert=synthetic" } },
    };
    const original = JSON.stringify(capture);
    expect(analyticsCaptureTouchesSuppressedPath(capture, "/landing")).toBe(true);
    expect(JSON.stringify(capture)).toBe(original);
  });

  it("retains ordinary traffic and does not treat similarly named routes as Likert", () => {
    for (const url of ["/landing", "/wedding-code-next-copy#wc-likert=synthetic", "https://hanbang.ai/wedding-code-nextish"]) {
      expect(analyticsCaptureTouchesSuppressedPath({ properties: { $current_url: url } }, "/landing")).toBe(false);
    }
    expect(analyticsCaptureTouchesSuppressedPath({ properties: { $referrer: "/wedding-code#legacy=synthetic" } }, "/landing")).toBe(true);
  });

  it.each(["/wedding-code", "/wedding-code-next"])("drops delayed %s URLs inside query redirects, arrays and cyclic envelopes", pathname => {
    let location = `${pathname}?a=synthetic-query-answer#wc-likert=synthetic-fragment`;
    for (let index = 0; index < 12; index++) {
      location = `/login?${new URLSearchParams({ redirect: location })}`;
    }
    const capture: { properties: { origins: Array<{ location: string }> }; cycle?: unknown } = {
      properties: { origins: [{ location }] },
    };
    capture.cycle = capture;
    expect(analyticsCaptureTouchesLikertPath(capture, "/budget")).toBe(true);
    expect(capture.properties.origins[0].location).toBe(location);
    expect(analyticsCaptureTouchesLikertPath({ properties: { location: "/login?redirect=%2Fwedding%2Fbudget" } }, "/budget")).toBe(false);
  });
});
