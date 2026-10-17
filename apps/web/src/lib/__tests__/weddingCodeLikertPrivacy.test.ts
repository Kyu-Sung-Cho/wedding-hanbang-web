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

  // 로그인한 웹 라운지 웨딩코드(2026-10-16 wc64 이전). 브라우저 주소와 내부 라우트 둘 다, 하위 경로까지.
  it("suppresses the signed-in lounge WeddingCode routes, including the previous-answers view", () => {
    for (const pathname of ["/preparation-style", "/preparation-style/", "/wedding/preparation-style", "/wedding/preparation-style/", "/wedding/preparation-style/result"]) {
      expect(isWeddingCodeLikertPath(pathname)).toBe(true);
      expect(isAnalyticsSuppressedPath(pathname)).toBe(true);
      expect(isAnalyticsSuppressedLocation(pathname, new URLSearchParams("view=previous"))).toBe(true);
    }
    for (const location of [
      "https://hanbang.ai/wedding/preparation-style?view=previous",
      "/wedding/preparation-style#synthetic",
      "/preparation-style?view=previous",
    ]) {
      expect(analyticsCaptureTouchesLikertPath({ properties: { $current_url: location } }, "/landing")).toBe(true);
    }
  });

  // 감사 L7(FIX-18). 로그아웃 상태로 라운지를 열면 미들웨어가 로그인·온보딩 주소의 `?redirect=` 에 라운지 주소를 싣는다.
  // 그 화면의 이벤트는 라운지 이벤트가 아니고 redirect 값에는 답이 없으니 버리지 않는다. 공개 답 링크 경로는 쿼리 안이어도 막는다.
  it("keeps login and onboarding events whose redirect points at the lounge, but still drops public answer-link redirects", () => {
    const at = (gate: string, redirect: string) => `${gate}?${new URLSearchParams({ redirect })}`;
    for (const location of [
      at("/login", "/wedding/preparation-style"),
      at("/login", "/wedding/preparation-style?view=previous"),
      at("/wedding/onboarding", "/wedding/preparation-style"),
      `https://hanbang.ai${at("/wedding/onboarding", "/preparation-style?v=v3.1-preferences")}`,
      at("/wedding/onboarding", at("/login", "/wedding/preparation-style?view=previous")),
    ]) {
      const gatePath = new URL(location, "https://hanbang.invalid").pathname;
      expect(analyticsCaptureTouchesLikertPath({ properties: { $current_url: location } }, gatePath), location).toBe(false);
      expect(analyticsCaptureTouchesSuppressedPath({ properties: { $current_url: location } }, gatePath), location).toBe(false);
    }
    for (const location of [
      at("/login", "/wedding-code-next/result"),
      at("/login", "/wedding-code?v=36"),
      at("/wedding/onboarding", "/wedding-code"),
      // 라운지 주소라도 판·화면 이름 밖의 쿼리(초대 코드, 옛 답)가 붙으면 계속 막는다.
      at("/login", "/wedding/preparation-style?ct=synthetic-invite"),
      at("/login", "/preparation-style?v=v3.1-preferences&a=synthetic-answer"),
    ]) {
      expect(analyticsCaptureTouchesLikertPath({ properties: { $current_url: location } }, "/login"), location).toBe(true);
    }
    // 라운지 화면에서 생긴 이벤트와 속성에 라운지 주소가 직접 든 이벤트는 그대로 막는다.
    expect(analyticsCaptureTouchesLikertPath({ properties: { $current_url: "/wedding/preparation-style" } }, "/login")).toBe(true);
    expect(analyticsCaptureTouchesLikertPath({ properties: {} }, "/wedding/preparation-style")).toBe(true);
  });

  it("does not treat routes that only start with the lounge path as the lounge", () => {
    for (const pathname of ["/preparation-style-copy", "/wedding/preparation-style-copy", "/wedding/preparation-styles", "/wedding", "/wedding/budget"]) {
      expect(isWeddingCodeLikertPath(pathname)).toBe(false);
    }
    for (const location of ["/preparation-style-copy?view=previous", "https://hanbang.ai/wedding/preparation-style-copy#synthetic"]) {
      expect(analyticsCaptureTouchesLikertPath({ properties: { $current_url: location } }, "/landing")).toBe(false);
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
