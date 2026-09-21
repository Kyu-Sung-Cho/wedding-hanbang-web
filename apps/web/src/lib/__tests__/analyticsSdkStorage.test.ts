import type { CaptureResult } from "posthog-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SYNTHETIC_ANSWER = "synthetic-private-answer-20260921";
const SYNTHETIC_PARTNER = "synthetic-private-partner-20260921";
const SYNTHETIC_LEGACY = "synthetic-previous-private-answer-20260921";

function storedText() {
  const entries = (storage: Storage) => Array.from(
    { length: storage.length },
    (_, index) => storage.getItem(storage.key(index) ?? ""),
  );
  return JSON.stringify([
    entries(window.localStorage), entries(window.sessionStorage),
    decodeURIComponent(document.cookie),
  ]);
}

describe("actual analytics SDK storage boundary", () => {
  let idle: (() => void) | undefined;
  let stopCapture: (() => void) | undefined;
  let destroySession: (() => void) | undefined;
  let beaconDescriptor: PropertyDescriptor | undefined;
  const requests: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T03:00:00Z"));
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_synthetic_sdk_storage_test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://analytics.example.invalid");
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => { idle = callback; return 1; });
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/landing");
    requests.length = 0;

    // SDK 네트워크 전송만 가로챈다. 초기화·전처리·저장·세션 코드는 실제 설치본을 쓴다.
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      requests.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return new Response(JSON.stringify({ hasFeatureFlags: true, featureFlags: {} }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));
    const open = XMLHttpRequest.prototype.open;
    vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(function (this: XMLHttpRequest, method, url) {
      requests.push(String(url));
      open.call(this, method, url, true);
    });
    vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => undefined);
    beaconDescriptor = Object.getOwnPropertyDescriptor(navigator, "sendBeacon");
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: (url: string | URL) => {
        requests.push(String(url));
        return true;
      },
    });
  });

  afterEach(() => {
    stopCapture?.();
    destroySession?.();
    vi.clearAllTimers();
    vi.restoreAllMocks();
    if (beaconDescriptor) Object.defineProperty(navigator, "sendBeacon", beaconDescriptor);
    else Reflect.deleteProperty(navigator, "sendBeacon");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    window.localStorage.clear();
    window.sessionStorage.clear();
    for (const cookie of document.cookie.split(";")) {
      document.cookie = `${cookie.split("=")[0].trim()}=; Max-Age=0; path=/`;
    }
    window.history.replaceState({}, "", "/");
  });

  it("keeps delayed landing events while preventing answer storage and flag requests", async () => {
    const legacy = JSON.stringify({
      distinct_id: "synthetic-old-browser",
      $initial_person_info: { u: `${window.location.origin}/wedding-code#a=${SYNTHETIC_LEGACY}`, r: "$direct" },
    });
    const sdkStorageKey = "ph_phc_synthetic_sdk_storage_test_posthog";
    window.localStorage.setItem(sdkStorageKey, legacy);
    window.sessionStorage.setItem(sdkStorageKey, legacy);
    document.cookie = `${sdkStorageKey}=${encodeURIComponent(legacy)}; path=/`;
    expect(storedText()).toContain(SYNTHETIC_LEGACY);
    const { default: sdk } = await import("posthog-js");
    const captured: CaptureResult[] = [];
    stopCapture = sdk.on("eventCaptured", (event: CaptureResult) => captured.push(event));
    const analytics = await import("../analytics");
    analytics.capturePageview({ $current_url: window.location.href });
    analytics.captureEvent("landing_cta_click", { source: "landing_hero_secondary" });
    window.history.replaceState({}, "", `/wedding-code#a=${SYNTHETIC_ANSWER}&b=${SYNTHETIC_PARTNER}`);
    expect(idle).toBeTypeOf("function");
    idle?.();
    expect(await analytics.loadPostHog()).toBe(sdk);
    destroySession = () => sdk.sessionManager?.destroy();
    analytics.captureWeddingCodeEvent("wedding_code_started", { version: "v1.2-code" });
    await Promise.resolve();

    expect(captured.map(({ event }) => event)).toEqual([
      "$pageview", "landing_cta_click", "wedding_code_started",
    ]);
    expect(captured[0].properties.$current_url).toBe(`${window.location.origin}/landing`);
    expect(captured[1].properties.source).toBe("landing_hero_secondary");
    expect(sdk.sessionManager).toBeDefined();
    const firstSession = sdk.sessionManager?.checkAndGetSessionAndWindowId().sessionId;
    expect(firstSession).toBeTruthy();

    // 최초 방문뿐 아니라 세션이 바뀔 때 SDK가 주소 요약을 다시 저장하는 경로도 확인한다.
    sdk.sessionManager?.resetSessionId();
    const nextSession = sdk.sessionManager?.checkAndGetSessionAndWindowId().sessionId;
    expect(nextSession).toBeTruthy();
    expect(nextSession).not.toBe(firstSession);
    sdk.reloadFeatureFlags();
    await vi.advanceTimersByTimeAsync(10);

    for (const secret of [SYNTHETIC_ANSWER, SYNTHETIC_PARTNER, SYNTHETIC_LEGACY]) {
      expect(storedText()).not.toContain(secret);
      expect(JSON.stringify(captured)).not.toContain(secret);
      expect(JSON.stringify(requests)).not.toContain(secret);
    }
    expect(requests.some((url) => new URL(url, window.location.origin).pathname.startsWith("/flags"))).toBe(false);
  });
});
