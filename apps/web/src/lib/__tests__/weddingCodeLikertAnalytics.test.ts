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
  it.each(["/wedding-code", "/wedding-code/together", "/wedding-code-next", "/preparation-style", "/wedding/preparation-style"])("does not schedule or initialize PostHog on %s", async pathname => {
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

  it.each(["/wedding-code", "/wedding-code/result", "/wedding-code/together", "/wedding-code-next", "/wedding-code-next/result", "/preparation-style", "/wedding/preparation-style"])("drops a legacy funnel event on %s", async pathname => {
    const { beforeSend } = await actualBeforeSend(pathname);
    expect(beforeSend({ event: "wedding_code_started", properties: { version: "v4.4-depth", scene_total: 68 } })).toBeNull();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it.each(["/wedding-code", "/wedding-code-next", "/wedding/preparation-style"])("drops delayed allowlisted events with a nested %s answer URL", async pathname => {
    const { beforeSend } = await actualBeforeSend("/landing");
    const capture = { event: "wedding_code_started", properties: {
      version: "v4.4-depth", $set_once: { $initial_current_url: `https://hanbang.ai${pathname}#wc-likert=synthetic` },
    } };
    expect(beforeSend(capture)).toBeNull();
  });

  it.each(["/landing", "/budget", "/wedding-code-copy", "/wedding-code-next-copy", "/preparation-style-copy", "/wedding/preparation-style-copy"])("keeps the existing sanitizer on ordinary route %s", async pathname => {
    const { beforeSend } = await actualBeforeSend(pathname);
    const sent = beforeSend({ event: "wedding_code_started", properties: {
      version: "v4.4-depth", scene_total: 68, answers: "synthetic-private-answer",
    } });
    expect(sent).not.toBeNull();
    expect(sent?.properties).toEqual({ version: "v4.4-depth", scene_total: 68 });
  });

  // 2026-10-16 결정 D2: 라운지의 '이전에 계정에 저장한 답 보기'(?view=previous)도 같은 경로라 함께 꺼진다.
  it("drops events whose current URL is the lounge previous-answers view", async () => {
    const { page, beforeSend } = await actualBeforeSend("/budget");
    // 같은 이벤트가 비슷한 다른 주소에서는 살아 나가야 차단이 주소 때문임을 안다.
    const started = (url: string) => ({ event: "wedding_code_started", properties: { version: "v4.4-depth", scene_total: 68, $current_url: url } });
    for (const url of ["https://hanbang.ai/wedding/preparation-style?view=previous", "/preparation-style?view=previous"]) {
      expect(beforeSend(started(url))).toBeNull();
    }
    expect(beforeSend(started("https://hanbang.ai/wedding/preparation-style-copy?view=previous"))).not.toBeNull();
    page.location.pathname = "/wedding/preparation-style";
    expect(beforeSend({ event: "wedding_code_started", properties: { version: "v3.1-preferences" } })).toBeNull();
  });

  it("blocks a delayed landing exception when its URL embeds a WeddingCode query answer", async () => {
    const { beforeSend } = await actualBeforeSend("/budget");
    const redirect = `/login?${new URLSearchParams({ redirect: "/wedding-code?v=v4.0-tendency&a=synthetic-private-answer" })}`;
    expect(beforeSend({ event: "landing_cta_click", properties: { $current_url: redirect, source: "landing_hero_secondary" } })).toBeNull();
  });
});
