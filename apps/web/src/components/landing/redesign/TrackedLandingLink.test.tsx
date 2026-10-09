import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { START_HERE_DATE_HANDOFF_KEY } from "@/lib/marketing/startHereDateHandoff";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ captureEvent: vi.fn() }));

vi.mock("@/lib/analytics", () => ({ captureEvent: mocks.captureEvent }));
// 세션 확인 전 SSR의 중립 라벨과 로그인 변화는 LandingSession.test.tsx가 검사한다.
// 이 파일은 확인된 비로그인 CTA를 눌렀을 때의 계측을 검사한다.
vi.mock("./LandingSession", () => ({
  default: ({ children }: { children: ReactNode }) => children,
  useLandingSession: () => "signed_out",
}));

import TrackedLandingLink from "./TrackedLandingLink";
import LandingHeader from "./LandingHeader";
import AvailableNowSection from "./AvailableNowSection";
import TransformationHero from "./TransformationHero";

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

  it("distinguishes hero and tool-card WeddingCode clicks from verified signed-out desktop and mobile Amora entry", async () => {
    await act(async () => {
      root.render(<><LandingHeader /><TransformationHero /><AvailableNowSection /></>);
    });
    const links = [...container.querySelectorAll('a[href="/wedding-code"]')];
    expect(links).toHaveLength(2);
    for (const link of links) {
      link.addEventListener("click", (event) => event.preventDefault());
      await act(async () => {
        link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
    }
    expect(mocks.captureEvent.mock.calls).toEqual([
      ["landing_cta_click", { source: "landing_hero_secondary" }],
      ["landing_cta_click", { source: "landing_now_wedding_code" }],
    ]);
    const amoraEntries = [...container.querySelectorAll('a[href="/wedding/chat"]')];
    expect(amoraEntries).toHaveLength(3);
    const amoraSources = ["landing_header", "landing_header", "landing_hero_primary"];
    for (const [index, entry] of amoraEntries.entries()) {
      expect(entry.textContent).toMatch(/아모라.*시작하기/u);
      entry.addEventListener("click", (event) => event.preventDefault());
      await act(async () => {
        entry.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      expect(mocks.captureEvent).toHaveBeenLastCalledWith("landing_cta_click", { source: amoraSources[index] });
    }
    expect(mocks.captureEvent.mock.calls.slice(2)).toEqual([
      ["landing_cta_click", { source: "landing_header" }],
      ["landing_cta_click", { source: "landing_header" }],
      ["landing_cta_click", { source: "landing_hero_primary" }],
    ]);
  });

  it("counts every available-now card under its own destination without an Amora or hero start", async () => {
    await act(async () => root.render(<AvailableNowSection />));

    const cards = [...container.querySelectorAll<HTMLAnchorElement>("#now .grid > a")];
    expect(cards.map((card) => card.getAttribute("href"))).toEqual([
      "/wedding/community/quote-check", "/wedding-code", "/price", "/wedding/manners",
    ]);
    for (const card of cards) {
      card.addEventListener("click", (event) => event.preventDefault());
      await act(async () => {
        card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
    }

    expect(mocks.captureEvent.mock.calls).toEqual([
      ["landing_cta_click", { source: "landing_now_card" }],
      ["landing_cta_click", { source: "landing_now_wedding_code" }],
      ["landing_cta_click", { source: "landing_now_card" }],
      ["landing_cta_click", { source: "landing_now_card" }],
    ]);
  });
});
