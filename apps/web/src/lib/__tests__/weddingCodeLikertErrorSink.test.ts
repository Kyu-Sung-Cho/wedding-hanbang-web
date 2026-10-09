import { afterEach, describe, expect, it, vi } from "vitest";
import { attachClientErrorSink, reportClientError, resetClientErrorSinkForTest } from "../observability/clientErrorReport";

const sdk = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), captureRouterTransitionStart: vi.fn() }));
vi.mock("@sentry/nextjs", () => sdk);

afterEach(() => {
  resetClientErrorSinkForTest();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

function fakeWindow(pathname: string) {
  let idle: (() => void) | undefined;
  const value = {
    location: { pathname, hostname: "127.0.0.1" },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    requestIdleCallback: vi.fn((run: () => void) => { idle = run; }),
  };
  vi.stubGlobal("window", value);
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://synthetic.invalid/zero-transmission");
  return { value, runIdle: () => idle?.() };
}

describe("actual unmocked Likert client error sink", () => {
  it("does not create a raw window sink on direct Likert error reporting or attachment", () => {
    const page = fakeWindow("/wedding-code-next");
    const capture = vi.fn();
    reportClientError(new Error("synthetic Likert boundary error"));
    expect("__hanbangClientErrorSink" in page.value).toBe(false);
    attachClientErrorSink(capture);
    expect("__hanbangClientErrorSink" in page.value).toBe(false);
    expect(capture).not.toHaveBeenCalled();
  });

  it("clears an existing buffer when a new error is reported on Likert", () => {
    const page = fakeWindow("/landing");
    reportClientError(new Error("synthetic pending ordinary error"));
    page.value.location.pathname = "/wedding-code-next/result";
    reportClientError(new Error("synthetic Likert boundary error"));
    page.value.location.pathname = "/landing";
    const capture = vi.fn();
    attachClientErrorSink(capture);
    expect(capture).not.toHaveBeenCalled();
  });

  it("does not flush an existing buffer when the sink attaches on Likert", () => {
    const page = fakeWindow("/landing");
    reportClientError(new Error("synthetic pending ordinary error"));
    page.value.location.pathname = "/wedding-code-next";
    const capture = vi.fn();
    attachClientErrorSink(capture);
    expect(capture).not.toHaveBeenCalled();
    page.value.location.pathname = "/landing";
    attachClientErrorSink(capture);
    expect(capture).not.toHaveBeenCalled();
  });

  it("does not retain real boundary errors when navigation enters Likert during SDK import", async () => {
    const page = fakeWindow("/landing");
    await import("../../instrumentation-client");
    page.runIdle();
    page.value.location.pathname = "/wedding-code-next";
    reportClientError(new Error("synthetic in-flight Likert error"));
    await vi.waitFor(() => expect(page.value.removeEventListener).toHaveBeenCalledTimes(2));
    expect(sdk.init).not.toHaveBeenCalled();
    page.value.location.pathname = "/landing";
    const capture = vi.fn();
    attachClientErrorSink(capture);
    expect(capture).not.toHaveBeenCalled();
  });

  it.each(["/landing", "/wedding-code", "/wedding-code-next-copy"])("preserves ordinary buffering and attachment on %s", pathname => {
    fakeWindow(pathname);
    const error = Object.assign(new Error("synthetic ordinary boundary error"), { digest: "synthetic" });
    const capture = vi.fn();
    reportClientError(error);
    attachClientErrorSink(capture);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(error, { digest: "synthetic" });
  });
});
