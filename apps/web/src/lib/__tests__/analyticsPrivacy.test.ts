import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V20_VERSION } from "@/constants/weddingCodeV20";
import {
  WEDDING_CODE_FUNNEL_ANALYTICS_EFFECTIVE_AT,
  WEDDING_CODE_FUNNEL_DISCLOSURE,
  WEDDING_CODE_FUNNEL_EVENTS,
  WEDDING_CODE_FUNNEL_PROPERTIES,
  analyticsCaptureTouchesSuppressedPath,
  analyticsSafeSearchParams,
  isAnalyticsSuppressedLocation,
  isAnalyticsSuppressedPath,
  isWeddingCodeFunnelAnalyticsEffective,
  sanitizeWeddingCodeFunnelCapture,
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
    expect(isAnalyticsSuppressedPath("/preparation-style")).toBe(true);
    expect(isAnalyticsSuppressedPath("/wedding/preparation-style")).toBe(true);
    expect(isAnalyticsSuppressedPath("/preparation-style-copy")).toBe(false);
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

describe("웨딩코드 흐름 이벤트는 답과 주소를 싣지 않는다", () => {
  const AFTER = Date.parse(WEDDING_CODE_FUNNEL_ANALYTICS_EFFECTIVE_AT) + 1;
  const ANSWER_CODE = "ABCDABCDABCD-BCDABCD";

  it("적용일 전에는 허용 이벤트도 보내지 않는다", () => {
    const before = Date.parse(WEDDING_CODE_FUNNEL_ANALYTICS_EFFECTIVE_AT) - 1;
    expect(isWeddingCodeFunnelAnalyticsEffective(before)).toBe(false);
    expect(isWeddingCodeFunnelAnalyticsEffective(AFTER)).toBe(true);
    expect(sanitizeWeddingCodeFunnelCapture(
      { event: "wedding_code_started", properties: { version: "v0.8-code" } },
      before,
    )).toBeNull();
  });

  it("이름을 박아 둔 이벤트가 아니면 통과시키지 않는다", () => {
    for (const event of ["$pageview", "$pageleave", "wedding_code_answer_picked", undefined]) {
      expect(sanitizeWeddingCodeFunnelCapture({ event, properties: {} }, AFTER), String(event)).toBeNull();
    }
  });

  it("주소 속성은 쿼리와 # 를 통째로 잘라 경로만 남긴다", () => {
    const answerUrl = `https://hanbang.ai/wedding-code#v=v0.8-code&a=${ANSWER_CODE}`;
    const legacyUrl = `https://hanbang.ai/wedding-code?a=${ANSWER_CODE}`;
    const safe = sanitizeWeddingCodeFunnelCapture({
      event: "wedding_code_completed",
      properties: {
        token: "phc_test",
        distinct_id: "0191e1a2-anon",
        $current_url: answerUrl,
        $pathname: "/wedding-code",
        $referrer: legacyUrl,
        $set_once: { $initial_current_url: answerUrl, nested: [{ $initial_referrer: legacyUrl }] },
        $browser: "Chrome",
        version: "v0.8-code",
        scene_total: 20,
        answered_count: 18,
        skipped_count: 2,
      },
    }, AFTER)!;

    expect(JSON.stringify(safe)).not.toContain(ANSWER_CODE);
    expect(safe.properties!.$current_url).toBe("https://hanbang.ai/wedding-code");
    expect(safe.properties!.$referrer).toBe("https://hanbang.ai/wedding-code");
    expect(safe.properties!.$set_once).toEqual({
      $initial_current_url: "https://hanbang.ai/wedding-code",
      nested: [{ $initial_referrer: "https://hanbang.ai/wedding-code" }],
    });
    // 전송에 필요한 값과 셈은 그대로 둔다.
    expect(safe.properties).toMatchObject({
      token: "phc_test",
      distinct_id: "0191e1a2-anon",
      $browser: "Chrome",
      version: "v0.8-code",
      scene_total: 20,
      answered_count: 18,
      skipped_count: 2,
    });
  });

  it("SDK가 최상위에 붙인 개인 속성과 최초 응답 주소도 제거한다", () => {
    const safe = sanitizeWeddingCodeFunnelCapture({
      event: "wedding_code_started",
      uuid: "synthetic-event",
      timestamp: new Date(AFTER),
      $set_once: { $initial_current_url: `https://hanbang.ai/wedding-code#a=${ANSWER_CODE}` },
      $set: { note: ANSWER_CODE },
      unexpected: ANSWER_CODE,
      properties: { version: "v1.2-code", distinct_id: "synthetic-browser" },
    }, AFTER)!;

    expect(Object.keys(safe).sort()).toEqual(["event", "properties", "timestamp", "uuid"]);
    expect(JSON.stringify(safe)).not.toContain(ANSWER_CODE);
    expect(safe.properties).toEqual({ version: "v1.2-code", distinct_id: "synthetic-browser" });
  });

  it("실수로 넘긴 답 코드·링크·허용하지 않은 키는 보내기 전에 버린다", () => {
    const safe = sanitizeWeddingCodeFunnelCapture({
      event: "wedding_code_share_copied",
      properties: {
        result_kind: "solo",
        version: ANSWER_CODE,
        placement: "https://hanbang.ai/wedding-code#a=AAAA",
        code: ANSWER_CODE,
        share_url: `https://hanbang.ai/wedding-code#a=${ANSWER_CODE}`,
        letters: "VTUH",
        scene_index: 1_000_000,
        answered_count: -1,
        has_partner_link: true,
      },
    }, AFTER)!;

    expect(safe.properties).toEqual({ result_kind: "solo", has_partner_link: true });
  });

  it("초기화 코드가 억제 판정보다 먼저 이 정리를 거친다", () => {
    const analyticsClient = readFileSync(path.join(srcRoot, "lib/analytics.ts"), "utf8");
    const beforeSend = analyticsClient.slice(analyticsClient.indexOf("before_send"));
    expect(beforeSend.indexOf("sanitizeWeddingCodeFunnelCapture(capture)"))
      .toBeGreaterThan(-1);
    expect(beforeSend.indexOf("sanitizeWeddingCodeFunnelCapture(capture)"))
      .toBeLessThan(beforeSend.indexOf("analyticsCaptureTouchesSuppressedPath(capture"));
    // 페이지뷰 억제는 그대로다 — 경로를 목록에서 빼는 방식으로 열지 않는다.
    expect(isAnalyticsSuppressedPath("/wedding-code")).toBe(true);
  });

  it("고지한 적용일이 처리방침과 화면 안내에 같은 날짜로 적혀 있다", () => {
    const effective = new Date(WEDDING_CODE_FUNNEL_ANALYTICS_EFFECTIVE_AT);
    const kst = new Date(effective.getTime() + 9 * 60 * 60 * 1000);
    const label = `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일부터`;
    const privacy = readFileSync(path.join(srcRoot, "app/privacy/page.tsx"), "utf8");
    const client = readFileSync(path.join(srcRoot, "app/wedding-code/WeddingCodeV06Client.tsx"), "utf8");
    expect(privacy.split(label).length - 1).toBeGreaterThanOrEqual(3);
    expect(client).toContain(label);
  });

  /**
   * 2026-09-17 에 잡힌 결함: 9-16 에 고지한 제3조는 「시작·완료·공유 여부, 몇 번째 장면,
   * 답한/건너뛴 수」만 적었는데 코드는 첫 화면·비교 화면·다시 시작 이벤트와 판·상대 링크·
   * 결과 종류·누른 자리 속성까지 보내게 돼 있었다. 제8조는 「제3조의 항목만」 모은다고 했다.
   * **보내는 것은 전부 방침 제3조 웨딩코드 문장 안에 적혀 있어야 한다.**
   */
  it("보내는 흐름 이벤트와 속성이 전부 처리방침 제3조 웨딩코드 문장에 적혀 있다", () => {
    const privacy = readFileSync(path.join(srcRoot, "app/privacy/page.tsx"), "utf8");
    const start = privacy.indexOf("<li>로그인 없이 이용하는 공개 웨딩코드: ");
    const end = privacy.indexOf("</li>", start);
    expect(start, "제3조 웨딩코드 문장을 못 찾았다 — 이 검사가 헛돈다").toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const clause = privacy.slice(start, end);

    for (const key of [...WEDDING_CODE_FUNNEL_EVENTS, ...WEDDING_CODE_FUNNEL_PROPERTIES]) {
      const phrase = WEDDING_CODE_FUNNEL_DISCLOSURE[key];
      expect(phrase, key).toBeTruthy();
      expect(clause, `${key} → "${phrase}" 가 방침에 없다`).toContain(phrase);
    }
  });

  it("허용 목록 밖의 속성은 보내기 전에 버린다 — 방침에 없는 값이 새지 않는다", () => {
    const now = Date.parse(WEDDING_CODE_FUNNEL_ANALYTICS_EFFECTIVE_AT) + 1;
    const sent = sanitizeWeddingCodeFunnelCapture({
      event: "wedding_code_completed",
      properties: { version: "v0.9-code", answered_count: 18, answer_code: "ABCD", letters: "vtfh" },
    }, now);
    expect(sent?.properties).toEqual({ version: "v0.9-code", answered_count: 18 });
  });

  it("새 16문장 판의 버전 식별자는 답 없이 안전한 흐름 값으로 통과한다", () => {
    const sent = sanitizeWeddingCodeFunnelCapture({
      event: "wedding_code_started",
      properties: { version: WEDDING_CODE_V20_VERSION, scene_total: 16 },
    }, AFTER);

    expect(sent?.properties).toEqual({ version: WEDDING_CODE_V20_VERSION, scene_total: 16 });
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
