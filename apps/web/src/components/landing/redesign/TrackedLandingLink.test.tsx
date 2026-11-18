import { act, type AnchorHTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { START_COPY } from "@hanbang/shared/invitation";
import { START_HERE_DATE_HANDOFF_KEY } from "@/lib/marketing/startHereDateHandoff";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  captureEvent: vi.fn(),
  linkProps: [] as Array<{ href: string; prefetch?: boolean }>,
}));

vi.mock("@/lib/analytics", () => ({ captureEvent: mocks.captureEvent }));
// `next/link` 에 실제로 무엇이 넘어가는지 본다(공유 Button 의 타입에는 prefetch 가 없다).
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch, onClick, ...props }:
    AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean; children: ReactNode }) => {
    mocks.linkProps.push({ href, prefetch });
    return <a href={href} {...props} onClick={(event) => {
      event.preventDefault();
      onClick?.(event);
    }}>{children}</a>;
  },
}));
// 세션 확인 전·후 라벨 변화는 LandingSession.test.tsx 가 본다. 여기서는 확인된 비로그인의 계측을 본다.
vi.mock("./LandingSession", () => ({
  default: ({ children }: { children: ReactNode }) => children,
  useLandingSession: () => "signed_out",
}));

import TrackedLandingLink from "./TrackedLandingLink";
import LandingHeader from "./LandingHeader";
import StartScreen from "./StartScreen";

describe("TrackedLandingLink", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.linkProps.length = 0;
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function click(link: Element | null | undefined) {
    expect(link, "누를 링크가 없다").toBeTruthy();
    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  }

  it("drops a stale landing date before entry and records only the slot name", async () => {
    window.sessionStorage.setItem(START_HERE_DATE_HANDOFF_KEY, "2027-05-01");
    await act(async () => {
      root.render(
        <TrackedLandingLink href="/wedding/chat" source="landing_hero_primary" variant="ink" size="pill-56">
          시작하기
        </TrackedLandingLink>,
      );
    });
    await click(container.querySelector("a"));
    expect(window.sessionStorage.getItem(START_HERE_DATE_HANDOFF_KEY)).toBeNull();
    expect(mocks.captureEvent.mock.calls).toEqual([["landing_cta_click", { source: "landing_hero_primary" }]]);
  });

  it("draws the shared Button pill and passes prefetch only when asked", async () => {
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 랜딩 버튼은 공유 Button 의 알약이다.
    await act(async () => root.render(<StartScreen />));
    const start = container.querySelector('a[href="/wedding/chat"]');
    const example = container.querySelector('a[href="/example"]');
    for (const token of ["h-14", "rounded-[28px]", "bg-inv-ink", "text-inv-white", "font-bold"]) {
      expect(start?.classList.contains(token), `시작하기에 ${token} 이 없다`).toBe(true);
    }
    for (const token of ["h-11", "text-inv-ink", "font-medium"]) {
      expect(example?.classList.contains(token), `예시에 ${token} 이 없다`).toBe(true);
    }
    // 로그인이 필요한 목적지만 미리 받지 않는다.
    expect(mocks.linkProps.find((props) => props.href === "/wedding/chat")?.prefetch).toBe(false);
    expect(mocks.linkProps.find((props) => props.href === "/example")?.prefetch).toBeUndefined();
  });

  it("counts the start screen's two actions under their own slot names", async () => {
    await act(async () => root.render(<StartScreen />));
    const start = [...container.querySelectorAll("a")].find((a) => a.textContent === START_COPY.start);
    const example = [...container.querySelectorAll("a")].find((a) => a.textContent === START_COPY.example);
    expect(start?.getAttribute("href")).toBe("/wedding/chat");
    expect(example?.getAttribute("href")).toBe("/example");
    await click(start);
    await click(example);
    expect(mocks.captureEvent.mock.calls).toEqual([
      ["landing_cta_click", { source: "landing_hero_primary" }],
      ["landing_cta_click", { source: "landing_hero_secondary" }],
    ]);
  });

  it("counts the login pill under the header slot", async () => {
    await act(async () => root.render(<LandingHeader />));
    const login = container.querySelector('header a[href="/login?redirect=%2Fwedding%2Fchat"]');
    expect(login?.textContent).toBe("로그인");
    await click(login);
    expect(mocks.captureEvent.mock.calls).toEqual([["landing_cta_click", { source: "landing_header" }]]);
  });
});
