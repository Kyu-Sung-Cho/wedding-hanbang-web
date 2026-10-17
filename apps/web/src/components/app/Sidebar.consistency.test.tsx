import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";

const mocks = vi.hoisted(() => ({ pathname: "/wedding/lounge" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({ profile: { name: "김지은", avatar_url: null }, journey: null, signOut: vi.fn() }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 사이드바에 있는 메뉴를 하나씩 눌러 볼 때 보이는 화면들. 예절 가이드는 앱 틀 밖의 공개
// 레이아웃이지만 로그인한 사람에게는 같은 사이드바가 그려진다(`MannersChrome`).
const PATHS = [
  "/wedding/lounge",
  "/wedding/chat",
  "/wedding/checklist",
  "/wedding/schedule",
  "/wedding/budget",
  "/wedding/preparation-style",
  "/wedding/manners",
  "/wedding/manners/first-greeting",
  "/wedding/settings",
  "/wedding/saved",
  "/wedding/vendors",
] as const;

describe("signed-in sidebar looks the same on every page", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function shapeAt(pathname: string) {
    mocks.pathname = pathname;
    await act(async () => root.render(<Sidebar isOpen onClose={vi.fn()} />));
    const aside = container.querySelector("aside")!;
    const links = [...aside.querySelectorAll<HTMLAnchorElement>('nav[aria-label="서비스 메뉴"] a')];
    const active = links.filter((link) => link.getAttribute("aria-current") === "page");
    const idle = links.filter((link) => link.getAttribute("aria-current") !== "page");
    return {
      aside,
      asideClass: aside.className,
      listClass: links[0]!.parentElement!.className,
      labels: links.map((link) => link.textContent),
      idleClasses: [...new Set(idle.map((link) => link.className))],
      activeClasses: [...new Set(active.map((link) => link.className))],
      activeCount: active.length,
      footerClass: aside.lastElementChild!.className,
    };
  }

  it("has one shape no matter which page is open", async () => {
    const first = await shapeAt(PATHS[0]);
    for (const pathname of PATHS) {
      const shape = await shapeAt(pathname);
      expect(shape.asideClass, pathname).toBe(first.asideClass);
      expect(shape.listClass, pathname).toBe(first.listClass);
      expect(shape.labels, pathname).toEqual(first.labels);
      expect(shape.footerClass, pathname).toBe(first.footerClass);
      // 활성이 아닌 항목은 어디서나 한 가지 모양이고, 활성 항목만 따로 한 가지다.
      expect(shape.idleClasses, pathname).toHaveLength(1);
      expect(shape.idleClasses[0], pathname).toBe(first.idleClasses[0]);
      if (shape.activeCount > 0) {
        expect(shape.activeClasses, pathname).toEqual(first.activeClasses);
      }
    }
  });

  it("is 220px wide with the amora tokens attached to the aside itself", async () => {
    // 색 토큰은 `.amora-workspace`·`.planning-workspace` 안에서만 값이 있다. 설정처럼 둘 다 없는
    // 화면에서도 같은 색이 나오려면 사이드바 요소가 `amora-workspace` 를 직접 달고 있어야 한다.
    const shape = await shapeAt("/wedding/settings");
    expect(shape.asideClass).toContain("amora-workspace");
    expect(shape.asideClass).toContain("w-[220px]");
    for (const legacy of ["w-[16rem]", "w-[216px]", "bg-[var(--hb-ivory)]"]) {
      expect(shape.asideClass).not.toContain(legacy);
    }
  });

  it("makes only the current item bold", async () => {
    for (const pathname of PATHS) {
      const shape = await shapeAt(pathname);
      expect(shape.idleClasses.join(" "), pathname).not.toContain("font-semibold");
      if (shape.activeCount > 0) expect(shape.activeClasses.join(" "), pathname).toContain("font-semibold");
    }
  });

  it("shows the same menu, the user and logout on the guide and on the lounge", async () => {
    for (const pathname of ["/wedding/lounge", "/wedding/manners", "/wedding/manners/first-greeting"]) {
      const shape = await shapeAt(pathname);
      expect(shape.labels, pathname).toContain("웨딩코드");
      expect(shape.labels, pathname).toContain("예절 가이드");
      expect(shape.labels, pathname).not.toContain("커뮤니티");
      expect(shape.aside.textContent, pathname).toContain("김지은");
      expect(shape.aside.textContent, pathname).toContain("로그아웃");
    }
  });

  it("marks the guide as the current page on the index and on a guide article", async () => {
    for (const pathname of ["/wedding/manners", "/wedding/manners/first-greeting"]) {
      const shape = await shapeAt(pathname);
      const current = shape.aside.querySelector('[aria-current="page"]');
      expect(current?.textContent, pathname).toBe("예절 가이드");
    }
  });
});
