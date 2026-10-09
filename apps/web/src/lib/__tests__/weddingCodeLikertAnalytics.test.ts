import { afterEach, describe, expect, it, vi } from "vitest";

type Capture = { event?: string; properties?: Record<string, unknown> };
type MockPostHogOptions = { before_send: (capture: Capture) => Capture | null };
const posthog = vi.hoisted(() => ({
  init: vi.fn((key: string, options: MockPostHogOptions) => { void key; void options; }),
  capture: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: posthog }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
});

async function actualBeforeSend(pathname: string) {
  let idle: (() => void) | undefined;
  const page = { location: { pathname: "/landing", origin: "https://hanbang.ai" },
    requestIdleCallback: (run: () => void) => { idle = run; } };
  vi.stubGlobal("window", page);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "synthetic-no-network");
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-09T00:00:00.000Z"));
  const analyticsModule = await import("../analytics");
  const loaded = analyticsModule.loadPostHog();
  idle?.();
  await loaded;
  const options = posthog.init.mock.calls[0]?.[1];
  if (!options) throw new Error("The actual analytics hook was not initialized");
  page.location.pathname = pathname;
  return { page, beforeSend: options.before_send };
}

describe("Likert boundary before actual analytics allowlists", () => {
  it("does not schedule or initialize PostHog when the actual loader is called on Likert", async () => {
    const requestIdleCallback = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/wedding-code-next", origin: "https://hanbang.ai" }, requestIdleCallback });
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "synthetic-no-network");
    const analyticsModule = await import("../analytics");
    const loaded = analyticsModule.loadPostHog();
    expect(requestIdleCallback).not.toHaveBeenCalled();
    expect(await loaded).toBeNull();
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it.each(["before idle", "during import"])("cancels a pending PostHog load %s and allows an ordinary-page retry", async stage => {
    let idle: (() => void) | undefined;
    const page = { location: { pathname: "/budget", origin: "https://hanbang.ai" },
      requestIdleCallback: vi.fn((run: () => void) => { idle = run; }) };
    vi.stubGlobal("window", page);
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "synthetic-no-network");
    const analyticsModule = await import("../analytics");
    const pending = analyticsModule.loadPostHog();
    if (stage === "during import") idle?.();
    page.location.pathname = "/wedding-code-next";
    if (stage === "before idle") idle?.();
    expect(await pending).toBeNull();
    expect(posthog.init).not.toHaveBeenCalled();
    page.location.pathname = "/budget";
    const retry = analyticsModule.loadPostHog();
    expect(page.requestIdleCallback).toHaveBeenCalledTimes(2);
    idle?.();
    expect(await retry).toBe(posthog);
    expect(posthog.init).toHaveBeenCalledTimes(1);
  });

  it.each(["/wedding-code-next", "/wedding-code-next/result"])("drops a legacy funnel event on %s", async pathname => {
    const { beforeSend } = await actualBeforeSend(pathname);
    expect(beforeSend({ event: "wedding_code_started", properties: { version: "v4.4-depth", scene_total: 68 } })).toBeNull();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("drops delayed allowlisted events that still contain a nested Likert answer URL", async () => {
    const { beforeSend } = await actualBeforeSend("/landing");
    const capture = { event: "wedding_code_started", properties: {
      version: "v4.4-depth", $set_once: { $initial_current_url: "https://hanbang.ai/wedding-code-next#wc-likert=synthetic" },
    } };
    expect(beforeSend(capture)).toBeNull();
  });

  it.each(["/wedding-code", "/wedding-code/result", "/landing", "/wedding-code-next-copy"])("keeps the existing authorized v4 funnel sanitizer on %s", async pathname => {
    const { beforeSend } = await actualBeforeSend(pathname);
    const sent = beforeSend({ event: "wedding_code_started", properties: {
      version: "v4.4-depth", scene_total: 68, answers: "synthetic-private-answer",
    } });
    expect(sent).not.toBeNull();
    expect(sent?.properties).toEqual({ version: "v4.4-depth", scene_total: 68 });
  });
});
