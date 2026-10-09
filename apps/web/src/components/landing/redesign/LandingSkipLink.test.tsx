// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, createHarness, type Harness } from "@/components/wedding-code/v40/inputTestKit";
import LandingSkipLink from "./LandingSkipLink";

// Next의 이동 자체는 production 화면에서 확인한다. 이 검사는 이동 콜백의 초점 계약을 확인한다.
vi.mock("next/link", () => ({
  default: ({ children, href, className, onNavigate }: {
    children: ReactNode; href: string; className: string; onNavigate: () => void;
  }) => <a href={href} className={className} onClick={event => { event.preventDefault(); onNavigate(); }}>{children}</a>,
}));

let harness: Harness;
beforeEach(() => { harness = createHarness(); });
afterEach(async () => { await harness.unmount(); });

describe("랜딩 본문 바로가기의 초점", () => {
  it("이동할 때 본문에 초점을 옮기며 별도의 스크롤 이동을 만들지 않는다", async () => {
    await harness.render(<><LandingSkipLink /><main id="main-content" tabIndex={-1}><button>본문 첫 동작</button></main></>);
    const link = harness.container.querySelector<HTMLAnchorElement>('a[href="#main-content"]');
    const main = harness.container.querySelector<HTMLElement>("main");
    if (!link || !main) throw new Error("본문 바로가기 요소가 없어요");
    const focus = vi.spyOn(main, "focus");
    link.focus();
    expect(document.activeElement).toBe(link);
    await click(link);
    expect(document.activeElement).toBe(main);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(main.querySelector("button")?.textContent).toBe("본문 첫 동작");
  });

  it("본문이 없는 과도 상태에도 이동 콜백이 오류를 내지 않는다", async () => {
    await harness.render(<LandingSkipLink />);
    await expect(click(harness.container.querySelector("a"))).resolves.toBeUndefined();
  });
});
