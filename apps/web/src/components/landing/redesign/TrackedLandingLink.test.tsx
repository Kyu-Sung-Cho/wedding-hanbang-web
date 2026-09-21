import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { START_HERE_DATE_HANDOFF_KEY } from "@/lib/marketing/startHereDateHandoff";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ captureEvent: vi.fn() }));

vi.mock("@/lib/analytics", () => ({ captureEvent: mocks.captureEvent }));

import TrackedLandingLink from "./TrackedLandingLink";
import LandingHeader from "./LandingHeader";
import AvailableNowSection from "./AvailableNowSection";

describe("TrackedLandingLink", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("drops a stale landing date before header or closing date-less entry", async () => {
    window.sessionStorage.setItem(START_HERE_DATE_HANDOFF_KEY, "2027-05-01");

    await act(async () => {
      root.render(
        <TrackedLandingLink href="/start-here" source="landing_header">
          아모라와 시작하기
        </TrackedLandingLink>,
      );
    });

    const link = container.querySelector("a");
    link?.addEventListener("click", (event) => event.preventDefault());
    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(window.sessionStorage.getItem(START_HERE_DATE_HANDOFF_KEY)).toBeNull();
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "landing_cta_click",
      { source: "landing_header" },
    );
  });

  it("distinguishes WeddingCode desktop, mobile, and tool-card clicks from signup", async () => {
    await act(async () => {
      root.render(<><LandingHeader /><AvailableNowSection /></>);
    });
    const links = [...container.querySelectorAll('a[href="/wedding-code"]')];
    expect(links).toHaveLength(3);
    for (const link of links) {
      link.addEventListener("click", (event) => event.preventDefault());
      await act(async () => {
        link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
    }
    expect(mocks.captureEvent.mock.calls).toEqual([
      ["landing_cta_click", { source: "landing_header_wedding_code" }],
      ["landing_cta_click", { source: "landing_mobile_wedding_code" }],
      ["landing_cta_click", { source: "landing_now_wedding_code" }],
    ]);
    const signup = container.querySelector('a[href="/login?mode=signup"]');
    expect(signup).not.toBeNull();
    signup?.addEventListener("click", (event) => event.preventDefault());
    await act(async () => {
      signup?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(mocks.captureEvent).toHaveBeenLastCalledWith("landing_cta_click", { source: "landing_header" });
  });
});
