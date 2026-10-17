import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentrySpan,
  sanitizeSentryTransaction,
  type ScrubbableBreadcrumb,
  type ScrubbableEvent,
  type ScrubbableSpan,
  type ScrubbableTransaction,
} from "@hanbang/shared";

// P1-08: 모바일 Sentry에는 원문 scrubber가 있는데 웹에는 없다. 웹의 공용 로거는
// `extra: { msg, payload: err }`로 **임의 payload를 통째로** 외부 서비스에 보낸다.
// 호출자가 대화·개인정보·토큰을 담으면 그대로 나간다.
//
// 목표 아키텍처 §6 불변식 9: 로그·분석·오류·push·URL에 대화·첨부 원문을 넣지 않는다.
//
// 규칙을 복사하지 않고 `@hanbang/shared`로 올려 웹·모바일이 한 규칙을 쓰게 한다.
// 두 벌이면 한쪽만 고쳐진다(P0-1/P0-2에서 확인한 패턴).
//
// 합성 표식만 사용한다.

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const APP_ROOT = resolve(WEB_ROOT, "..");

const SYNTHETIC_SECRET = "SYNTHETIC-P108-PRIVATE-PAYLOAD";

function read(relative: string): string {
  return readFileSync(resolve(APP_ROOT, relative), "utf8");
}

