import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/wedding/lounge",
  signOut: vi.fn(),
  isDesktop: false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    as,
    className,
    onClick,
    "aria-current": ariaCurrent,
    "aria-label": ariaLabel,
  }: {
    children: React.ReactNode;
    href: string;
    as?: string;
    className?: string;
    onClick?: () => void;
    "aria-current"?: "page";
    "aria-label"?: string;
  }) => (
    <a
      href={as ?? href}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        onClick?.();
      }}
      aria-current={ariaCurrent}
      aria-label={ariaLabel}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/Logo", () => ({
  default: () => <span>웨딩한방</span>,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    profile: { name: "테스트 사용자" },
    journey: null,
    signOut: mocks.signOut,
  }),
}));

vi.mock("@hanbang/shared", () => ({
  parseLocalDateOnly: (value: string) => new Date(value),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Sidebar Couple Court navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.isDesktop = false;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: mocks.isDesktop,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
      writable: true,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("shows and activates Couple Court on nested paths when the flag is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_COUPLE_COURT_ENABLED", "true");
    mocks.pathname = "/wedding/couple-court/cases/case-1";
    vi.resetModules();
    const { default: Sidebar, isSidebarItemActive } = await import("../Sidebar");

    await act(async () => root.render(<Sidebar isOpen onClose={vi.fn()} />));

    const link = Array.from(container.querySelectorAll("a")).find(
      (candidate) => candidate.textContent?.trim() === "커플재판소",
    );
    expect(link?.getAttribute("href")).toBe("/wedding/couple-court");
    expect(link?.className).toContain("bg-[#061a34]");
    expect(link?.getAttribute("aria-current")).toBe("page");
    expect(isSidebarItemActive("/couple-court/cases/case-1", "/couple-court")).toBe(true);
    expect(isSidebarItemActive("/couple-courthouse", "/couple-court")).toBe(false);
  });

  it("does not expose Couple Court when the public flag is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_COUPLE_COURT_ENABLED", "false");
    mocks.pathname = "/wedding/lounge";
    vi.resetModules();
    const { default: Sidebar } = await import("../Sidebar");

    await act(async () => root.render(<Sidebar isOpen onClose={vi.fn()} />));

    expect(container.textContent).not.toContain("커플재판소");
  });

  it("closes the mobile drawer when the user follows the logo home link", async () => {
    vi.resetModules();
    const { default: Sidebar } = await import("../Sidebar");
    const onClose = vi.fn();

    await act(async () => root.render(<Sidebar isOpen onClose={onClose} />));

    const logoLink = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="웨딩한방 홈으로 이동"]',
    );
    expect(logoLink).not.toBeNull();

    act(() => logoLink?.click());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("makes the closed mobile drawer inert and hidden from assistive technology", async () => {
    vi.resetModules();
    const { default: Sidebar } = await import("../Sidebar");

    await act(async () => root.render(<Sidebar isOpen={false} onClose={vi.fn()} />));

    const sidebar = container.querySelector("aside");
    expect(sidebar?.getAttribute("aria-hidden")).toBe("true");
    expect(sidebar?.hasAttribute("inert")).toBe(true);
    expect(sidebar?.className).toContain("invisible");
    expect(sidebar?.className).toContain("pointer-events-none");
  });

  it("focuses the open mobile drawer, traps its boundary, and closes on Escape", async () => {
    vi.resetModules();
    const { default: Sidebar } = await import("../Sidebar");
    const onClose = vi.fn();

    await act(async () => root.render(<Sidebar isOpen onClose={onClose} />));

    const sidebar = container.querySelector("aside");
    const closeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="메뉴 닫기"]',
    );
    const lastButton = Array.from(container.querySelectorAll("button")).at(-1);
    expect(sidebar?.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(closeButton);

    lastButton?.focus();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(
      sidebar?.querySelector<HTMLElement>('a[href], button:not([disabled])'),
    );

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the persistent desktop sidebar interactive while the mobile state is closed", async () => {
    mocks.isDesktop = true;
    vi.resetModules();
    const { default: Sidebar } = await import("../Sidebar");

    await act(async () => root.render(<Sidebar isOpen={false} onClose={vi.fn()} />));

    const sidebar = container.querySelector("aside");
    expect(sidebar?.hasAttribute("aria-hidden")).toBe(false);
    expect(sidebar?.hasAttribute("inert")).toBe(false);
    expect(sidebar?.getAttribute("role")).toBeNull();
  });
});
