import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_key");
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
    vi.unstubAllEnvs();
  });

  async function renderProvider() {
    const { default: AnalyticsProvider } = await import("./AnalyticsProvider");
    await act(async () => {
      root.render(<AnalyticsProvider />);
      await Promise.resolve();
    });
  }

  it("does not send preview pageviews and resumes on the ordinary vendor route", async () => {
    await renderProvider();

    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();

    mocks.searchParams = new URLSearchParams();
    await renderProvider();

    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: `${window.location.origin}/wedding/vendors`,
    });
  });
});
