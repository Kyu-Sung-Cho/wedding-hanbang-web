import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";

const mocks = vi.hoisted(() => ({ pathname: "/wedding/chat", signOut: vi.fn(),journey:null as {wedding_date:string}|null }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => ({ profile: null, journey: mocks.journey, signOut: mocks.signOut }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("App sidebar", () => {
  let container: HTMLDivElement;
  let root: Root;
  const close = vi.fn();
  beforeEach(() => {
    close.mockReset(); mocks.signOut.mockReset();mocks.journey=null;
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it.each(["/wedding/chat", "/wedding/chat/missions", "/wedding/chat/board", "/chat"])("enters conversation and keeps Amora selected at %s without changing the current conversation", async pathname => {
    mocks.pathname = pathname;
    await act(async () => root.render(<Sidebar isOpen onClose={close} />));
    const link = container.querySelector<HTMLAnchorElement>('[data-tutorial-target="service-nav-amora"]')!;
    expect(link.getAttribute("href")).toBe("/wedding/chat");
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(mocks.pathname).toBe(pathname);
    link.addEventListener("click", event => event.preventDefault());
    await act(async () => link.click());
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("starts with the mission lounge and keeps saved answers inside Amora", async () => {
    mocks.pathname = "/wedding/lounge";
    await act(async () => root.render(<Sidebar isOpen onClose={close} />));
    const menu = container.querySelector('nav[aria-label="서비스 메뉴"]')!;
    expect(menu.querySelector("a")?.getAttribute("href")).toBe("/wedding/lounge");
    expect(menu.querySelector('[aria-current="page"]')?.textContent).toBe("웨딩 라운지");
    expect(menu.querySelector('a[href="/wedding/saved"]')).toBeNull();
  });

  // 2026-11-13 파운더 결정: 메인은 웨딩 라운지와 아모라 둘이다. 나머지 화면은 메뉴에서 빠지고
  // 라운지와 아모라가 연다. 화면이 없어진 것이 아니라 메뉴에서 빠진 것이라, 그 화면에 있을 때
  // 두 항목 어느 것도 선택된 것으로 그리지 않는다.
  it.each(["/wedding/preparation-style", "/wedding/checklist", "/wedding/schedule", "/wedding/budget", "/wedding/manners"])("keeps only the lounge and Amora in the menu at %s", async pathname => {
    mocks.pathname = pathname;
    await act(async () => root.render(<Sidebar isOpen onClose={close} />));
    const menu = container.querySelector('nav[aria-label="서비스 메뉴"]')!;
    expect([...menu.querySelectorAll("a")].map(link => [link.textContent, link.getAttribute("href")])).toEqual([
      ["웨딩 라운지", "/wedding/lounge"],
      ["아모라", "/wedding/chat"],
    ]);
    expect(menu.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
    for (const label of ["결정 보드", "웨딩 체크리스트", "일정", "예산", "웨딩코드", "커뮤니티", "예절 가이드", "설정"]) {
      expect(menu.textContent, label).not.toContain(label);
    }
  });

  it("moves settings to the user area and marks it there", async () => {
    mocks.pathname = "/wedding/settings/amora-memory";
    await act(async () => root.render(<Sidebar isOpen onClose={close} />));
    const menu = container.querySelector('nav[aria-label="서비스 메뉴"]')!;
    expect(menu.querySelector('a[href="/wedding/settings"]')).toBeNull();
    const settings = container.querySelector<HTMLAnchorElement>('aside a[href="/wedding/settings"]');
    expect(settings?.textContent).toBe("설정");
    expect(settings?.getAttribute("aria-current")).toBe("page");
    settings?.addEventListener("click", event => event.preventDefault());
    await act(async () => settings?.click());
    expect(close).toHaveBeenCalledOnce();
  });

  it("sends the brand link to the lounge, not the community", async () => {
    mocks.pathname = "/wedding/checklist";
    await act(async () => root.render(<Sidebar isOpen onClose={close} />));
    const brand = container.querySelector<HTMLAnchorElement>('a[aria-label="웨딩한방 홈으로 이동"]')!;
    expect(brand.getAttribute("href")).toBe("/wedding/lounge");
    brand.addEventListener("click", event => event.preventDefault());
    await act(async () => brand.click());
    expect(close).toHaveBeenCalledOnce();
  });

  it("shows the same logo as the browser tab instead of a letter badge", async () => {
    mocks.pathname = "/wedding/lounge";
    await act(async () => root.render(<Sidebar isOpen onClose={close} />));
    const brand = container.querySelector('a[aria-label="웨딩한방 홈으로 이동"]')!;
    expect(brand.querySelector("img")?.getAttribute("src")).toContain("apple-touch-icon.png");
    expect(brand.textContent).toBe("웨딩한방");
  });

  it.each(["/wedding/budget", "/wedding/chat-archive"])("does not mark unrelated %s as Amora", async pathname => {
    mocks.pathname = pathname;
    await act(async () => root.render(<Sidebar isOpen onClose={close} />));
    expect(container.querySelector('[data-tutorial-target="service-nav-amora"]')?.getAttribute("aria-current")).toBeNull();
  });
  it("preserves calendar wedding date in sidebar",async()=>{mocks.pathname="/wedding/lounge";mocks.journey={wedding_date:"2027-02-20"};await act(async()=>root.render(<Sidebar isOpen onClose={close}/>));expect(container.textContent).toContain("2027. 02. 20.");expect(container.textContent).not.toContain("02. 19.");expect(mocks.journey.wedding_date).toBe("2027-02-20");});
});