describe("shared Sentry scrubber", () => {
  it("drops the arbitrary extra payload the web logger attaches", () => {
    const event = sanitizeSentryEvent<ScrubbableEvent>({
      extra: { msg: "failed", payload: { note: SYNTHETIC_SECRET } },
      user: { id: "user-1", email: "a@b.com" },
      request: { url: "https://hanbang.ai/chat?q=secret" },
    });

    expect(JSON.stringify(event)).not.toContain(SYNTHETIC_SECRET);
    expect(event.extra).toBeUndefined();
    expect(event.user).toBeUndefined();
    expect(event.request).toBeUndefined();
  });

  it("redacts identifiers that show up inside free text", () => {
    const event = sanitizeSentryEvent<ScrubbableEvent>({
      message: "문의: hong@example.com 010-1234-5678 https://hanbang.ai/x",
    });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("hong@example.com");
    expect(serialized).not.toContain("010-1234-5678");
    expect(serialized).not.toContain("hanbang.ai/x");
  });

  it("redacts exception values, not just the top-level message", () => {
    const event = sanitizeSentryEvent<ScrubbableEvent>({
      exception: { values: [{ value: `보안키 sk_${"a".repeat(20)} 유출` }] },
    });

    expect(JSON.stringify(event)).not.toContain("sk_aaaaaaaaaaaaaaaaaaaa");
  });

  it("strips breadcrumb data, which carries request bodies", () => {
    const crumb = sanitizeSentryBreadcrumb<ScrubbableBreadcrumb>({
      message: "요청 실패 hong@example.com",
      data: { body: SYNTHETIC_SECRET },
    });

    // data는 통째로 버린다 — 요청 본문과 상태가 실리는 자리다.
    expect(crumb.data).toBeUndefined();
    expect(JSON.stringify(crumb)).not.toContain(SYNTHETIC_SECRET);
    // message는 식별자 패턴만 마스킹한다. 임의 문장까지 지우지는 못하며,
    // 그래서 data·extra를 남기지 않는 쪽이 실제 방어선이다.
    expect(JSON.stringify(crumb)).not.toContain("hong@example.com");
  });

  it("strips span descriptions and data on transactions", () => {
    const event = sanitizeSentryTransaction<ScrubbableTransaction>({
      extra: { payload: SYNTHETIC_SECRET },
      spans: [{ description: `GET https://hanbang.ai/${SYNTHETIC_SECRET}`, data: { q: SYNTHETIC_SECRET } }],
    });

    expect(JSON.stringify(event)).not.toContain(SYNTHETIC_SECRET);
  });

  // 2026-09-29 운영에서 표본에 걸린 성능 이벤트를 그대로 옮긴 모양이다(값만 합성). 예전 테스트는 `request.url` 만 넣어서
  // 이 자리를 못 봤다. 브라우저 SDK 는 주소 전체를 `contexts.trace.data["url.full"]` 에 싣는다.
  const PAGELOAD_TRANSACTION = (): ScrubbableTransaction => ({
    type: "transaction",
    transaction: "/wedding-code",
    contexts: {
      trace: {
        op: "pageload",
        data: {
          "sentry.op": "pageload",
          "sentry.source": "url",
          "url.path": "/wedding-code",
          "url.full": "https://hanbang.ai/wedding-code?utm_source=test#v=v3.1-preferences&a=31_-5-4-35-2-4--455-53-445-2_SYNTHETIC",
          "lcp.renderTime": 1640,
          "performance.timeOrigin": 1790683459.9483001,
        },
      },
      culture: { locale: "ko-KR" },
    },
    spans: [],
  });

  it("removes the ? and # tail of the page address the browser SDK puts in contexts", () => {
    const event = sanitizeSentryTransaction(PAGELOAD_TRANSACTION());
    const trace = (event.contexts as { trace: { data: Record<string, unknown> } }).trace;

    expect(trace.data["url.full"]).toBe("https://hanbang.ai/wedding-code");
    expect(JSON.stringify(event)).not.toMatch(/SYNTHETIC|v=v3\.1|utm_source|#/u);
  });

  it("keeps the rest of the trace so a slow screen can still be found", () => {
    const event = sanitizeSentryTransaction(PAGELOAD_TRANSACTION());
    const trace = (event.contexts as { trace: { op: string; data: Record<string, unknown> } }).trace;

    expect(trace.op).toBe("pageload");
    expect(trace.data["sentry.op"]).toBe("pageload");
    expect(trace.data["url.path"]).toBe("/wedding-code");
    expect(trace.data["lcp.renderTime"]).toBe(1640);
    expect(event.transaction).toBe("/wedding-code");
  });

  it("does the same for error events and for the shared-link access key", () => {
    const event = sanitizeSentryEvent<ScrubbableEvent>({
      contexts: {
        trace: { data: { "url.full": "https://hanbang.ai/wedding-code/together#room=abc&access=SYNTHETIC-ACCESS-KEY" } },
        response: { "url.query": "access=SYNTHETIC-QUERY", "url.fragment": "room=abc" },
      },
    });

    expect(JSON.stringify(event)).not.toMatch(/SYNTHETIC|room=abc/u);
    expect(JSON.stringify(event)).toContain("https://hanbang.ai/wedding-code/together");
  });

  it("leaves contexts that carry no address untouched", () => {
    const event = sanitizeSentryEvent<ScrubbableEvent>({ contexts: { culture: { locale: "ko-KR" }, react: { version: "19" } } });

    expect(event.contexts).toEqual({ culture: { locale: "ko-KR" }, react: { version: "19" } });
  });

  // 선택자 칸(lcp.element·cls.source.*)이 아닌 문맥 문자열에도 요소 묘사가 섞일 수 있다. 그 안의 aria-label 값은 지운다.
  it("blanks aria-label values inside other context strings that are not addresses", () => {
    const event = sanitizeSentryEvent<ScrubbableEvent>({ contexts: { react: { componentStack: 'button[aria-label="D 미리 매듭짓는 쪽 69%"]' } } });

    expect(JSON.stringify(event)).not.toContain("69%");
    expect((event.contexts as { react: { componentStack: string } }).react.componentStack).toMatch(/^button\[aria-label=/u);
  });

  // 브라우저 SDK 의 INP·LCP·CLS span 은 이름과 data 에 눌린 요소의 선택자를 싣고, 선택자에는 aria-label 값이
  // 그대로 붙는다. 웨딩코드 wc64 막대의 aria-label 은 본인이 고른 답의 비율이다.
  it("removes user text from aria-label values in span names and span data", () => {
    const span = sanitizeSentrySpan<ScrubbableSpan>({
      op: "ui.interaction.click",
      description: 'body > div > button[aria-label="D 미리 매듭짓는 쪽 69%"]',
      data: {
        "sentry.op": "ui.interaction.click",
        "lcp.element": 'div.bar[aria-label="D 미리 매듭짓는 쪽 69%"]',
        "cls.source.1": 'img[alt="예비신부수민"]',
        "inp.value": 120,
        "url.full": "https://hanbang.ai/wedding/preparation-style?view=previous#synthetic",
      },
    });

    expect(span).not.toBeNull();
    expect(JSON.stringify(span)).not.toMatch(/69%|미리 매듭|예비신부수민|view=previous|#synthetic/u);
    expect(span.description).toBe("body > div > button");
    const data = span.data as Record<string, unknown>;
    expect(data["lcp.element"]).toBe("div");
    expect(data["cls.source.1"]).toBe("img");
    expect(data["inp.value"]).toBe(120);
    expect(data["sentry.op"]).toBe("ui.interaction.click");
    expect(data["url.full"]).toBe("https://hanbang.ai/wedding/preparation-style");
    expect(span.op).toBe("ui.interaction.click");
  });

  // INP·CLS·LCP span 이름은 요소 선택자다(browser-utils 10.66 `htmlTreeAsString`). id·class 에 문항 번호와 고른
  // 상태가 실리므로 모든 화면에서 태그 이름만 남긴다. op 와 측정값은 남아야 어느 화면이 느렸는지 안다.
  it.each([
    ["ui.interaction.click", "h2#wc64-stmt-PLAN-A1.selected", "h2"],
    ["ui.interaction.press", 'body > div.lounge > button#wc64-opt-SYNTHETIC-3.is-on[type="button"][aria-label="SYNTHETIC-LABEL > x"]', "body > div > button"],
    ["ui.webvital.cls", "main > section#wc64-result.SYNTHETIC-CLASS > p.bar", "main > section > p"],
    ["ui.webvital.lcp", 'div.flex.[&>svg]:w-4 > img#hero-SYNTHETIC[alt="SYNTHETIC-ALT"]', "div > img"],
    ["ui.webvital.lcp", "Largest contentful paint", "Largest contentful paint"],
    ["ui.webvital.cls", "Layout shift", "Layout shift"],
    ["ui.interaction.click", "<unknown>", "<unknown>"],
    ["ui.interaction.click", "#SYNTHETIC-ONLY-ID.SYNTHETIC-ONLY-CLASS", "[redacted]"],
    // 속성값 안의 `"]` 때문에 남은 낱말 조각을 태그로 읽지 않는다.
    ["ui.interaction.click", 'div > button[aria-label="a"] > SYNTHETIC-WORD"]', "div > button"],
  ])("keeps only tag names in a %s span name (%s)", (op, description, expected) => {
    const span = sanitizeSentrySpan<ScrubbableSpan>({
      op,
      description,
      start_timestamp: 1_790_000_000.5,
      data: { "sentry.op": op, "sentry.exclusive_time": 120, "inp.value": 88 },
      measurements: { inp: { value: 88, unit: "millisecond" } },
    });

    expect(span.description).toBe(expected);
    expect(span.description).not.toMatch(/SYNTHETIC|wc64|selected|lounge|#|\./u);
    expect(span.op).toBe(op);
    expect(span.start_timestamp).toBe(1_790_000_000.5);
    expect(span.data).toEqual({ "sentry.op": op, "sentry.exclusive_time": 120, "inp.value": 88 });
    expect(span.measurements).toEqual({ inp: { value: 88, unit: "millisecond" } });
  });

  it("reads the op from span data when the top-level op is missing, and leaves other spans' names alone", () => {
    expect(sanitizeSentrySpan<ScrubbableSpan>({ description: "h2#wc64-stmt-PLAN-A1.selected", data: { "sentry.op": "ui.interaction.click" } }).description).toBe("h2");
    expect(sanitizeSentrySpan<ScrubbableSpan>({ op: "http.client", description: "GET /api/budget", data: {} }).description).toBe("GET /api/budget");
    expect(sanitizeSentrySpan<ScrubbableSpan>({ op: "navigation", description: "/wedding/[slug]" }).description).toBe("/wedding/[slug]");
  });

  // 절대 주소만 꼬리를 떼면 span data 에 상대 경로로 실린 초대 코드(`#` 뒤)와 쿼리가 그대로 나간다.
  it("removes the ? and # tail of relative paths in span data and event contexts", () => {
    const span = sanitizeSentrySpan<ScrubbableSpan>({
      description: "body > button",
      data: {
        "url.path": "/invite#SYNTHETIC-INVITE-CODE",
        "http.target": "/x?y#z",
        nested: ["/wedding-code?a=SYNTHETIC-ANSWER#k=SYNTHETIC-KEY"],
        "sentry.op": "ui.interaction.click",
      },
    });
    const data = span.data as Record<string, unknown>;

    expect(data["url.path"]).toBe("/invite");
    expect(data["http.target"]).toBe("/x");
    expect(data.nested).toEqual(["/wedding-code"]);
    expect(data["sentry.op"]).toBe("ui.interaction.click");
    expect(JSON.stringify(span)).not.toMatch(/SYNTHETIC|\?y|#z/u);

    const event = sanitizeSentryEvent<ScrubbableEvent>({ contexts: { origin: { to: "/invite#SYNTHETIC-INVITE-CODE" } } });
    expect(event.contexts).toEqual({ origin: { to: "/invite" } });
  });

  it("removes aria-label values from the LCP and CLS selectors a transaction carries in its trace context", () => {
    const event = PAGELOAD_TRANSACTION();
    const trace = (event.contexts as { trace: { data: Record<string, unknown> } }).trace;
    trace.data["lcp.element"] = 'div[aria-label="D 미리 매듭짓는 쪽 69%"]';
    trace.data["cls.source.1"] = 'button[title="SYNTHETIC-TITLE"] > span';
    const cleaned = sanitizeSentryTransaction(event);
    const data = (cleaned.contexts as { trace: { data: Record<string, unknown> } }).trace.data;

    expect(JSON.stringify(cleaned)).not.toMatch(/69%|SYNTHETIC-TITLE/u);
    expect(data["lcp.element"]).toBe("div");
    expect(data["cls.source.1"]).toBe("button > span");
    expect(data["lcp.renderTime"]).toBe(1640);
  });

  // 기본 설정(`_experiments` 없음)에서는 LCP·CLS 가 따로 선 span 이 아니라 pageload 의 trace data 에 실린다
  // (browser-utils 10.66 `browserMetrics.js` `lcp.element`·`cls.source.N`). id·class 에 문항 번호와 고른 상태가 있으므로
  // 모든 화면에서 태그 이름만 남긴다. span streaming 의 `browser.web_vital.` 접두 칸도 같다.
  it("keeps only tag names in the LCP and CLS selectors of a transaction's trace context", () => {
    const event = PAGELOAD_TRANSACTION();
    const trace = (event.contexts as { trace: { data: Record<string, unknown> } }).trace;
    trace.data["lcp.element"] = "main > h2#wc64-stmt-PLAN-A1.selected";
    trace.data["cls.source.1"] = "main > section#wc64-result.SYNTHETIC-CLASS > p.bar";
    trace.data["cls.source.2"] = "div#SYNTHETIC-ONLY-ID";
    trace.data["browser.web_vital.lcp.element"] = "main > h2#wc64-stmt-PLAN-A2.selected";
    trace.data["browser.web_vital.cls.source.1"] = "ul > li#wc64-opt-SYNTHETIC.is-on";
    const cleaned = sanitizeSentryTransaction(event);
    const data = (cleaned.contexts as { trace: { data: Record<string, unknown> } }).trace.data;

    expect(data["lcp.element"]).toBe("main > h2");
    expect(data["cls.source.1"]).toBe("main > section > p");
    expect(data["cls.source.2"]).toBe("div");
    expect(data["browser.web_vital.lcp.element"]).toBe("main > h2");
    expect(data["browser.web_vital.cls.source.1"]).toBe("ul > li");
    expect(JSON.stringify(cleaned)).not.toMatch(/wc64|SYNTHETIC|selected|is-on/u);
    expect(data["lcp.renderTime"]).toBe(1640);
    expect(data["url.path"]).toBe("/wedding-code");
  });

  // browser-utils 10.66 은 선택자 옆에 LCP 요소의 id 속성 원문도 싣는다(`browserMetrics.js`·`lcp.js` 의 `lcp.id`,
  // `webVitalSpans.js` 의 `browser.web_vital.lcp.id`). wc64 의 문항 제목 id 가 그대로 나가므로 칸째로 버린다.
  it("drops the LCP element id the SDK puts next to the selector, in trace context and in span data", () => {
    const event = PAGELOAD_TRANSACTION();
    const trace = (event.contexts as { trace: { data: Record<string, unknown> } }).trace;
    trace.data["lcp.id"] = "wc64-stmt-PLAN-A1";
    trace.data["browser.web_vital.lcp.id"] = "wc64-stmt-PLAN-A2";
    const cleaned = sanitizeSentryTransaction(event);
    const data = (cleaned.contexts as { trace: { data: Record<string, unknown> } }).trace.data;

    expect(data).not.toHaveProperty("lcp.id");
    expect(data).not.toHaveProperty("browser.web_vital.lcp.id");
    expect(JSON.stringify(cleaned)).not.toContain("wc64-stmt");
    // 옆 칸은 그대로다. 어느 화면이 느렸는지는 남는다.
    expect(data["lcp.renderTime"]).toBe(1640);
    expect(data["url.path"]).toBe("/wedding-code");

    const span = sanitizeSentrySpan<ScrubbableSpan>({
      op: "ui.webvital.lcp",
      description: "Largest contentful paint",
      data: { "sentry.op": "ui.webvital.lcp", "lcp.id": "wc64-stmt-PLAN-A1", "browser.web_vital.lcp.id": "wc64-stmt-PLAN-A2", "lcp.size": 9000 },
    });
    expect(span.data).not.toHaveProperty("lcp.id");
    expect(span.data).not.toHaveProperty("browser.web_vital.lcp.id");
    expect((span.data as Record<string, unknown>)["lcp.size"]).toBe(9000);
  });

  it("keeps only tag names in selector data of a standalone span and in interaction child span names", () => {
    const span = sanitizeSentrySpan<ScrubbableSpan>({
      op: "ui.webvital.lcp",
      description: "Largest contentful paint",
      data: { "sentry.op": "ui.webvital.lcp", "lcp.element": "main > h2#wc64-stmt-PLAN-A1.selected", "lcp.size": 9000 },
    });
    expect((span.data as Record<string, unknown>)["lcp.element"]).toBe("main > h2");
    expect((span.data as Record<string, unknown>)["lcp.size"]).toBe(9000);

    const event = sanitizeSentryTransaction<ScrubbableTransaction>({
      spans: [
        { op: "ui.interaction.click", description: "main > button#wc64-opt-PLAN-A1-5.is-on", data: {} } as never,
        { op: "http.client", description: "GET /api/budget", data: {} } as never,
      ],
    });
    expect(event.spans?.[0].description).toBe("main > button");
    expect(event.spans?.[1].description).toBe("GET /api/budget");
  });

  it("does not throw on the empty shapes a real SDK can hand it", () => {
    for (const shape of [{}, { breadcrumbs: [] }, { exception: {} }, { spans: [] }]) {
      expect(() => sanitizeSentryEvent(shape as ScrubbableTransaction)).not.toThrow();
      expect(() => sanitizeSentryTransaction(shape as ScrubbableTransaction)).not.toThrow();
    }
  });
});

// scrubber가 있어도 Sentry.init에 연결하지 않으면 아무것도 막지 못한다.
describe("every web Sentry entry point installs the scrubber", () => {
  it.each([
    ["server", "web/sentry.server.config.ts"],
    ["edge", "web/sentry.edge.config.ts"],
    ["client", "web/src/instrumentation-client.ts"],
  ])("%s config filters events before they leave", (_label, relative) => {
    const source = read(relative);
    expect(source).toMatch(/beforeSend/u);
    expect(source).toMatch(/sanitizeSentryEvent/u);
  });

  it("also filters breadcrumbs and transactions where the SDK supports it", () => {
    const server = read("web/sentry.server.config.ts");
    expect(server).toMatch(/beforeBreadcrumb/u);
    expect(server).toMatch(/sanitizeSentryBreadcrumb/u);
  });

  it("filters browser spans too, which skip beforeSend and beforeSendTransaction", () => {
    const client = read("web/src/instrumentation-client.ts");
    expect(client).toMatch(/beforeSendSpan:/u);
    expect(client).toMatch(/sanitizeSentrySpan\(/u);
  });

  it("keeps mobile on the same shared rule instead of a private copy", () => {
    const mobile = read("mobile/src/lib/sentryPrivacy.ts");
    expect(mobile).toMatch(/@hanbang\/shared/u);
    // 로직이 두 벌로 갈라지면 한쪽만 고쳐진다.
    expect(mobile).not.toMatch(/function redactText/u);
  });
});
