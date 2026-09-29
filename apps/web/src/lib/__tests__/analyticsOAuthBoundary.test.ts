import type { CaptureResult } from "posthog-js";
import { expect, it, vi } from "vitest";

it("actual SDK drops current and delayed OAuth pageviews and strips codes from nested properties", async () => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_synthetic_oauth_boundary");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://analytics.example.invalid");
  vi.stubGlobal("requestIdleCallback", (run: () => void) => { run(); return 1; });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => undefined);
  const captured: CaptureResult[] = [];
  let stop: (() => void) | undefined;
  let destroy: (() => void) | undefined;
  try {
    window.history.replaceState({}, "", "/login");
    const { default: sdk } = await import("posthog-js");
    stop = sdk.on("eventCaptured", (event: CaptureResult) => captured.push(event));
    const analytics = await import("../analytics");
    await analytics.loadPostHog();
    destroy = () => sdk.sessionManager?.destroy();
    analytics.capturePageview({ $current_url: window.location.href });
    await Promise.resolve();
    expect(captured).toHaveLength(1);
    captured.length = 0;

    const secret = "synthetic-pkce-secret";
    const callback = `/auth/mobile-callback?code=${secret}`;
    window.history.replaceState({}, "", callback);
    analytics.capturePageview({ $current_url: window.location.href });
    await Promise.resolve();
    expect(captured).toHaveLength(0);
    window.history.replaceState({}, "", "/login");
    analytics.capturePageview({ $current_url: `${window.location.origin}${callback}` });
    await Promise.resolve();
    expect(captured).toHaveLength(0);
    analytics.captureEvent("signup_started", { nested: { returnUrl: callback } });
    await Promise.resolve();
    expect(captured).toHaveLength(1);
    expect(JSON.stringify(captured)).not.toContain(secret);

    const draft = "synthetic-private-quote-draft";
    captured.length = 0;
    window.history.replaceState({}, "", `/wedding/community/post/write?body=${draft}&category=is_normal`);
    sdk.capture("$pageleave");
    expect(captured).toHaveLength(1);
    expect(JSON.stringify(captured)).not.toContain(draft);
    expect(captured[0].properties.$current_url).toBe(`${window.location.origin}/wedding/community/post/write?category=is_normal`);
  } finally {
    stop?.();
    destroy?.();
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  }
});
