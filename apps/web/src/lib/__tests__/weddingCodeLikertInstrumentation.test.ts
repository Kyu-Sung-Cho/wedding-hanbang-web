import { afterEach, describe, expect, it, vi } from "vitest";
import type { makeFetchTransport } from "@sentry/nextjs";

type Transport = ReturnType<typeof makeFetchTransport>;
type Envelope = Parameters<Transport["send"]>[0];
type BaseTransportOptions = Parameters<typeof makeFetchTransport>[0];

type SentryHook = (value: Record<string, unknown>) => Record<string, unknown> | null;
interface SentryOptions {
  beforeSend: SentryHook;
  beforeSendTransaction: SentryHook;
  beforeBreadcrumb: SentryHook;
  beforeSendSpan?: SentryHook;
  transport: (options: BaseTransportOptions) => Transport;
}
type ClientErrorSink = (error: unknown, context: { digest?: string }) => void;
type BufferedEvent = { error?: unknown; message?: string; reason?: unknown };
type BufferListener = (event: BufferedEvent) => void;

const sdk = vi.hoisted(() => ({
  init: vi.fn((options: SentryOptions) => { void options; }),
  captureException: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
  transportSend: vi.fn(async (envelope: Envelope) => { void envelope; return { statusCode: 200 }; }),
  transportFlush: vi.fn(async (timeout?: number) => { void timeout; return true; }),
  makeFetchTransport: vi.fn(),
}));
const clientSink = vi.hoisted(() => ({ attach: vi.fn((sink: ClientErrorSink) => { void sink; }), clear: vi.fn() }));
const scrub = vi.hoisted(() => ({
  event: vi.fn((value: unknown) => value),
  transaction: vi.fn((value: unknown) => value),
  breadcrumb: vi.fn((value: unknown) => value),
  span: vi.fn((value: unknown) => value),
}));
vi.mock("@sentry/nextjs", () => sdk);
vi.mock("../observability/clientErrorReport", () => ({ attachClientErrorSink: clientSink.attach, clearBufferedClientErrors: clientSink.clear }));
vi.mock("@hanbang/shared", () => ({
  sanitizeSentryEvent: scrub.event,
  sanitizeSentryTransaction: scrub.transaction,
  sanitizeSentryBreadcrumb: scrub.breadcrumb,
  sanitizeSentrySpan: scrub.span,
}));

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

function fakeWindow(pathname: string) {
  let idle: (() => void) | undefined;
  const handlers = new Map<string, BufferListener>();
  const value = {
    location: { pathname, hostname: "127.0.0.1" },
    addEventListener: vi.fn((name: string, handler: BufferListener) => { handlers.set(name, handler); }),
    removeEventListener: vi.fn((name: string) => { handlers.delete(name); }),
    requestIdleCallback: vi.fn((run: () => void) => { idle = run; }),
  };
  vi.stubGlobal("window", value);
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://synthetic.invalid/zero-transmission");
  return {
    value, runIdle: () => idle?.(),
    dispatch: (name: string, event: BufferedEvent) => handlers.get(name)?.(event),
  };
}

/**
 * 실제 timeOrigin 처럼 소수가 붙은 값이다. Sentry 는 `(origin + tick) / 1000` 으로 초를 만들므로 구간 비교도 같은 식이어야
 * 같은 tick 이 정확히 같은 값이 된다(`epochSeconds * 1000 - origin` 은 이 값에서 정밀도를 잃는다).
 */
const ORIGIN_MS = 1_790_000_000_000.667;

/** performance.now() 와 Date.now() 를 같은 가짜 시계로 맞춘다(Sentry 의 시간 기준 판정이 timeOrigin 을 고르게). */
function fakeClock(initialMs: number) {
  let current = initialMs;
  vi.stubGlobal("performance", { now: () => current, timeOrigin: ORIGIN_MS });
  const dateNow = vi.spyOn(Date, "now").mockImplementation(() => ORIGIN_MS + current);
  cleanups.push(() => dateNow.mockRestore());
  return { at: (ms: number) => { current = ms; } };
}

/** AnalyticsProvider 의 경로 확정 effect 가 부르는 콜백(`registerClientMonitoringPathCommit`)을 지금 경로로 부른다. */
function commitPath(page: { value: { location: { pathname: string } } }, pathname: string) {
  page.value.location.pathname = pathname;
  const commit = (page.value as unknown as { __hanbangMonitoringPathCommit?: () => void }).__hanbangMonitoringPathCommit;
  if (!commit) throw new Error("path commit callback was not registered");
  commit();
}

function options(): SentryOptions {
  const current = sdk.init.mock.calls[0]?.[0];
  if (!current) throw new Error("Ordinary-page Sentry initialization did not finish");
  return current;
}

