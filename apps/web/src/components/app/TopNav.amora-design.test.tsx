// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TopNav from "./TopNav";

const navigation = vi.hoisted(() => ({ pathname: "/wedding/chat/board", push: vi.fn() }));
const auth = vi.hoisted(() => ({ journey: null as { wedding_date: string } | null }));
const notify = vi.hoisted(() => ({ newCount: 0, weddingDate: undefined as string | null | undefined }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname, useRouter: () => ({ push: navigation.push }) }));
vi.mock("next/link", () => ({ default: ({ children, href, className, "aria-label": label }: ComponentProps<"a">) => <a href={href} className={className} aria-label={label}>{children}</a> }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => ({ journey: auth.journey }) }));
vi.mock("@/hooks/useNotifications", () => ({
  useNotificationPrefs: () => ({ prefs: {} }),
  useNotifications: (weddingDate: string | null | undefined) => {
    notify.weddingDate = weddingDate;
    return { notifications: [], newCount: notify.newCount, dismiss: vi.fn(), dismissAll: vi.fn() };
  },
}));
vi.mock("@/components/app/schedule/CategoryChecklistModal", () => ({ default: () => null }));
vi.mock("@/components/app/NotificationPanel", () => ({ default: () => <div role="status">알림 목록</div> }));
vi.mock("@/components/app/amora/AmoraWorkspaceNav", () => ({ default: () => <nav aria-label="아모라 탐색" /> }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { navigation.push.mockClear(); auth.journey = null; notify.newCount = 0; notify.weddingDate = undefined; container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
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
    expect(control("커뮤니티 검색")).toBeNull();
    expect(control("알림")?.parentElement?.classList.contains("hidden")).toBe(false);
    expect(navigation.push).not.toHaveBeenCalled();
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
    // 모바일에서는 이 제목이 왼쪽 위 브랜드 자리다 — 커뮤니티가 아니라 라운지로 간다.
    expect(container.querySelector('a[aria-label="웨딩한방 홈으로 이동"]')?.getAttribute("href")).toBe("/lounge");
    expect(container.textContent).toContain("날짜 미정");
    expect(container.textContent).not.toMatch(/D-\d+/);
    expect(control("메뉴 열기")?.classList.contains("hidden")).toBe(false);
    await act(async () => control("메뉴 열기")!.click());
    expect(menu).toHaveBeenCalledOnce();
    expect(control("커뮤니티 검색")).toBeNull();
    expect(control("알림")?.parentElement?.classList.contains("hidden")).toBe(true);
    expect(control("알림")?.parentElement?.classList.contains("md:block")).toBe(true);
    expect(navigation.push).not.toHaveBeenCalled();
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

  it.each(["/preparation-style", "/wedding/preparation-style"])("uses the WeddingCode title without community discovery at %s", async pathname => {
    navigation.pathname = pathname;
    await act(async () => root.render(<TopNav loungeWorkspace onMenuToggle={vi.fn()} />));
    expect(container.querySelector("h1")?.textContent).toBe("웨딩코드");
    expect(control("커뮤니티 검색")).toBeNull();
    expect(control("메뉴 열기")).not.toBeNull();
    expect(control("알림")).not.toBeNull();
  });

  it("keeps the WeddingCode shortcut and hides community on generic signed-in pages", async () => {
    navigation.pathname = "/wedding/settings";
    await act(async () => root.render(<TopNav onMenuToggle={vi.fn()} />));
    const nav = container.querySelector('nav[aria-label="주요 기능 바로가기"]')!;
    expect(nav.querySelector('a[href="/preparation-style"]')?.textContent).toBe("웨딩코드");
    expect(nav.textContent).not.toContain("커뮤니티");
    expect(control("커뮤니티 검색")).toBeNull();
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

describe("Header title names the current screen", () => {
  // 이 셋은 표에 없어 "웨딩한방" 브랜드명이 나왔다. 다른 화면은 모두 현재 위치를 쓴다.
  it.each([
    ["/wedding/chat/personal", "나만 보는 할 일"],
    ["/wedding/settings/amora-style", "설정"],
    ["/wedding/settings/amora-memory", "설정"],
  ])("shows the screen name at %s", async (pathname, title) => {
    navigation.pathname = pathname;
    await act(async () => root.render(<TopNav onMenuToggle={vi.fn()} />));
    expect(container.querySelector("h1")?.textContent).toBe(title);
  });
});

describe("Notification bell", () => {
  it("names the unread count so a screen reader hears it, while the badge stays capped", async () => {
    navigation.pathname = "/wedding/settings";
    notify.newCount = 3;
    await act(async () => root.render(<TopNav onMenuToggle={vi.fn()} />));
    expect(control("새 알림 3개")).not.toBeNull();
    expect(control("알림")).toBeNull();

    notify.newCount = 12;
    await act(async () => root.render(<TopNav onMenuToggle={vi.fn()} />));
    expect(control("새 알림 12개")?.textContent).toBe("9+");
  });

  it("keeps the plain name when nothing is unread", async () => {
    navigation.pathname = "/wedding/settings";
    await act(async () => root.render(<TopNav onMenuToggle={vi.fn()} />));
    expect(control("알림")).not.toBeNull();
    expect(container.querySelector('button[aria-label^="새 알림"]')).toBeNull();
  });

  it("reports open and closed state", async () => {
    navigation.pathname = "/wedding/settings";
    await act(async () => root.render(<TopNav onMenuToggle={vi.fn()} />));
    expect(control("알림")!.getAttribute("aria-expanded")).toBe("false");
    await act(async () => control("알림")!.click());
    expect(control("알림")!.getAttribute("aria-expanded")).toBe("true");
    await act(async () => control("알림")!.click());
    expect(control("알림")!.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape and hands focus back to the bell, ignoring other keys", async () => {
    navigation.pathname = "/wedding/settings";
    await act(async () => root.render(<TopNav onMenuToggle={vi.fn()} />));
    const bell = control("알림")!;
    await act(async () => bell.click());
    expect(bell.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).not.toBe(bell);

    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(bell.getAttribute("aria-expanded")).toBe("true");

    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => {});
    expect(bell.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(bell);
  });

  it("does nothing on Escape while closed and leaves no listener behind after closing", async () => {
    navigation.pathname = "/wedding/settings";
    await act(async () => root.render(<TopNav onMenuToggle={vi.fn()} />));
    const bell = control("알림")!;
    const menu = control("메뉴 열기")!;
    menu.focus();

    // 닫힌 상태의 Esc 는 종으로 초점을 가져오지 않는다.
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(bell.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(menu);

    // 열었다가 Esc 로 닫은 뒤 다시 다른 곳에 둔 초점은 다음 Esc 가 건드리지 않는다.
    await act(async () => bell.click());
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.activeElement).toBe(bell);
    menu.focus();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.activeElement).toBe(menu);
  });

  it("hands the wedding date text to the notification hook, not a Date parsed in UTC", async () => {
    navigation.pathname = "/wedding/settings";
    auth.journey = { wedding_date: "2026-10-15" };
    await act(async () => root.render(<TopNav onMenuToggle={vi.fn()} />));
    expect(notify.weddingDate).toBe("2026-10-15");
  });
});
