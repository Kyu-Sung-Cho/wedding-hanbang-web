// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TopNav from "./TopNav";

const navigation = vi.hoisted(() => ({ pathname: "/wedding/chat/board", push: vi.fn() }));
const auth = vi.hoisted(() => ({ journey: null as { wedding_date: string } | null }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname, useRouter: () => ({ push: navigation.push }) }));
vi.mock("next/link", () => ({ default: ({ children, href, className, "aria-label": label }: ComponentProps<"a">) => <a href={href} className={className} aria-label={label}>{children}</a> }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => ({ journey: auth.journey }) }));
vi.mock("@/hooks/useNotifications", () => ({ useNotificationPrefs: () => ({ prefs: {} }), useNotifications: () => ({ notifications: [], newCount: 0, dismiss: vi.fn(), dismissAll: vi.fn() }) }));
vi.mock("@/components/app/schedule/CategoryChecklistModal", () => ({ default: () => null }));
vi.mock("@/components/app/NotificationPanel", () => ({ default: () => <div role="status">알림 목록</div> }));
vi.mock("@/components/app/amora/AmoraWorkspaceNav", () => ({ default: () => <nav aria-label="아모라 탐색" /> }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { navigation.push.mockClear(); auth.journey = null; container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
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

  it.each(["/wedding/schedule", "/wedding/lounge"])("keeps the compact header and mobile notifications on %s", async pathname => {
    navigation.pathname = pathname;
    await act(async () => root.render(<TopNav planningWorkspace={pathname.endsWith("schedule")} loungeWorkspace={pathname.endsWith("lounge")} onMenuToggle={vi.fn()} />));
    expect(container.textContent).toContain("날짜 미정");
    expect(control("커뮤니티 검색")?.classList.contains("hidden")).toBe(true);
    expect(control("알림")?.parentElement?.classList.contains("hidden")).toBe(false);
    await act(async () => control("커뮤니티 검색")!.click());
    expect(navigation.push).toHaveBeenCalledWith("/wedding?feed=all#community-feed");
    await act(async () => control("알림")!.click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe("알림 목록");
  });

  it.each([
    ["/wedding/checklist", "웨딩 체크리스트"],
    ["/wedding/budget", "예산"],
  ])("keeps the planner title and menu reachable while retaining desktop utilities at %s", async (pathname, title) => {
    navigation.pathname = pathname;
    const menu = vi.fn();
    await act(async () => root.render(<TopNav planningWorkspace onMenuToggle={menu} />));
    expect(container.querySelector("h1")?.textContent).toBe(title);
    expect(container.textContent).toContain("날짜 미정");
    expect(container.textContent).not.toMatch(/D-\d+/);
    expect(control("메뉴 열기")?.classList.contains("hidden")).toBe(false);
    await act(async () => control("메뉴 열기")!.click());
    expect(menu).toHaveBeenCalledOnce();
    expect(control("커뮤니티 검색")?.classList.contains("hidden")).toBe(true);
    expect(control("커뮤니티 검색")?.classList.contains("md:flex")).toBe(true);
    expect(control("알림")?.parentElement?.classList.contains("hidden")).toBe(true);
    expect(control("알림")?.parentElement?.classList.contains("md:block")).toBe(true);
    await act(async () => control("커뮤니티 검색")!.click());
    expect(navigation.push).toHaveBeenCalledWith("/wedding?feed=all#community-feed");
    await act(async () => control("알림")!.click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe("알림 목록");
  });

  it.each([
    ["2026-09-12", "D-1"],
    ["2026-09-11", "D-day"],
    ["2026-09-10", "D+1"],
  ])("shows the actual planner wedding date %s as %s", async (weddingDate, expected) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-11T03:00:00Z"));
    navigation.pathname = "/wedding/budget";
    auth.journey = { wedding_date: weddingDate };
    await act(async () => root.render(<TopNav planningWorkspace onMenuToggle={vi.fn()} />));
    expect(container.textContent).toContain(expected);
    expect(container.textContent).not.toContain("날짜 미정");
  });

  it("keeps one shared header slot on chat and board, leaving chat controls to the conversation", async () => {
    let slot: HTMLDivElement | null = null;
    const assignSlot = (element: HTMLDivElement | null) => { slot = element; };
    navigation.pathname = "/wedding/chat";
    await act(async () => root.render(<TopNav amoraWorkspace amoraNavigationRef={assignSlot} onMenuToggle={vi.fn()} />));
    const headerSlot = container.querySelector("[data-amora-navigation-slot]");
    expect(slot).toBe(headerSlot);
    expect(headerSlot?.childElementCount).toBe(0);
    expect(headerSlot?.closest("header")).not.toBeNull();

    navigation.pathname = "/wedding/chat/board";
    await act(async () => root.render(<TopNav amoraWorkspace amoraNavigationRef={assignSlot} onMenuToggle={vi.fn()} />));
    expect(container.querySelector("[data-amora-navigation-slot]")).toBe(headerSlot);
    expect(container.querySelectorAll('nav[aria-label="아모라 탐색"]')).toHaveLength(1);
    expect(headerSlot?.querySelector("nav")).not.toBeNull();
  });
});
