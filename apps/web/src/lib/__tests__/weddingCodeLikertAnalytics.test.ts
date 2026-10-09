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
  it.each(["/wedding-code", "/wedding-code/together", "/wedding-code-next"])("does not schedule or initialize PostHog on %s", async pathname => {
    const requestIdleCallback = vi.fn();
    vi.stubGlobal("window", { location: { pathname, origin: "https://hanbang.ai" }, requestIdleCallback });
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
    page.location.pathname = "/wedding-code";
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

  it.each(["/wedding-code", "/wedding-code/result", "/wedding-code/together", "/wedding-code-next", "/wedding-code-next/result"])("drops a legacy funnel event on %s", async pathname => {
    const { beforeSend } = await actualBeforeSend(pathname);
    expect(beforeSend({ event: "wedding_code_started", properties: { version: "v4.4-depth", scene_total: 68 } })).toBeNull();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it.each(["/wedding-code", "/wedding-code-next"])("drops delayed allowlisted events with a nested %s answer URL", async pathname => {
    const { beforeSend } = await actualBeforeSend("/landing");
    const capture = { event: "wedding_code_started", properties: {
      version: "v4.4-depth", $set_once: { $initial_current_url: `https://hanbang.ai${pathname}#wc-likert=synthetic` },
    } };
    expect(beforeSend(capture)).toBeNull();
  });

  it.each(["/landing", "/budget", "/wedding-code-copy", "/wedding-code-next-copy"])("keeps the existing sanitizer on ordinary route %s", async pathname => {
    const { beforeSend } = await actualBeforeSend(pathname);
    const sent = beforeSend({ event: "wedding_code_started", properties: {
      version: "v4.4-depth", scene_total: 68, answers: "synthetic-private-answer",
    } });
    expect(sent).not.toBeNull();
    expect(sent?.properties).toEqual({ version: "v4.4-depth", scene_total: 68 });
  });

  it("blocks a delayed landing exception when its URL embeds a WeddingCode query answer", async () => {
    const { beforeSend } = await actualBeforeSend("/budget");
    const redirect = `/login?${new URLSearchParams({ redirect: "/wedding-code?v=v4.0-tendency&a=synthetic-private-answer" })}`;
    expect(beforeSend({ event: "landing_cta_click", properties: { $current_url: redirect, source: "landing_hero_secondary" } })).toBeNull();
  });
});
