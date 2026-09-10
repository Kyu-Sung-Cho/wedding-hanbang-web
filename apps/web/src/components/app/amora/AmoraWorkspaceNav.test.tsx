// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AmoraWorkspaceNav from "./AmoraWorkspaceNav";

const state = vi.hoisted(() => ({ pathname: "/wedding/chat/board", isDemo: false }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("next/link", () => ({ default: ({ as, href, ...props }: ComponentProps<"a"> & { as?: string }) => <a {...props} href={as ?? href} /> }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: (selector: (value: typeof state) => unknown) => selector(state) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { state.pathname = "/wedding/chat/board"; state.isDemo = false; container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("Amora common navigation", () => {
  it("enters explicit shared/private scopes from the board and exposes no duplicate destinations", async () => {
    await act(async () => root.render(<AmoraWorkspaceNav />));
    expect([...container.querySelectorAll("a")].map(link => link.getAttribute("href"))).toEqual([
      "/wedding/chat?scope=shared", "/wedding/chat?scope=private", "/wedding/chat/board",
    ]);
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("결정 보드");
    expect(container.textContent).not.toContain("오늘의 미션");
  });

  it("does not offer a private entry in demo mode", async () => {
    state.isDemo = true;
    await act(async () => root.render(<AmoraWorkspaceNav />));
    expect(container.querySelector('a[href*="scope=private"]')).toBeNull();
    expect(container.querySelector('[aria-disabled="true"]')?.textContent).toContain("나만 (상담)");
  });

  it("uses actual conversation state, with buttons that delegate rather than navigating", async () => {
    const change = vi.fn();
    await act(async () => root.render(<AmoraWorkspaceNav chatControls={{ activeScope: "private", onScopeChange: change, disabled: false, privateDisabled: false }} />));
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toContain("나만 (상담)");
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
    await act(async () => container.querySelector("button")!.click());
    expect(change).toHaveBeenCalledExactlyOnceWith("shared");
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("blocks both scope switching and board departure while a send is active", async () => {
    const change = vi.fn();
    await act(async () => root.render(<AmoraWorkspaceNav chatControls={{ activeScope: "shared", onScopeChange: change, disabled: true, privateDisabled: false }} />));
    expect(container.querySelectorAll("button:disabled")).toHaveLength(2);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    await act(async () => container.querySelector("button")!.click());
    expect(change).not.toHaveBeenCalled();
  });
});
