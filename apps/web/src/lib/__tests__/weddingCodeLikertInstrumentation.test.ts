import { afterEach, describe, expect, it, vi } from "vitest";

type SentryHook = (value: Record<string, unknown>) => Record<string, unknown> | null;
interface SentryOptions {
  beforeSend: SentryHook;
  beforeSendTransaction: SentryHook;
  beforeBreadcrumb: SentryHook;
}
type ClientErrorSink = (error: unknown, context: { digest?: string }) => void;
type BufferedEvent = { error?: unknown; message?: string; reason?: unknown };
type BufferListener = (event: BufferedEvent) => void;

const sdk = vi.hoisted(() => ({
  init: vi.fn((options: SentryOptions) => { void options; }),
  captureException: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}));
const clientSink = vi.hoisted(() => ({ attach: vi.fn((sink: ClientErrorSink) => { void sink; }), clear: vi.fn() }));
const scrub = vi.hoisted(() => ({
  event: vi.fn((value: unknown) => value),
  transaction: vi.fn((value: unknown) => value),
  breadcrumb: vi.fn((value: unknown) => value),
}));
vi.mock("@sentry/nextjs", () => sdk);
vi.mock("../observability/clientErrorReport", () => ({ attachClientErrorSink: clientSink.attach, clearBufferedClientErrors: clientSink.clear }));
vi.mock("@hanbang/shared", () => ({
  sanitizeSentryEvent: scrub.event,
  sanitizeSentryTransaction: scrub.transaction,
  sanitizeSentryBreadcrumb: scrub.breadcrumb,
}));

afterEach(() => {
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

function options(): SentryOptions {
  const current = sdk.init.mock.calls[0]?.[0];
  if (!current) throw new Error("Ordinary-page Sentry initialization did not finish");
  return current;
}

describe("Likert Sentry boundary", () => {
  it.each(["/wedding-code-next", "/wedding-code-next/result"])("does not initialize or buffer errors on direct entry to %s", async pathname => {
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
    page.value.location.pathname = "/wedding-code-next/result";
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
    page.value.location.pathname = "/wedding-code-next";
    await vi.waitFor(() => expect(page.value.removeEventListener).toHaveBeenCalledTimes(2));
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it("drops events, transactions, breadcrumbs and boundary errors after an initialized SDK enters Likert", async () => {
    const page = fakeWindow("/landing");
    await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(clientSink.attach).toHaveBeenCalledTimes(1));
    page.value.location.pathname = "/wedding-code-next";
    const synthetic = { request: { url: "http://127.0.0.1/wedding-code-next#wc-likert=synthetic" } };
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
      expect(options()[hook](legacy)).toBe(legacy);
    },
  );

  it("drops nested Likert-origin URLs in arrays and cyclic event envelopes", async () => {
    const page = fakeWindow("/landing");
    await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    page.value.location.pathname = "/budget";
    const delayed: Record<string, unknown> = {
      context: { origins: [{ value: "/wedding-code-next#wc-likert=synthetic" }] },
    };
    delayed.cycle = delayed;
    expect(options().beforeSend(delayed)).toBeNull();
    expect(scrub.event).not.toHaveBeenCalled();
  });

  it("suppresses router transitions on Likert and transitions whose destination is Likert", async () => {
    const page = fakeWindow("/landing");
    const instrumentationModule = await import("../../instrumentation-client");
    page.runIdle();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    instrumentationModule.onRouterTransitionStart("/wedding-code-next#wc-likert=synthetic", "push");
    instrumentationModule.onRouterTransitionStart("https://hanbang.ai/wedding-code-next/result", "replace");
    page.value.location.pathname = "/wedding-code-next";
    instrumentationModule.onRouterTransitionStart("/landing", "push");
    expect(sdk.captureRouterTransitionStart).not.toHaveBeenCalled();
    page.value.location.pathname = "/landing";
    instrumentationModule.onRouterTransitionStart("/wedding-code-next-copy", "push");
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledWith("/wedding-code-next-copy", "push");
  });

  it("recovers ordinary-page initialization once after direct Likert entry", async () => {
    const page = fakeWindow("/wedding-code-next");
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
    page.value.location.pathname = "/wedding-code-next";
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
    const page = fakeWindow("/wedding-code-next");
    const instrumentationModule = await import("../../instrumentation-client");
    page.value.location.pathname = "/landing";
    instrumentationModule.onRouterTransitionStart("/wedding-code-next/result", "push");
    expect(page.value.requestIdleCallback).not.toHaveBeenCalled();
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it("checks the current route again before a recovered initialization runs", async () => {
    const page = fakeWindow("/wedding-code-next");
    const instrumentationModule = await import("../../instrumentation-client");
    page.value.location.pathname = "/landing";
    instrumentationModule.onRouterTransitionStart("/landing", "push");
    expect(page.value.requestIdleCallback).toHaveBeenCalledTimes(1);
    page.value.location.pathname = "/wedding-code-next";
    page.runIdle();
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it.each(["/landing", "/wedding-code", "/wedding-code-next-copy"])("preserves initialization, buffering and sanitizers on %s", async pathname => {
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
    instrumentationModule.onRouterTransitionStart("/landing", "push");
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledWith("/landing", "push");
  });
});
