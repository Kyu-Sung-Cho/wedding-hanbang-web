// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/wedding-code-next" }));
const posthog = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn() }));
const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), captureRouterTransitionStart: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams("utm_source=synthetic"),
}));
vi.mock("posthog-js", () => ({ default: posthog }));
vi.mock("@sentry/nextjs", () => sentry);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
  navigation.pathname = "/wedding-code-next";
});

it.each(["/wedding-code-next", "/landing"])(
  "recovers Sentry after idle runs before the ordinary pathname commit from %s without a PostHog key",
  async initialPath => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://synthetic.invalid/zero-transmission");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let idle: (() => void) | undefined;
    const schedule = vi.fn((run: () => void) => { idle = run; });
    Object.defineProperty(window, "requestIdleCallback", { configurable: true, value: schedule });
    navigation.pathname = initialPath;
    window.history.replaceState({}, "", initialPath);
    const instrumentationModule = await import("../../instrumentation-client");
    const Provider = (await import("../../components/analytics/AnalyticsProvider")).default;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const initialIdleCount = initialPath === "/landing" ? 1 : 0;
    try {
      await act(async () => { root.render(createElement(Provider)); });
      expect(schedule).toHaveBeenCalledTimes(initialIdleCount);
      navigation.pathname = "/wedding-code-next";
      window.history.replaceState({}, "", "/wedding-code-next#wc-likert=synthetic");
      await act(async () => { root.render(createElement(Provider)); });
      if (initialIdleCount) idle?.();
      expect(sentry.init).not.toHaveBeenCalled();
      instrumentationModule.onRouterTransitionStart("/landing", "push");
      expect(schedule).toHaveBeenCalledTimes(initialIdleCount + 1);
      idle?.();
      expect(sentry.init).not.toHaveBeenCalled();
      navigation.pathname = "/landing";
      window.history.replaceState({}, "", "/landing");
      await act(async () => { root.render(createElement(Provider)); });
      await act(async () => { root.render(createElement(Provider)); });
      expect(schedule).toHaveBeenCalledTimes(initialIdleCount + 2);
      idle?.();
      await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(1));
      expect(posthog.init).not.toHaveBeenCalled();
      expect(posthog.capture).not.toHaveBeenCalled();
    } finally {
      await act(async () => { root.unmount(); });
      container.remove();
      Reflect.deleteProperty(window, "requestIdleCallback");
    }
  },
);

it("keeps the actual provider quiet on Likert and resumes ordinary pageviews", async () => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "synthetic-no-network");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let idle: (() => void) | undefined;
  const schedule = vi.fn((run: () => void) => { idle = run; });
  Object.defineProperty(window, "requestIdleCallback", { configurable: true, value: schedule });
  window.history.replaceState({}, "", "/wedding-code-next#wc-likert=synthetic");
  const Provider = (await import("../../components/analytics/AnalyticsProvider")).default;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(Provider)); });
    expect(schedule).not.toHaveBeenCalled();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    navigation.pathname = "/budget";
    window.history.replaceState({}, "", "/budget");
    await act(async () => { root.render(createElement(Provider)); });
    expect(schedule).toHaveBeenCalledTimes(1);
    idle?.();
    await vi.waitFor(() => expect(posthog.capture).toHaveBeenCalledTimes(1));
    expect(posthog.capture).toHaveBeenCalledWith("$pageview", { $current_url: window.location.origin + "/budget?utm_source=synthetic" });
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    Reflect.deleteProperty(window, "requestIdleCallback");
  }
});
