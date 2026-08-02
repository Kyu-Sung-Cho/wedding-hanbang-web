import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THIRD_PARTY_ANALYTICS_CONSENT_KEY } from "@/lib/analyticsPrivacy";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  pathname: "/wedding/vendors",
  searchParams: new URLSearchParams("preview=1"),
  init: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("posthog-js", () => ({
  default: {
    init: mocks.init,
    capture: mocks.capture,
  },
}));

describe("AnalyticsProvider admin preview boundary", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    // posthog-js는 초기 번들에서 빼려고 유휴 시점에 동적 로드한다.
    // 테스트에서는 유휴 콜백을 즉시 실행해 그 지연만 걷어낸다.
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => {
      cb();
      return 0;
    });
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_key");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENABLED", "true");
    window.localStorage.setItem(THIRD_PARTY_ANALYTICS_CONSENT_KEY, "granted");
    mocks.pathname = "/wedding/vendors";
    mocks.searchParams = new URLSearchParams("preview=1");
    mocks.init.mockReset();
    mocks.capture.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    window.localStorage.clear();
    vi.unstubAllEnvs();
  });

  async function renderProvider() {
    const { default: AnalyticsProvider } = await import("./AnalyticsProvider");
    await act(async () => {
      root.render(<AnalyticsProvider />);
      // 동적 import 프라미스 체인이 풀릴 때까지 마이크로태스크를 비운다.
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
  }

  it("does not send preview pageviews and resumes on the ordinary vendor route", async () => {
    await renderProvider();

    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();

    mocks.searchParams = new URLSearchParams();
    await renderProvider();

    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.init).toHaveBeenCalledWith(
      "phc_test_key",
      expect.objectContaining({
        autocapture: false,
        capture_pageleave: false,
        capture_pageview: false,
        disable_external_dependency_loading: true,
        disable_session_recording: true,
        disable_surveys: true,
        advanced_disable_flags: true,
        mask_personal_data_properties: true,
        persistence: "memory",
        person_profiles: "never",
        respect_dnt: true,
        save_campaign_params: false,
        save_referrer: false,
        before_send: expect.any(Function),
      }),
    );
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: `${window.location.origin}/wedding/vendors`,
    });
  });

  it("never sends query or fragment data in pageviews", async () => {
    mocks.pathname = "/community/post/write";
    mocks.searchParams = new URLSearchParams("title=private-title&body=private-body");

    await renderProvider();

    expect(mocks.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: `${window.location.origin}/community/post/write`,
    });
    expect(JSON.stringify(mocks.capture.mock.calls)).not.toContain("private-title");
    expect(JSON.stringify(mocks.capture.mock.calls)).not.toContain("private-body");
  });

  it("does not initialize from an environment key without an explicit browser grant", async () => {
    window.localStorage.removeItem(THIRD_PARTY_ANALYTICS_CONSENT_KEY);
    mocks.pathname = "/landing";
    mocks.searchParams = new URLSearchParams();

    await renderProvider();

    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("redacts WeddingCode answers and auth secrets at the final PostHog boundary", async () => {
    mocks.pathname = "/landing";
    mocks.searchParams = new URLSearchParams();
    await renderProvider();

    const config = mocks.init.mock.calls[0]?.[1] as {
      before_send: (event: {
        event: string;
        properties: Record<string, string>;
      }) => { event: string; properties: Record<string, string> } | null;
    };
    const sanitized = config.before_send({
      event: "$pageview",
      properties: {
        $current_url: "https://hanbang.ai/wedding-code?a=AAAAAAAAAAAAAAAA&b=BBBBBBBBBBBBBBBB",
        callback: "https://hanbang.ai/reset-password#access_token=secret&refresh_token=secret2",
      },
    });

    expect(sanitized?.properties.$current_url).toBe("https://hanbang.ai/wedding-code");
    expect(sanitized?.properties.callback).not.toContain("secret");
  });
});
