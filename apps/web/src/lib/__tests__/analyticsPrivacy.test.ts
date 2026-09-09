import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  analyticsCaptureTouchesSuppressedPath,
  analyticsSafeSearchParams,
  isAnalyticsSuppressedLocation,
  isAnalyticsSuppressedPath,
  stripAnalyticsUrlFragments,
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
    // 초대 코드는 커플 공간 열쇠라 '#' 뒤에 싣는다. 페이지뷰 이벤트는 URL 전체를
    // 제3자에게 보내므로, 이 경로가 목록에서 빠지면 그 설계가 한 줄에 무너진다.
    expect(isAnalyticsSuppressedPath("/invite")).toBe(true);
    expect(isAnalyticsSuppressedPath("/invite/")).toBe(true);
    expect(isAnalyticsSuppressedPath("/invitation")).toBe(false);
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

describe("전송되는 URL에서 프래그먼트를 잘라낸다", () => {
  it.each(["wcTasteChat", "wcTasteReview", "wcAmoraHandoff"])(
    "%s 값은 페이지뷰와 로그인 redirect 안의 URL에서 제거한다",
    (key) => {
      const secret = "1b5088fe-beb0-4dcf-9a61-3c81aacdb310";
      for (const pathname of ["/chat", "/wedding/chat", "/settings/amora-style"]) {
        const query = new URLSearchParams({ [key]: secret, source: "wedding-code" });
        const safe = analyticsSafeSearchParams(pathname, query);
        expect(safe).not.toContain(secret);
        expect(new URLSearchParams(safe).get("source")).toBe("wedding-code");
      }
      const target = `/settings/amora-style?${new URLSearchParams({ [key]: secret, mode: "review" })}`;
      const nested = `/login?${new URLSearchParams({ redirect: target })}`;
      const safeLogin = analyticsSafeSearchParams(
        "/login", new URLSearchParams({ redirect: nested, utm_source: "launch" }),
      );
      expect(decodeURIComponent(decodeURIComponent(safeLogin))).not.toContain(secret);
      expect(new URLSearchParams(safeLogin).get("utm_source")).toBe("launch");
      const next = new URLSearchParams(new URLSearchParams(safeLogin).get("redirect")!.split("?")[1]).get("redirect");
      expect(next).toBe("/settings/amora-style?mode=review");
    },
  );

  it.each(["wcTasteChat", "wcTasteReview", "wcAmoraHandoff"])(
    "%s 값은 지연된 current/referrer/initial URL과 중첩 속성에서도 제거한다",
    (key) => {
      const secret = "ad2d989c-a86a-4d4f-a679-b755b1561561";
      const target = `/chat?${new URLSearchParams({ [key]: secret, source: "wedding-code" })}`;
      const login = `https://hanbang.ai/login?${new URLSearchParams({ redirect: target })}`;
      const event = {
        event: "$pageleave",
        properties: {
          $current_url: `https://hanbang.ai${target}`,
          $referrer: login,
          $set_once: { $initial_current_url: login },
          flow: [{ nested: { $initial_referrer: login } }],
          count: 3,
          note: "해시태그 #웨딩 준비",
        },
      };
      const safe = stripAnalyticsUrlFragments(event);
      expect(JSON.stringify(safe)).not.toContain(secret);
      expect(safe.properties.$current_url).toBe("https://hanbang.ai/chat?source=wedding-code");
      expect(safe.properties.count).toBe(3);
      expect(safe.properties.note).toBe(event.properties.note);
      expect(event.properties.$current_url).toContain(secret);
    },
  );

  it("민감 파라미터가 없는 로그인 redirect와 무관한 이벤트는 그대로 유지한다", () => {
    const url = "https://hanbang.ai/login?redirect=%2Fwedding%2Fbudget&utm_source=launch";
    const capture = { event: "opened", properties: { $current_url: url, detail: { label: "예산" } } };
    expect(stripAnalyticsUrlFragments(capture)).toBe(capture);
    expect(analyticsSafeSearchParams("/login", new URLSearchParams(url.split("?")[1])))
      .toBe("redirect=%2Fwedding%2Fbudget&utm_source=launch");
  });

  it("깊게 중첩된 initial URL에도 핸드오프 값이 남지 않는다", () => {
    const secret = "f4dcdb1e-2570-4890-8b04-72624d85b054";
    let nested: Record<string, unknown> = {
      $initial_current_url: `https://hanbang.ai/chat?wcTasteChat=${secret}`,
    };
    for (let depth = 0; depth < 12; depth += 1) nested = { next: nested };
    const safe = stripAnalyticsUrlFragments({ properties: { nested } });
    expect(JSON.stringify(safe)).not.toContain(secret);
    expect(JSON.stringify(safe)).toContain("https://hanbang.ai/chat");
  });

  it("지나치게 중첩된 redirect는 끝쪽 쿼리를 남기지 않고 분석만 정리한다", () => {
    const secret = "b7fce197-85b2-4a7f-8ba3-acd762f3caa2";
    let redirect = `/chat?wcTasteChat=${secret}`;
    for (let depth = 0; depth < 12; depth += 1) {
      redirect = `/login?${new URLSearchParams({ redirect })}`;
    }
    const safe = stripAnalyticsUrlFragments({ properties: { $current_url: redirect } });
    expect(JSON.stringify(safe)).not.toContain(secret);
    expect(safe.properties.$current_url.startsWith("/login?")).toBe(true);
  });

  it("커플 초대 코드가 URL 속성에 실려 나가지 않는다", () => {
    // posthog-js는 capture_pageleave가 켜져 있으면 $current_url에 location.href를
    // 스스로 넣는다. 억제 목록은 경로만 보므로, 프래그먼트를 달고 다른 경로로 넘어간
    // 순간 커플 공간 열쇠가 그대로 제3자에게 간다.
    const capture = stripAnalyticsUrlFragments({
      event: "$pageleave",
      properties: {
        $current_url: "https://hanbang.ai/login?redirect=%2Fwedding%2Fonboarding#WH-A3F91B2C7D40",
        $pathname: "/login",
      },
    });

    expect(capture.properties.$current_url).toBe(
      "https://hanbang.ai/login?redirect=%2Fwedding%2Fonboarding",
    );
    // 경로와 쿼리는 그대로 남는다 — /login은 가입 퍼널의 핵심이라 지표를 잃으면 안 된다.
    expect(capture.properties.$pathname).toBe("/login");
  });

  it("경로만 있는 값에서도 잘라낸다", () => {
    const capture = stripAnalyticsUrlFragments({
      properties: { $current_url: "/wedding/onboarding#WH-A3F91B2C7D40" },
    });
    expect(capture.properties.$current_url).toBe("/wedding/onboarding");
  });

  it("한 겹 안쪽에 실린 첫 방문 주소에서도 잘라낸다", () => {
    // posthog는 첫 방문 주소를 $set_once 안에 실어 보낸다. 겉만 훑으면 거기 남는다.
    const capture = stripAnalyticsUrlFragments({
      properties: {
        $set_once: {
          $initial_current_url: "https://hanbang.ai/invite#WH-A3F91B2C7D40",
        },
      },
    });

    expect(capture.properties.$set_once).toEqual({
      $initial_current_url: "https://hanbang.ai/invite",
    });
  });

  it("주소가 아닌 값은 건드리지 않는다", () => {
    // 사람이 쓴 글의 '#'을 잘라내면 그건 다른 데이터를 망가뜨리는 일이다.
    const properties = { note: "해시태그 #웨딩 준비", count: 3 };
    const capture = stripAnalyticsUrlFragments({ properties });
    expect(capture.properties).toEqual(properties);
    // 바뀐 것이 없으면 원본을 그대로 돌려준다.
    expect(capture.properties).toBe(properties);
  });

  it("이벤트가 없거나 속성이 없어도 그대로 통과한다", () => {
    expect(stripAnalyticsUrlFragments(null)).toBeNull();
    expect(stripAnalyticsUrlFragments({})).toEqual({});
  });

  it("초기화 코드가 이 가드를 실제로 물려 있다", () => {
    const analyticsClient = readFileSync(path.join(srcRoot, "lib/analytics.ts"), "utf8");
    expect(analyticsClient).toContain("stripAnalyticsUrlFragments(capture)");
    expect(analyticsClient).toContain("capture_pageleave: true");
    // /login을 억제 목록에 넣는 방식은 쓰지 않는다 — 가입 퍼널 지표를 통째로 잃는다.
    const privacy = readFileSync(path.join(srcRoot, "lib/analyticsPrivacy.ts"), "utf8");
    const suppressed = privacy.slice(
      privacy.indexOf("ANALYTICS_SUPPRESSED_PATH_PREFIXES"),
      privacy.indexOf("] as const;"),
    );
    expect(suppressed).not.toContain("/login");
  });
});
