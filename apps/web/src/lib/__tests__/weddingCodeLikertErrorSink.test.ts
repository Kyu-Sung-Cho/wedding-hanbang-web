import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isWeddingCodeLikertPath } from "../analyticsPrivacy";
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
  it.each(["/wedding-code", "/wedding-code/together", "/wedding-code-next", "/wedding-code-next/result", "/preparation-style", "/wedding/preparation-style"])("does not create a raw window sink on direct error reporting or attachment on %s", pathname => {
    const page = fakeWindow(pathname);
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
    page.value.location.pathname = "/wedding-code/result";
    reportClientError(new Error("synthetic Likert boundary error"));
    page.value.location.pathname = "/landing";
    const capture = vi.fn();
    attachClientErrorSink(capture);
    expect(capture).not.toHaveBeenCalled();
  });

  it("does not flush an existing buffer when the sink attaches on Likert", () => {
    const page = fakeWindow("/landing");
    reportClientError(new Error("synthetic pending ordinary error"));
    page.value.location.pathname = "/wedding-code";
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
    page.value.location.pathname = "/wedding-code";
    reportClientError(new Error("synthetic in-flight Likert error"));
    await vi.waitFor(() => expect(page.value.removeEventListener).toHaveBeenCalledTimes(2));
    expect(sdk.init).not.toHaveBeenCalled();
    page.value.location.pathname = "/landing";
    const capture = vi.fn();
    attachClientErrorSink(capture);
    expect(capture).not.toHaveBeenCalled();
  });

  // 에러 경계 쪽 목록은 import 없이 쓰려고 `analyticsPrivacy.ts` 목록을 베껴 둔 것이다. 한쪽에만 경로를 더하면
  // 다른 쪽이 그 화면의 오류를 담아 두거나 버린다. 두 파일의 목록을 읽어 합친 표로 두 판정을 나란히 돌린다.
  it("keeps the boundary copy of the protected path list identical to analyticsPrivacy", () => {
    const prefixesIn = (relative: string) => {
      const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), relative), "utf8");
      const body = source.match(/function isWeddingCodeLikertPath\([\s\S]*?\n\}/u)?.[0] ?? "";
      const list = body.match(/\[((?:\s*"[^"]+"\s*,?)+)\]\.some\(/u)?.[1] ?? "";
      return [...list.matchAll(/"([^"]+)"/gu)].map(match => match[1]).sort();
    };
    const analytics = prefixesIn("../analyticsPrivacy.ts");
    const boundary = prefixesIn("../observability/clientErrorReport.ts");
    expect(analytics.length).toBeGreaterThan(0);
    expect(boundary).toEqual(analytics);

    const table = new Set<string>(["/", "/landing", "/budget", "/wedding", "/wedding/budget", "/invite", "/login"]);
    for (const prefix of new Set([...analytics, ...boundary])) {
      for (const pathname of [prefix, `${prefix}/`, `${prefix}/result`, `${prefix}-copy`, `${prefix}s`, prefix.toUpperCase()]) table.add(pathname);
    }
    for (const pathname of table) {
      resetClientErrorSinkForTest();
      const page = fakeWindow(pathname);
      const capture = vi.fn();
      reportClientError(new Error("synthetic boundary error"));
      attachClientErrorSink(capture);
      const boundaryProtects = !("__hanbangClientErrorSink" in page.value) && capture.mock.calls.length === 0;
      expect(boundaryProtects, pathname).toBe(isWeddingCodeLikertPath(pathname));
    }
  });

  it.each(["/landing", "/budget", "/wedding-code-copy", "/wedding-code-next-copy", "/preparation-style-copy", "/wedding/preparation-style-copy"])("preserves ordinary buffering and attachment on %s", pathname => {
    fakeWindow(pathname);
    const error = Object.assign(new Error("synthetic ordinary boundary error"), { digest: "synthetic" });
    const capture = vi.fn();
    reportClientError(error);
    attachClientErrorSink(capture);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(error, { digest: "synthetic" });
  });
});
