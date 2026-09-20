import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";

const mocks = vi.hoisted(() => ({ pathname: "/wedding/chat", signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => ({ profile: null, journey: null, signOut: mocks.signOut }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Amora sidebar entry", () => {
  let container: HTMLDivElement;
  let root: Root;
  const close = vi.fn();
  beforeEach(() => {
    close.mockReset(); mocks.signOut.mockReset();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it.each(["/wedding/chat", "/wedding/chat/missions", "/wedding/chat/board", "/chat"])("enters conversation and keeps Amora selected at %s without changing the current conversation", async pathname => {
    mocks.pathname = pathname;
    await act(async () => root.render(<Sidebar isOpen onClose={close} amoraWorkspace />));
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
    await act(async () => root.render(<Sidebar isOpen onClose={close} amoraWorkspace />));
    const menu = container.querySelector('nav[aria-label="서비스 메뉴"]')!;
    expect(menu.querySelector("a")?.getAttribute("href")).toBe("/wedding/lounge");
    expect(menu.querySelector('[aria-current="page"]')?.textContent).toBe("웨딩 라운지");
    expect(menu.querySelector('a[href="/wedding/saved"]')).toBeNull();
  });

  it.each(["/preparation-style", "/wedding/preparation-style"])("opens preparation style from the shared web menu at %s", async pathname => {
    mocks.pathname = pathname;
    await act(async () => root.render(<Sidebar isOpen onClose={close} amoraWorkspace />));
    const menu = container.querySelector('nav[aria-label="서비스 메뉴"]')!;
    const link = menu.querySelector<HTMLAnchorElement>('a[href="/wedding/preparation-style"]');
    expect(link?.textContent).toBe("우리의 준비 스타일");
    expect(link?.getAttribute("aria-current")).toBe("page");
    expect(menu.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(menu.textContent).not.toContain("커뮤니티");
    expect(menu.querySelector('a[href="/wedding"]')).toBeNull();
    link?.addEventListener("click", event => event.preventDefault());
    await act(async () => link?.click());
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([true, false])("sends the brand link to the lounge, not the community (html design: %s)", async amoraWorkspace => {
    mocks.pathname = "/wedding/checklist";
    await act(async () => root.render(<Sidebar isOpen onClose={close} amoraWorkspace={amoraWorkspace} />));
    const brand = container.querySelector<HTMLAnchorElement>('a[aria-label="웨딩한방 홈으로 이동"]')!;
    expect(brand.getAttribute("href")).toBe("/wedding/lounge");
    brand.addEventListener("click", event => event.preventDefault());
    await act(async () => brand.click());
    expect(close).toHaveBeenCalledOnce();
  });

  it("shows the same logo as the browser tab instead of a letter badge", async () => {
    mocks.pathname = "/wedding/lounge";
    await act(async () => root.render(<Sidebar isOpen onClose={close} amoraWorkspace />));
    const brand = container.querySelector('a[aria-label="웨딩한방 홈으로 이동"]')!;
    expect(brand.querySelector("img")?.getAttribute("src")).toContain("apple-touch-icon.png");
    expect(brand.textContent).toBe("웨딩한방");
  });

  it.each(["/wedding/budget", "/wedding/chat-archive"])("does not mark unrelated %s as Amora", async pathname => {
    mocks.pathname = pathname;
    await act(async () => root.render(<Sidebar isOpen onClose={close} />));
    expect(container.querySelector('[data-tutorial-target="service-nav-amora"]')?.getAttribute("aria-current")).toBeNull();
  });
});
