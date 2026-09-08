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

  it.each(["/wedding/chat", "/wedding/chat/missions", "/wedding/chat/board", "/chat"])("enters missions and keeps Amora selected at %s without changing the current conversation", async pathname => {
    mocks.pathname = pathname;
    await act(async () => root.render(<Sidebar isOpen onClose={close} amoraWorkspace />));
    const link = container.querySelector<HTMLAnchorElement>('[data-tutorial-target="service-nav-amora"]')!;
    expect(link.getAttribute("href")).toBe("/wedding/chat/missions");
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(mocks.pathname).toBe(pathname);
    link.addEventListener("click", event => event.preventDefault());
    await act(async () => link.click());
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it.each(["/wedding/budget", "/wedding/chat-archive"])("does not mark unrelated %s as Amora", async pathname => {
    mocks.pathname = pathname;
    await act(async () => root.render(<Sidebar isOpen onClose={close} />));
    expect(container.querySelector('[data-tutorial-target="service-nav-amora"]')?.getAttribute("aria-current")).toBeNull();
  });
});
