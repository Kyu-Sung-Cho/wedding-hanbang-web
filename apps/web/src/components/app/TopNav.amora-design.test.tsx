// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TopNav from "./TopNav";

const navigation = vi.hoisted(() => ({ pathname: "/wedding/chat/board", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname, useRouter: () => ({ push: navigation.push }) }));
vi.mock("next/link", () => ({ default: ({ children, href, className, "aria-label": label }: ComponentProps<"a">) => <a href={href} className={className} aria-label={label}>{children}</a> }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => ({ journey: null }) }));
vi.mock("@/hooks/useNotifications", () => ({ useNotificationPrefs: () => ({ prefs: {} }), useNotifications: () => ({ notifications: [], newCount: 0, dismiss: vi.fn(), dismissAll: vi.fn() }) }));
vi.mock("@/components/app/schedule/CategoryChecklistModal", () => ({ default: () => null }));
vi.mock("@/components/app/NotificationPanel", () => ({ default: () => null }));
vi.mock("@/components/app/amora/AmoraWorkspaceNav", () => ({ default: () => <nav aria-label="아모라 탐색" /> }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { navigation.push.mockClear(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const control = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

describe("Amora header search meaning", () => {
  it.each(["/wedding/chat", "/wedding/chat/missions", "/wedding/chat/board"])("keeps unrelated community search out of %s", async pathname => {
    navigation.pathname = pathname;
    const menu = vi.fn();
    await act(async () => root.render(<TopNav amoraWorkspace onMenuToggle={menu} />));
    expect(control("커뮤니티 검색")).toBeNull();
    await act(async () => control("메뉴 열기")!.click());
    expect(menu).toHaveBeenCalledOnce();
    expect(control("알림")).not.toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("keeps the existing community shortcut on other product pages", async () => {
    navigation.pathname = "/wedding/checklist";
    await act(async () => root.render(<TopNav planningWorkspace onMenuToggle={vi.fn()} />));
    await act(async () => control("커뮤니티 검색")!.click());
    expect(navigation.push).toHaveBeenCalledWith("/wedding?feed=all#community-feed");
  });
});
