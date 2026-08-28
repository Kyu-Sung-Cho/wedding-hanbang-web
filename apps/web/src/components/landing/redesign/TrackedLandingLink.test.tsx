import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { START_HERE_DATE_HANDOFF_KEY } from "@/lib/marketing/startHereDateHandoff";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ captureEvent: vi.fn() }));

vi.mock("@/lib/analytics", () => ({ captureEvent: mocks.captureEvent }));

import TrackedLandingLink from "./TrackedLandingLink";

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
});