describe("Likert Sentry boundary", () => {
  it.each(["/wedding-code", "/wedding-code/result", "/wedding-code/together", "/wedding-code-next", "/wedding-code-next/result", "/preparation-style", "/wedding/preparation-style"])("does not initialize or buffer errors on direct entry to %s", async pathname => {
    const page = fakeWindow(pathname);
    const instrumentationModule = await import("../../instrumentation-client");
    page.dispatch("error", { error: new Error("synthetic Likert error") });
    page.dispatch("unhandledrejection", { reason: "synthetic Likert rejection" });
    page.runIdle();
    instrumentationModule.onRouterTransitionStart("/wedding-code-next/result", "push");
    expect(page.value.addEventListener).not.toHaveBeenCalled();
    expect(page.value.requestIdleCallback).not.toHaveBeenCalled();
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
    expect(clientSink.attach).not.toHaveBeenCalled();
    expect(sdk.captureRouterTransitionStart).not.toHaveBeenCalled();
  });

  it("cancels initialization and drops the buffer when navigation enters Likert before idle", async () => {
    const page = fakeWindow("/landing");
    await import("../../instrumentation-client");
    page.dispatch("error", { error: new Error("synthetic pending error") });
    page.value.location.pathname = "/wedding-code/result";
    page.dispatch("unhandledrejection", { reason: "synthetic Likert rejection" });
    page.runIdle();
    await vi.waitFor(() => expect(page.value.removeEventListener).toHaveBeenCalledTimes(2));
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
    expect(clientSink.attach).not.toHaveBeenCalled();
  });

  it("cancels initialization if navigation enters Likert while the SDK import is pending", async () => {
    const page = fakeWindow("/landing");
    await import("../../instrumentation-client");
    page.runIdle();
    page.value.location.pathname = "/wedding-code";
    await vi.waitFor(() => expect(page.value.removeEventListener).toHaveBeenCalledTimes(2));
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it("drops events, transactions, breadcrumbs and boundary errors after an initialized SDK enters Likert", async () => {
    const page = fakeWindow("/landing");
    await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(clientSink.attach).toHaveBeenCalledTimes(1));
    page.value.location.pathname = "/wedding-code";
    const synthetic = { request: { url: "http://127.0.0.1/wedding-code#wc-likert=synthetic" } };
    expect(options().beforeSend(synthetic)).toBeNull();
    expect(options().beforeSendTransaction(synthetic)).toBeNull();
    expect(options().beforeBreadcrumb({ message: "synthetic answer" })).toBeNull();
    clientSink.attach.mock.calls[0][0](new Error("synthetic boundary error"), { digest: "synthetic" });
    expect(sdk.captureException).not.toHaveBeenCalled();
    expect(scrub.event).not.toHaveBeenCalled();
    expect(scrub.transaction).not.toHaveBeenCalled();
    expect(scrub.breadcrumb).not.toHaveBeenCalled();
  });

  it.each(["beforeSend", "beforeSendTransaction", "beforeBreadcrumb"] as const)(
    "%s drops delayed Likert-origin URLs after the current route becomes ordinary",
    async hook => {
      const page = fakeWindow("/landing");
      await import("../../instrumentation-client");
      page.runIdle();
      await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
      page.value.location.pathname = "/budget";
      const delayed = {
        request: { url: "https://hanbang.ai/wedding-code-next/result#wc-likert=synthetic" },
      };
      expect(options()[hook](delayed)).toBeNull();
      expect(delayed.request.url).toBe("https://hanbang.ai/wedding-code-next/result#wc-likert=synthetic");
      const ordinary = { request: { url: "https://hanbang.ai/budget#synthetic" } };
      expect(options()[hook](ordinary)).toBe(ordinary);
      const legacy = { request: { url: "https://hanbang.ai/wedding-code#synthetic" } };
      expect(options()[hook](legacy)).toBeNull();
      // 쿼리 안의 보호 경로는 Sentry 판정이 열어 보지 않는다(로그인 화면 오류를 살린다). `?` 꼬리는 정제기가 뗀다.
      const queryRedirect = { contexts: { origin: `/login?${new URLSearchParams({ redirect: "/wedding-code?a=synthetic-private-answer" })}` } };
      expect(options()[hook](queryRedirect)).toBe(queryRedirect);
    },
  );

  // 로그인하지 않은 사람이 라운지 웨딩코드를 열면 미들웨어가 이 주소로 보낸다. 쿼리 안의 라운지 주소 때문에
  // 로그인·온보딩 화면의 오류까지 버리면 감시가 그 화면에서 눈을 감는다.
  it.each([
    ["/login", "https://hanbang.ai/login?redirect=%2Fwedding%2Fpreparation-style"],
    ["/login", "/login?redirect=/wedding/preparation-style"],
    ["/wedding/onboarding", "https://hanbang.ai/wedding/onboarding?redirect=%2Fwedding%2Fpreparation-style%3Fview%3Dprevious"],
  ])("sends Sentry events from %s whose redirect query points at the lounge (%s)", async (pathname, url) => {
    const page = fakeWindow("/landing");
    sdk.makeFetchTransport.mockImplementation(() => ({ send: sdk.transportSend, flush: sdk.transportFlush }));
    await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    page.value.location.pathname = pathname;
    const event = { request: { url }, contexts: { trace: { data: { "url.full": url } } } };
    expect(options().beforeSend(event)).toBe(event);
    expect(scrub.event).toHaveBeenCalledWith(event);
    expect(options().beforeSendTransaction(event)).toBe(event);
    const crumb = { category: "navigation", data: { from: "/landing", to: url } };
    expect(options().beforeBreadcrumb(crumb)).toBe(crumb);
    const transport = options().transport({ url: "https://synthetic.invalid/envelope", recordDroppedEvent: vi.fn() });
    const envelope = [{ sent_at: "2026-10-16T00:00:00.000Z" }, [[{ type: "event" }, event]]] as unknown as Envelope;
    expect(await transport.send(envelope)).toEqual({ statusCode: 200 });
    expect(sdk.transportSend).toHaveBeenCalledWith(envelope);
    // 주소 자체가 라운지면 그대로 버린다.
    const lounge = { request: { url: "https://hanbang.ai/wedding/preparation-style?redirect=%2Flogin" } };
    expect(options().beforeSend(lounge)).toBeNull();
  });

  // Sentry core 10.66 은 beforeSendSpan 이 null 을 돌려주면 경고만 띄우고 원본 span 을 보낸다
  // (envelope.js createSpanEnvelope, client.js _processBeforeSend). 그래서 null 은 "버림"이 아니라 "원문 전송"이다.
  it.each(["/wedding/preparation-style", "/preparation-style", "/wedding-code"])(
    "beforeSendSpan returns a redacted object, never null, on %s",
    async pathname => {
      const page = fakeWindow("/landing");
      await import("../../instrumentation-client");
      page.runIdle();
      await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
      expect(options().beforeSendSpan).toBeTypeOf("function");
      page.value.location.pathname = pathname;
      const span = {
        span_id: "1111111111111111", trace_id: "11111111111111111111111111111111", op: "ui.interaction.click",
        description: 'body > div > button[aria-label="D 미리 매듭짓는 쪽 69%"]',
        data: { "sentry.op": "ui.interaction.click", "lcp.element": 'div[aria-label="SYNTHETIC-ANSWER 69%"]', "inp.value": 120 },
      };
      const sent = options().beforeSendSpan?.(span);
      expect(sent).not.toBeNull();
      expect(sent).toBeTypeOf("object");
      expect(sent?.description).toBe("[redacted]");
      expect(JSON.stringify(sent)).not.toMatch(/69%|SYNTHETIC-ANSWER|미리 매듭/u);
      expect(sent).toMatchObject({ op: "ui.interaction.click", span_id: "1111111111111111", data: { "inp.value": 120 } });
    },
  );

  // 실제 INP span 모양(browser-utils 10.66 `startStandaloneWebVitalSpan`): 주소 칸이 없고 transaction 은 앞 화면 이름이다.
  function inpSpan(startMs: number, description: string) {
    return {
      span_id: "2222222222222222", trace_id: "22222222222222222222222222222222",
      start_timestamp: (ORIGIN_MS + startMs) / 1000, timestamp: (ORIGIN_MS + startMs + 120) / 1000,
      op: "ui.interaction.click", description,
      data: {
        transaction: "/budget", release: "synthetic-release", environment: "development",
        "sentry.op": "ui.interaction.click", "sentry.origin": "auto.http.browser.inp", "sentry.exclusive_time": 120,
        "user_agent.original": "synthetic-agent",
      },
    };
  }

  it("redacts and drops an INP span that started on the lounge after SPA navigation app -> lounge -> app", async () => {
    const clock = fakeClock(1_000);
    const page = fakeWindow("/budget");
    sdk.makeFetchTransport.mockImplementation(() => ({ send: sdk.transportSend, flush: sdk.transportFlush }));
    const instrumentationModule = await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    clock.at(2_000);
    instrumentationModule.onRouterTransitionStart("/wedding/preparation-style", "push");
    commitPath(page, "/wedding/preparation-style");
    clock.at(8_000);
    instrumentationModule.onRouterTransitionStart("/budget", "push");
    commitPath(page, "/budget");
    clock.at(9_000);

    const onLounge = inpSpan(5_000, "h2#wc64-stmt-SYNTHETIC-ITEM");
    const sent = options().beforeSendSpan?.(onLounge);
    expect(sent).not.toBeNull();
    expect(sent?.description).toBe("[redacted]");
    expect(sent).toMatchObject({ op: "ui.interaction.click", data: { transaction: "/wedding/preparation-style", "sentry.exclusive_time": 120 } });
    expect(JSON.stringify(sent)).not.toMatch(/wc64-stmt|SYNTHETIC|\/budget/u);
    const transport = options().transport({ url: "https://synthetic.invalid/envelope", recordDroppedEvent: vi.fn() });
    expect(await transport.send([{ sent_at: "2026-10-16T00:00:00.000Z" }, [[{ type: "span" }, sent]]] as unknown as Envelope)).toEqual({});
    expect(sdk.transportSend).not.toHaveBeenCalled();
    // 다른 앱 화면으로 가는 이동 기록은 연다.
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledTimes(1);
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledWith("/budget", "push");

    // 머문 구간 밖 span 은 정제만 거쳐 그대로 나간다(구간 끝은 떠난 순간을 넣지 않는다).
    for (const startMs of [1_500, 8_000, 8_500]) {
      const outside = inpSpan(startMs, "button.save");
      expect(options().beforeSendSpan?.(outside)).toBe(outside);
      expect(scrub.span).toHaveBeenCalledWith(outside);
      const envelope = [{ sent_at: "2026-10-16T00:00:00.000Z" }, [[{ type: "span" }, outside]]] as unknown as Envelope;
      expect(await transport.send(envelope)).toEqual({ statusCode: 200 });
    }
    expect(sdk.transportSend).toHaveBeenCalledTimes(3);
    // 앞 화면에서 시작해 라운지를 거친 이동 기록은 그대로, 라운지 안에서 시작한 것은 버린다.
    const before = { start_timestamp: (ORIGIN_MS + 1_500) / 1000, transaction: "/budget" };
    expect(options().beforeSendTransaction(before)).toBe(before);
    expect(options().beforeSendTransaction({ start_timestamp: (ORIGIN_MS + 3_000) / 1000, transaction: "/budget" })).toBeNull();
  });

  it("treats a page opened on the lounge as a stay from page start once a later SDK picks up buffered entries", async () => {
    const clock = fakeClock(500);
    const page = fakeWindow("/wedding/preparation-style");
    const instrumentationModule = await import("../../instrumentation-client");
    clock.at(4_000);
    instrumentationModule.onRouterTransitionStart("/budget", "push");
    commitPath(page, "/budget");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    clock.at(6_000);
    const buffered = inpSpan(3_000, "<unknown>");
    expect(options().beforeSendSpan?.(buffered)).toMatchObject({ description: "[redacted]", data: { transaction: "/wedding/preparation-style" } });
    // SDK 가 지금 화면 이름으로 만든 페이지 로드 기록은 페이지를 연 순간에 시작한다.
    expect(options().beforeSendTransaction({ start_timestamp: ORIGIN_MS / 1000, transaction: "/budget", contexts: { trace: { data: { "lcp.element": "h2#wc64-stmt-x" } } } })).toBeNull();
    const later = inpSpan(5_000, "button.save");
    expect(options().beforeSendSpan?.(later)).toBe(later);
  });

  it("keeps a bounded number of lounge stays and still covers the oldest one", async () => {
    const clock = fakeClock(100);
    const page = fakeWindow("/budget");
    const instrumentationModule = await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    for (let visit = 0; visit < 40; visit += 1) {
      clock.at(1_000 + visit * 1_000);
      instrumentationModule.onRouterTransitionStart("/wedding/preparation-style", "push");
      commitPath(page, "/wedding/preparation-style");
      clock.at(1_400 + visit * 1_000);
      instrumentationModule.onRouterTransitionStart("/budget", "push");
      commitPath(page, "/budget");
    }
    expect(instrumentationModule.likertStayCountForTest()).toBeLessThanOrEqual(8);
    clock.at(60_000);
    expect(options().beforeSendSpan?.(inpSpan(1_200, "h2#first-visit"))).toMatchObject({ description: "[redacted]" });
    expect(options().beforeSendSpan?.(inpSpan(40_200, "h2#last-visit"))).toMatchObject({ description: "[redacted]" });
    const afterAll = inpSpan(50_000, "button.save");
    expect(options().beforeSendSpan?.(afterAll)).toBe(afterAll);
  });

  // App Router 는 새 화면이 확정될 때까지 라운지 화면을 그대로 보여 주고, 사용자는 그 화면을 계속 누를 수 있다.
  // 그래서 구간은 이동 시작이 아니라 경로 확정에서 닫는다. 대신 떠나는 순간 연 목적지 이동 기록(op navigation 루트와
  // 그 자식 중 화면 span 이 아닌 것)은 구간 판정에서 빼서 그대로 나가게 한다.
  const NAV_TRACE = "33333333333333333333333333333333";
  const NAV_SPAN = "3333333333333333";
  function navigationRoot(startMs: number, name: string) {
    return {
      span_id: NAV_SPAN, trace_id: NAV_TRACE, op: "navigation", description: name, is_segment: true,
      start_timestamp: (ORIGIN_MS + startMs) / 1000, timestamp: (ORIGIN_MS + startMs + 900) / 1000,
      data: { "sentry.op": "navigation", "sentry.origin": "auto.navigation.nextjs.app_router_instrumentation" },
    };
  }
  function navigationChild(startMs: number, op: string, description: string) {
    return {
      span_id: "4444444444444444", parent_span_id: NAV_SPAN, trace_id: NAV_TRACE, op, description,
      start_timestamp: (ORIGIN_MS + startMs) / 1000, timestamp: (ORIGIN_MS + startMs + 50) / 1000,
      data: { "sentry.op": op },
    };
  }

  it("keeps the lounge stay open until the leaving route commits and lets only the destination navigation through", async () => {
    const clock = fakeClock(1_000);
    const page = fakeWindow("/budget");
    sdk.makeFetchTransport.mockImplementation(() => ({ send: sdk.transportSend, flush: sdk.transportFlush }));
    const instrumentationModule = await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    clock.at(2_000);
    instrumentationModule.onRouterTransitionStart("/wedding/preparation-style", "push");
    commitPath(page, "/wedding/preparation-style");
    // 떠나는 이동을 시작한 tick 과 Sentry 가 목적지 이동 기록을 시작한 tick 이 같다(소수 붙은 tick).
    clock.at(8_000.2);
    instrumentationModule.onRouterTransitionStart("/budget", "push");
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledWith("/budget", "push");
    // 아직 확정 전이라 라운지 화면이 보이고 주소도 라운지다.
    expect(page.value.location.pathname).toBe("/wedding/preparation-style");
    clock.at(8_900.7);
    commitPath(page, "/budget");
    clock.at(9_500);
    const transport = options().transport({ url: "https://synthetic.invalid/envelope", recordDroppedEvent: vi.fn() });
    const send = (item: unknown) => transport.send([{ sent_at: "2026-10-16T00:00:00.000Z" }, [[{ type: "span" }, item]]] as unknown as Envelope);

    // 이동 시작 뒤 확정 전에 라운지 화면에서 누른 것은 구간 안이다.
    for (const startMs of [8_000.2, 8_400, 8_900.6]) {
      const pressed = inpSpan(startMs, "h2#wc64-stmt-PLAN-A1.selected");
      const sent = options().beforeSendSpan?.(pressed);
      expect(sent).toMatchObject({ description: "[redacted]", data: { transaction: "/wedding/preparation-style" } });
      expect(JSON.stringify(sent)).not.toMatch(/wc64-stmt|PLAN-A1/u);
      expect(await send(sent)).toEqual({});
    }
    expect(sdk.transportSend).not.toHaveBeenCalled();

    // 목적지 이동 기록: 루트(떠나기 시작한 tick 에 시작), 목적지 RSC 요청 자식, transaction 은 그대로 나간다.
    const root = navigationRoot(8_000.2, "/budget");
    expect(options().beforeSendSpan?.(root)).toBe(root);
    const rsc = navigationChild(8_100, "http.client", "GET /budget");
    expect(options().beforeSendSpan?.(rsc)).toBe(rsc);
    // 목적지 이동 기록과 같은 trace 라도 화면 span(눌린 요소·화면 측정)은 라운지 화면의 것이라 구간 안이다.
    expect(options().beforeSendSpan?.(navigationChild(8_300, "ui.interaction.click", "h2#wc64-stmt-PLAN-A1"))).toMatchObject({ description: "[redacted]", data: { transaction: "/wedding/preparation-style" } });
    expect(options().beforeSendSpan?.(navigationChild(8_300, "ui.webvital.cls", "main > h2#wc64-stmt-PLAN-A1"))).toMatchObject({ description: "[redacted]", data: { transaction: "/wedding/preparation-style" } });
    const navigation = {
      type: "transaction", transaction: "/budget", start_timestamp: (ORIGIN_MS + 8_000.2) / 1000,
      contexts: { trace: { op: "navigation", trace_id: NAV_TRACE, span_id: NAV_SPAN } }, spans: [rsc],
    };
    expect(options().beforeSendTransaction(navigation)).toBe(navigation);
    expect(await transport.send([{ sent_at: "2026-10-16T00:00:00.000Z" }, [[{ type: "transaction" }, navigation]]] as unknown as Envelope)).toEqual({ statusCode: 200 });
    expect(sdk.transportSend).toHaveBeenCalledTimes(1);

    // 떠나기 전에 시작한 이동 기록, 이름이 보호 경로인 이동 기록, 이동이 아닌 루트는 빼지 않는다.
    expect(options().beforeSendSpan?.(navigationRoot(7_000, "/budget"))).toMatchObject({ data: { transaction: "/wedding/preparation-style" } });
    expect(options().beforeSendSpan?.({ ...navigationRoot(8_100, "/wedding/preparation-style"), trace_id: "5".repeat(32) })).toMatchObject({ data: { transaction: "/wedding/preparation-style" } });
    expect(options().beforeSendSpan?.({ ...navigationRoot(8_100, "/budget"), op: "pageload", trace_id: "6".repeat(32) })).toMatchObject({ data: { transaction: "/wedding/preparation-style" } });
    expect(options().beforeSendTransaction({ ...navigation, start_timestamp: (ORIGIN_MS + 7_000) / 1000 })).toBeNull();
    // 모르는 trace 의 자식은 빼지 않는다.
    expect(options().beforeSendSpan?.({ ...navigationChild(8_100, "http.client", "GET /x"), trace_id: "7".repeat(32) })).toMatchObject({ data: { transaction: "/wedding/preparation-style" } });

    // 확정한 tick 부터는 구간 밖이다(닫는 tick 과 시작 tick 이 같은 경우 포함).
    for (const startMs of [8_900.7, 9_000]) {
      const after = inpSpan(startMs, "button");
      expect(options().beforeSendSpan?.(after)).toBe(after);
    }
  });

  it("closes a stay opened by a lounge navigation that the route commit redirected to /login", async () => {
    const clock = fakeClock(1_000);
    const page = fakeWindow("/budget");
    sdk.makeFetchTransport.mockImplementation(() => ({ send: sdk.transportSend, flush: sdk.transportFlush }));
    const instrumentationModule = await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    clock.at(2_000);
    instrumentationModule.onRouterTransitionStart("/wedding/preparation-style", "push");
    clock.at(2_300);
    // 미들웨어가 로그인하지 않은 사람을 /login 으로 돌려보낸다. 이 구간을 닫는 곳은 경로 확정 하나뿐이다.
    commitPath(page, "/login");
    clock.at(3_000);
    const span = inpSpan(2_500, "button");
    expect(options().beforeSendSpan?.(span)).toBe(span);
    const login = { type: "transaction", transaction: "/login", start_timestamp: (ORIGIN_MS + 2_600) / 1000, contexts: { trace: { op: "navigation" } } };
    expect(options().beforeSendTransaction(login)).toBe(login);
    const transport = options().transport({ url: "https://synthetic.invalid/envelope", recordDroppedEvent: vi.fn() });
    expect(await transport.send([{ sent_at: "2026-10-16T00:00:00.000Z" }, [[{ type: "span" }, span]]] as unknown as Envelope)).toEqual({ statusCode: 200 });
    expect(sdk.transportSend).toHaveBeenCalledTimes(1);
  });

  it("opens a stay when a route commits on the lounge without a transition start", async () => {
    const clock = fakeClock(1_000);
    const page = fakeWindow("/budget");
    const instrumentationModule = await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    // 서버 액션 redirect 처럼 onRouterTransitionStart 없이 라운지에 도착한다. 이 구간을 여는 곳은 경로 확정 하나뿐이다.
    clock.at(2_000);
    commitPath(page, "/wedding/preparation-style");
    clock.at(5_000);
    instrumentationModule.onRouterTransitionStart("/budget", "push");
    clock.at(5_200);
    commitPath(page, "/budget");
    clock.at(6_000);
    expect(options().beforeSendSpan?.(inpSpan(3_000, "h2#wc64-stmt-PLAN-A1"))).toMatchObject({ description: "[redacted]", data: { transaction: "/wedding/preparation-style" } });
    const before = inpSpan(1_500, "button");
    expect(options().beforeSendSpan?.(before)).toBe(before);
  });

  // 경로 확정 콜백은 AnalyticsProvider 의 useEffect 라 새 화면을 그린 뒤에 돈다. 라운지로 가는 이동을 시작한 tick 부터
  // 확정까지 그려진 라운지 첫 화면의 INP·CLS 가 구간 밖으로 빠지지 않게, 구간은 이동 시작에서 연다.
  it("covers the gap between a transition into the lounge and its route commit", async () => {
    const clock = fakeClock(1_000);
    const page = fakeWindow("/budget");
    sdk.makeFetchTransport.mockImplementation(() => ({ send: sdk.transportSend, flush: sdk.transportFlush }));
    const instrumentationModule = await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    clock.at(2_000);
    instrumentationModule.onRouterTransitionStart("/wedding/preparation-style", "push");
    clock.at(2_600);
    commitPath(page, "/wedding/preparation-style");
    clock.at(5_000);
    instrumentationModule.onRouterTransitionStart("/budget", "push");
    commitPath(page, "/budget");
    clock.at(6_000);
    const transport = options().transport({ url: "https://synthetic.invalid/envelope", recordDroppedEvent: vi.fn() });

    for (const startMs of [2_000, 2_300, 2_599]) {
      const sent = options().beforeSendSpan?.(inpSpan(startMs, "h2#wc64-stmt-PLAN-A1.selected"));
      expect(sent).toMatchObject({ description: "[redacted]", data: { transaction: "/wedding/preparation-style" } });
      expect(await transport.send([{ sent_at: "2026-10-16T00:00:00.000Z" }, [[{ type: "span" }, sent]]] as unknown as Envelope)).toEqual({});
    }
    const shift = { ...inpSpan(2_300, "main > section#wc64-result.SYNTHETIC"), op: "ui.webvital.cls" };
    expect(options().beforeSendSpan?.(shift)).toMatchObject({ description: "[redacted]", data: { transaction: "/wedding/preparation-style" } });
    expect(sdk.transportSend).not.toHaveBeenCalled();
    const before = inpSpan(1_900, "button");
    expect(options().beforeSendSpan?.(before)).toBe(before);
  });

  // 뒤로가기·앞으로 가기: Next 16.3.8 은 popstate 뒤에 startRouterTransition(href, 'traverse') 를 부르므로 이 훅이 불릴 때
  // 주소는 이미 목적지다. @sentry/nextjs 10.66 의 popstate 리스너는 우리 훅을 거치지 않고 목적지 이름의 navigation 루트를 연다.
  it("keeps a back navigation off the lounge in the stay until commit and marks a popstate navigation back onto it", async () => {
    const clock = fakeClock(1_000);
    const page = fakeWindow("/budget");
    sdk.makeFetchTransport.mockImplementation(() => ({ send: sdk.transportSend, flush: sdk.transportFlush }));
    const instrumentationModule = await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    clock.at(2_000);
    instrumentationModule.onRouterTransitionStart("/wedding/preparation-style", "push");
    commitPath(page, "/wedding/preparation-style");

    clock.at(6_000);
    page.value.location.pathname = "/budget";
    instrumentationModule.onRouterTransitionStart("https://hanbang.ai/budget", "traverse");
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledTimes(1);
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledWith("https://hanbang.ai/budget", "traverse");
    clock.at(6_400);
    commitPath(page, "/budget");
    clock.at(7_000);
    // 확정 전까지 라운지 화면에서 누른 것은 구간 안이다(주소가 이미 목적지여도).
    for (const startMs of [5_000, 6_000, 6_300]) {
      expect(options().beforeSendSpan?.(inpSpan(startMs, "h2#wc64-stmt-PLAN-A1.selected"))).toMatchObject({ description: "[redacted]", data: { transaction: "/wedding/preparation-style" } });
    }
    // 목적지 이동 기록 루트는 그대로 나간다. 확정 뒤 span 도 그대로다.
    const root = navigationRoot(6_000, "/budget");
    expect(options().beforeSendSpan?.(root)).toBe(root);
    const after = inpSpan(6_400, "button");
    expect(options().beforeSendSpan?.(after)).toBe(after);

    // 앞으로 가기로 라운지에 돌아온다. Sentry popstate 리스너가 연 라운지 이름의 이동 기록에는 표식이 붙고 봉투째 버려진다.
    clock.at(8_000);
    page.value.location.pathname = "/wedding/preparation-style";
    instrumentationModule.onRouterTransitionStart("https://hanbang.ai/wedding/preparation-style", "traverse");
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledTimes(1);
    const popstate = { ...navigationRoot(8_000, "/wedding/preparation-style"), trace_id: "8".repeat(32), span_id: "8".repeat(16) };
    clock.at(8_200);
    commitPath(page, "/wedding/preparation-style");
    clock.at(9_000);
    page.value.location.pathname = "/budget";
    const sent = options().beforeSendSpan?.(popstate);
    expect(sent).toMatchObject({ description: "[redacted]", data: { transaction: "/wedding/preparation-style" } });
    const transport = options().transport({ url: "https://synthetic.invalid/envelope", recordDroppedEvent: vi.fn() });
    expect(await transport.send([{ sent_at: "2026-10-16T00:00:00.000Z" }, [[{ type: "span" }, sent]]] as unknown as Envelope)).toEqual({});
    expect(sdk.transportSend).not.toHaveBeenCalled();
  });

  // 뒤로가기로 주소가 먼저 목적지가 되어도 확정 전까지는 라운지 화면이 남아 눌린다. 그 사이의 클릭 기록(선택자에 문항 id 와
  // 고른 상태가 실린다)과 오류는 지금 경로만 보면 일반 화면 것이라, 구간이 열려 있는 동안은 버린다. 확정 뒤에는 다시 나간다.
  it("drops click breadcrumbs and errors between a back navigation off the lounge and its route commit", async () => {
    const clock = fakeClock(1_000);
    const page = fakeWindow("/budget");
    sdk.makeFetchTransport.mockImplementation(() => ({ send: sdk.transportSend, flush: sdk.transportFlush }));
    const instrumentationModule = await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    clock.at(2_000);
    instrumentationModule.onRouterTransitionStart("/wedding/preparation-style", "push");
    commitPath(page, "/wedding/preparation-style");

    clock.at(6_000);
    page.value.location.pathname = "/budget";
    instrumentationModule.onRouterTransitionStart("https://hanbang.ai/budget", "traverse");
    clock.at(6_200);
    const transport = options().transport({ url: "https://synthetic.invalid/envelope", recordDroppedEvent: vi.fn() });
    const sendEvent = (item: unknown) => transport.send([{ sent_at: "2026-10-16T00:00:00.000Z" }, [[{ type: "event" }, item]]] as unknown as Envelope);
    const loungeClick = { category: "ui.click", message: "main > h2#wc64-stmt-PLAN-A1.selected" };
    const loungeError = { exception: { values: [{ type: "Error", value: "synthetic lounge error before commit" }] } };
    expect(options().beforeBreadcrumb(loungeClick)).toBeNull();
    expect(options().beforeSend(loungeError)).toBeNull();
    expect(await sendEvent(loungeError)).toEqual({});
    expect(scrub.breadcrumb).not.toHaveBeenCalled();
    expect(scrub.event).not.toHaveBeenCalled();
    expect(sdk.transportSend).not.toHaveBeenCalled();

    clock.at(6_400);
    commitPath(page, "/budget");
    const budgetClick = { category: "ui.click", message: "main > button.save" };
    const budgetError = { exception: { values: [{ type: "Error", value: "synthetic budget error after commit" }] } };
    expect(options().beforeBreadcrumb(budgetClick)).toBe(budgetClick);
    expect(options().beforeSend(budgetError)).toBe(budgetError);
    expect(scrub.breadcrumb).toHaveBeenCalledWith(budgetClick);
    expect(scrub.event).toHaveBeenCalledWith(budgetError);
    expect(await sendEvent(budgetError)).toEqual({ statusCode: 200 });
    expect(sdk.transportSend).toHaveBeenCalledTimes(1);
  });

  // SDK 가 아직 없을 때 같은 틈에서 난 창 오류는 버퍼에 담지 않는다. 담아 두면 SDK 가 올라오며 흘려보낸다.
  it("does not buffer window errors raised before the SDK loads between a back navigation off the lounge and its commit", async () => {
    fakeClock(1_000);
    const page = fakeWindow("/wedding/preparation-style");
    const instrumentationModule = await import("../../instrumentation-client");
    page.value.location.pathname = "/budget";
    instrumentationModule.onRouterTransitionStart("https://hanbang.ai/budget", "traverse");
    expect(page.value.addEventListener).toHaveBeenCalledWith("error", expect.any(Function));
    page.dispatch("error", { error: "synthetic lounge error before commit" });
    page.dispatch("unhandledrejection", { reason: "synthetic lounge rejection before commit" });
    // 확정보다 SDK 가 먼저 올라와도 흘려보낼 것이 없다.
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  // 에러 경계가 담아 두는 버퍼(clientErrorReport)는 경로를 담을 때의 주소로만 가른다. 열린 구간을 닫는 확정에서 비워야
  // 확정 전 라운지 화면의 오류가 SDK 가 붙을 때 나가지 않는다. 구간이 없는 일반 확정에서는 비우지 않는다.
  it("clears pending errors when the route commit closes an open lounge stay, and only then", async () => {
    fakeClock(1_000);
    const page = fakeWindow("/wedding/preparation-style");
    const instrumentationModule = await import("../../instrumentation-client");
    page.value.location.pathname = "/budget";
    instrumentationModule.onRouterTransitionStart("https://hanbang.ai/budget", "traverse");
    clientSink.clear.mockClear();
    commitPath(page, "/budget");
    expect(clientSink.clear).toHaveBeenCalledTimes(1);

    page.dispatch("error", { error: "synthetic budget error after commit" });
    clientSink.clear.mockClear();
    commitPath(page, "/landing");
    expect(clientSink.clear).not.toHaveBeenCalled();
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    expect(sdk.captureException.mock.calls).toEqual([["synthetic budget error after commit"]]);
  });

  // 라운지로 들어갈 때는 이동 기록을 열지 않으므로 앞 화면의 페이지 로드 기록이 라운지에 머무는 동안에도 이어질 수 있다.
  // 그 기록의 LCP·CLS 는 라운지 화면 것일 수 있으니 [시작, 끝] 이 머문 구간과 겹치면 버리고, 겹치지 않으면 그대로 보낸다.
  it("drops a pageload record that overlaps a lounge stay and sends one that does not", async () => {
    const clock = fakeClock(1_000);
    const page = fakeWindow("/budget");
    const instrumentationModule = await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    clock.at(2_000);
    instrumentationModule.onRouterTransitionStart("/wedding/preparation-style", "push");
    commitPath(page, "/wedding/preparation-style");
    clock.at(5_000);
    instrumentationModule.onRouterTransitionStart("/budget", "push");
    commitPath(page, "/budget");
    clock.at(9_000);
    const pageload = (startMs: number, endMs: number) => ({
      type: "transaction", transaction: "/budget",
      start_timestamp: (ORIGIN_MS + startMs) / 1000, timestamp: (ORIGIN_MS + endMs) / 1000,
      contexts: { trace: { op: "pageload", trace_id: "a".repeat(32), span_id: "a".repeat(16), data: { "lcp.element": "main > h2", "cls.source.1": "main > section" } } },
    });

    // 라운지 구간보다 먼저 시작해 구간 안에서 끝났거나 구간을 통째로 덮은 기록.
    for (const [startMs, endMs] of [[0, 2_000], [0, 3_000], [1_500, 8_000]]) {
      expect(options().beforeSendTransaction(pageload(startMs, endMs)), `${startMs}-${endMs}`).toBeNull();
    }
    expect(scrub.transaction).not.toHaveBeenCalled();
    // 구간 전에 끝났거나 구간을 닫은 tick 이후에 시작한 기록은 그대로 나간다.
    for (const [startMs, endMs] of [[0, 1_999], [5_000, 6_000]]) {
      const outside = pageload(startMs, endMs);
      expect(options().beforeSendTransaction(outside), `${startMs}-${endMs}`).toBe(outside);
      expect(scrub.transaction).toHaveBeenCalledWith(outside);
    }
  });

  // web vital 은 browserPerformanceTimeOrigin, 실시간 span(fetch·navigation)은 performance.timeOrigin 기준이다.
  // 잠자기 뒤처럼 timeOrigin 이 5분 넘게 어긋난 탭에서는 둘이 갈라진다. 어느 기준으로든 구간 안이면 구간 안이다.
  it("treats a span as on the lounge when either Sentry time base puts it inside the stay", async () => {
    let current = 1_000;
    const SKEWED_ORIGIN_MS = ORIGIN_MS + 400_000;
    vi.stubGlobal("performance", { now: () => current, timeOrigin: SKEWED_ORIGIN_MS });
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => ORIGIN_MS + current);
    cleanups.push(() => dateNow.mockRestore());
    const page = fakeWindow("/budget");
    const instrumentationModule = await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    current = 2_000;
    instrumentationModule.onRouterTransitionStart("/wedding/preparation-style", "push");
    commitPath(page, "/wedding/preparation-style");
    current = 8_000;
    instrumentationModule.onRouterTransitionStart("/budget", "push");
    commitPath(page, "/budget");
    current = 9_000;

    // web vital 기준(어긋난 timeOrigin 대신 Date 기반)으로 찍힌 라운지 INP.
    expect(options().beforeSendSpan?.(inpSpan(5_000, "h2#wc64-stmt-PLAN-A1"))).toMatchObject({ description: "[redacted]", data: { transaction: "/wedding/preparation-style" } });
    // 실시간 기준(어긋난 performance.timeOrigin)으로 찍힌 라운지 fetch span.
    const fetchOnLounge = {
      span_id: "9999999999999999", parent_span_id: "9".repeat(16), trace_id: "9".repeat(32), op: "http.client", description: "GET /api/synthetic",
      start_timestamp: (SKEWED_ORIGIN_MS + 5_000) / 1000, timestamp: (SKEWED_ORIGIN_MS + 5_050) / 1000, data: { "sentry.op": "http.client" },
    };
    expect(options().beforeSendSpan?.(fetchOnLounge)).toMatchObject({ description: "[redacted]", data: { transaction: "/wedding/preparation-style" } });
    // 두 기준 모두 구간 밖이면 그대로 나간다.
    const fetchAfter = { ...fetchOnLounge, start_timestamp: (SKEWED_ORIGIN_MS + 8_500) / 1000 };
    expect(options().beforeSendSpan?.(fetchAfter)).toBe(fetchAfter);
    const inpAfter = inpSpan(8_500, "button");
    expect(options().beforeSendSpan?.(inpAfter)).toBe(inpAfter);
  });

  it("redacts a delayed lounge span after leaving and the transport still drops its envelope", async () => {
    const page = fakeWindow("/landing");
    sdk.makeFetchTransport.mockImplementation(() => ({ send: sdk.transportSend, flush: sdk.transportFlush }));
    await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    page.value.location.pathname = "/budget";
    const delayed = {
      span_id: "1111111111111111", trace_id: "11111111111111111111111111111111",
      description: 'button[aria-label="SYNTHETIC-ANSWER"]',
      data: { "url.full": "https://hanbang.ai/wedding/preparation-style?view=previous#synthetic", "sentry.op": "ui.interaction.click" },
    };
    const sent = options().beforeSendSpan?.(delayed);
    expect(sent).not.toBeNull();
    expect(sent?.description).toBe("[redacted]");
    expect((sent?.data as Record<string, unknown>)["url.full"]).toBe("/wedding/preparation-style");
    expect(JSON.stringify(sent)).not.toMatch(/SYNTHETIC-ANSWER|view=previous|#synthetic/u);
    const transport = options().transport({ url: "https://synthetic.invalid/envelope", recordDroppedEvent: vi.fn() });
    const envelope = [{ sent_at: "2026-10-16T00:00:00.000Z" }, [[{ type: "span" }, sent]]] as unknown as Envelope;
    expect(await transport.send(envelope)).toEqual({});
    expect(sdk.transportSend).not.toHaveBeenCalled();
    const ordinary = { span_id: "1111111111111111", description: "body > button", data: { "url.full": "https://hanbang.ai/wedding/preparation-style-copy" } };
    expect(options().beforeSendSpan?.(ordinary)).toBe(ordinary);
  });

  it("drops nested Likert-origin URLs in arrays and cyclic event envelopes", async () => {
    const page = fakeWindow("/landing");
    await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    page.value.location.pathname = "/budget";
    const delayed: Record<string, unknown> = {
      context: { origins: [{ value: "/wedding-code#wc-likert=synthetic" }] },
    };
    delayed.cycle = delayed;
    expect(options().beforeSend(delayed)).toBeNull();
    expect(scrub.event).not.toHaveBeenCalled();
  });

  it("suppresses transitions into Likert and records only the ordinary destination when leaving", async () => {
    const page = fakeWindow("/landing");
    const instrumentationModule = await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    instrumentationModule.onRouterTransitionStart("/wedding-code-next#wc-likert=synthetic", "push");
    instrumentationModule.onRouterTransitionStart("https://hanbang.ai/wedding-code-next/result", "replace");
    instrumentationModule.onRouterTransitionStart("/wedding-code#wc-likert=synthetic", "push");
    instrumentationModule.onRouterTransitionStart("https://hanbang.ai/wedding-code/together", "replace");
    instrumentationModule.onRouterTransitionStart("/wedding/preparation-style?view=previous", "push");
    page.value.location.pathname = "/wedding/preparation-style";
    instrumentationModule.onRouterTransitionStart("/preparation-style", "replace");
    expect(sdk.captureRouterTransitionStart).not.toHaveBeenCalled();
    // 라운지에서 일반 화면으로 나갈 때는 목적지 이동 기록을 연다.
    instrumentationModule.onRouterTransitionStart("/budget", "push");
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledTimes(1);
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledWith("/budget", "push");
    sdk.captureRouterTransitionStart.mockClear();
    page.value.location.pathname = "/wedding-code";
    instrumentationModule.onRouterTransitionStart("/landing", "push");
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledWith("/landing", "push");
    sdk.captureRouterTransitionStart.mockClear();
    page.value.location.pathname = "/landing";
    instrumentationModule.onRouterTransitionStart("/wedding-code-next-copy", "push");
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledWith("/wedding-code-next-copy", "push");
  });

  it("recovers ordinary-page initialization once after direct Likert entry", async () => {
    const page = fakeWindow("/wedding-code");
    const instrumentationModule = await import("../../instrumentation-client");
    expect(page.value.requestIdleCallback).not.toHaveBeenCalled();
    instrumentationModule.onRouterTransitionStart("/landing", "push");
    page.value.location.pathname = "/landing";
    instrumentationModule.onRouterTransitionStart("/budget", "push");
    expect(page.value.requestIdleCallback).toHaveBeenCalledTimes(1);
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    instrumentationModule.onRouterTransitionStart("/budget", "push");
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledWith("/budget", "push");
  });

  it("recovers ordinary-page initialization once after a Likert navigation cancelled idle", async () => {
    const page = fakeWindow("/landing");
    const instrumentationModule = await import("../../instrumentation-client");
    page.value.location.pathname = "/wedding-code";
    page.runIdle();
    expect(sdk.init).not.toHaveBeenCalled();
    page.value.location.pathname = "/landing";
    instrumentationModule.onRouterTransitionStart("/landing", "push");
    instrumentationModule.onRouterTransitionStart("/budget", "push");
    expect(page.value.requestIdleCallback).toHaveBeenCalledTimes(2);
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
  });

  it("does not recover initialization for a Likert destination", async () => {
    const page = fakeWindow("/wedding-code");
    const instrumentationModule = await import("../../instrumentation-client");
    page.value.location.pathname = "/landing";
    instrumentationModule.onRouterTransitionStart("/wedding-code-next/result", "push");
    expect(page.value.requestIdleCallback).not.toHaveBeenCalled();
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it("blocks sessions and client reports at the actual transport boundary, including delayed answer envelopes", async () => {
    const page = fakeWindow("/landing");
    sdk.makeFetchTransport.mockImplementation(() => ({ send: sdk.transportSend, flush: sdk.transportFlush }));
    await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    const transport = options().transport({ url: "https://synthetic.invalid/envelope", recordDroppedEvent: vi.fn() });
    const session: Envelope = [{ event_id: "11111111111111111111111111111111", sent_at: "2026-10-09T00:00:00.000Z" }, [[{ type: "session" }, {
      sid: "11111111111111111111111111111111", init: true,
      timestamp: "2026-10-09T00:00:00.000Z", started: "2026-10-09T00:00:00.000Z",
      status: "ok", errors: 0,
    }]]];
    const clientReport: Envelope = [{ event_id: "11111111111111111111111111111111", sent_at: "2026-10-09T00:00:00.000Z" }, [[{ type: "client_report" }, { timestamp: 1791504000, discarded_events: [] }]]];
    for (const pathname of ["/wedding-code", "/wedding-code/together", "/wedding-code-next"]) {
      page.value.location.pathname = pathname;
      expect(await transport.send(session)).toEqual({});
      expect(await transport.send(clientReport)).toEqual({});
    }
    expect(sdk.transportSend).not.toHaveBeenCalled();
    page.value.location.pathname = "/budget";
    const delayed: Envelope = [{ event_id: "11111111111111111111111111111111", sent_at: "2026-10-09T00:00:00.000Z" }, [[{ type: "transaction" }, { contexts: { trace: {
      trace_id: "11111111111111111111111111111111", span_id: "1111111111111111",
      data: { "url.full": "/wedding-code#wc-likert=synthetic" },
    } } }]]];
    expect(await transport.send(delayed)).toEqual({});
    expect(sdk.transportSend).not.toHaveBeenCalled();
    expect(await transport.send(session)).toEqual({ statusCode: 200 });
    expect(sdk.transportSend).toHaveBeenCalledWith(session);
    expect(await transport.flush(1200)).toBe(true);
    expect(sdk.transportFlush).toHaveBeenCalledWith(1200);
  });

  it("checks the current route again before a recovered initialization runs", async () => {
    const page = fakeWindow("/wedding-code");
    const instrumentationModule = await import("../../instrumentation-client");
    page.value.location.pathname = "/landing";
    instrumentationModule.onRouterTransitionStart("/landing", "push");
    expect(page.value.requestIdleCallback).toHaveBeenCalledTimes(1);
    page.value.location.pathname = "/wedding-code";
    page.runIdle();
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it.each(["/landing", "/budget", "/wedding-code-copy", "/wedding-code-next-copy", "/preparation-style-copy", "/wedding/preparation-style-copy"])("preserves initialization, buffering and sanitizers on %s", async pathname => {
    const page = fakeWindow(pathname);
    const instrumentationModule = await import("../../instrumentation-client");
    page.dispatch("error", { error: "synthetic ordinary error" });
    page.dispatch("unhandledrejection", { reason: "synthetic ordinary rejection" });
    page.runIdle();
    await vi.waitFor(() => expect(clientSink.attach).toHaveBeenCalledTimes(1));
    expect(sdk.init.mock.invocationCallOrder[0]).toBeLessThan(clientSink.attach.mock.invocationCallOrder[0]);
    expect(sdk.captureException).toHaveBeenCalledWith("synthetic ordinary error");
    expect(sdk.captureException).toHaveBeenCalledWith("synthetic ordinary rejection");
    const synthetic = { message: "synthetic ordinary event" };
    expect(options().beforeSend(synthetic)).toBe(synthetic);
    expect(options().beforeSendTransaction(synthetic)).toBe(synthetic);
    expect(options().beforeBreadcrumb(synthetic)).toBe(synthetic);
    expect(scrub.event).toHaveBeenCalledWith(synthetic);
    expect(scrub.transaction).toHaveBeenCalledWith(synthetic);
    expect(scrub.breadcrumb).toHaveBeenCalledWith(synthetic);
    const span = { op: "ui.interaction.click", description: "body > button", data: { "sentry.op": "ui.interaction.click" } };
    expect(options().beforeSendSpan?.(span)).toBe(span);
    expect(scrub.span).toHaveBeenCalledWith(span);
    instrumentationModule.onRouterTransitionStart("/landing", "push");
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledWith("/landing", "push");
  });
});
