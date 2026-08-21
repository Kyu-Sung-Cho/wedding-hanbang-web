import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AppClientLayout from "./AppClientLayout";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  pathname: "/wedding/lounge",
  searchParams: new URLSearchParams(),
  isDemo: true,
  isInitialized: true,
  initializeCalls: [] as Array<{ initialDemo?: boolean } | undefined>,
  authSyncCalls: [] as boolean[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("lucide-react", () => ({
  Sparkles: () => <span>sparkles</span>,
}));

vi.mock("@/components/common/AiNoticeFooter", () => ({
  default: () => <footer>AI notice</footer>,
}));

vi.mock("@/components/app/Sidebar", () => ({
  default: () => <aside>sidebar</aside>,
}));

vi.mock("@/components/app/TopNav", () => ({
  default: () => <header>top nav</header>,
}));

vi.mock("@/components/app/chat/ChatSidePanel", () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="global-amora-panel" data-open={String(isOpen)} />
  ),
}));

vi.mock("@/hooks/useAuthSessionSync", () => ({
  useAuthSessionSync: (enabled = true) => {
    mocks.authSyncCalls.push(enabled);
  },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    initialize: (options?: { initialDemo?: boolean }) => {
      mocks.initializeCalls.push(options);
    },
    isInitialized: mocks.isInitialized,
    isLoading: false,
    isDemo: mocks.isDemo,
  }),
}));

describe("AppClientLayout global Amora panel", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.pathname = "/wedding/lounge";
    mocks.searchParams = new URLSearchParams();
    mocks.isDemo = true;
    mocks.isInitialized = true;
    mocks.initializeCalls.length = 0;
    mocks.authSyncCalls.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function renderLayout() {
    await act(async () => {
      root.render(
        <AppClientLayout>
          <div>page content</div>
        </AppClientLayout>,
      );
      await Promise.resolve();
    });
  }

  it("hydrates a server-verified demo session without an auth round trip", async () => {
    mocks.isInitialized = false;

    await act(async () => {
      root.render(
        <AppClientLayout initialDemo>
          <div>page content</div>
        </AppClientLayout>,
      );
      await Promise.resolve();
    });

    expect(mocks.initializeCalls).toEqual([{ initialDemo: true }]);
    expect(mocks.authSyncCalls).toEqual([false]);
  });

  it("unmounts and resets the global panel when navigation enters the full chat page", async () => {
    await renderLayout();

    const launcher = container.querySelector<HTMLButtonElement>(
      'button[aria-label="아모라 AI 상담"]',
    );
    expect(launcher).not.toBeNull();

    await act(async () => launcher?.click());
    expect(container.querySelector('[data-testid="global-amora-panel"]')?.getAttribute("data-open"))
      .toBe("true");

    mocks.pathname = "/wedding/chat";
    await renderLayout();
    expect(container.querySelector('[data-testid="global-amora-panel"]')).toBeNull();

    mocks.pathname = "/wedding/lounge";
    await renderLayout();
    expect(container.querySelector('[data-testid="global-amora-panel"]')?.getAttribute("data-open"))
      .toBe("false");
  });

  it.each([
    "/wedding/vendors",
    "/wedding/vendors/vendor-123",
  ])("keeps exactly one global Amora launcher on %s", async (pathname) => {
    mocks.pathname = pathname;
    await renderLayout();

    expect(
      container.querySelectorAll('button[aria-label="아모라 AI 상담"]'),
    ).toHaveLength(1);
  });

  it("suppresses analytics capture and the Amora launcher only in admin vendor preview mode", async () => {
    mocks.isDemo = false;
    mocks.pathname = "/wedding/vendors";
    mocks.searchParams = new URLSearchParams("preview=1");
    await renderLayout();

    expect(container.querySelector(".ph-no-capture")).not.toBeNull();
    expect(container.querySelector('button[aria-label="아모라 AI 상담"]')).toBeNull();

    mocks.searchParams = new URLSearchParams();
    await renderLayout();

    expect(container.querySelector(".ph-no-capture")).toBeNull();
    expect(container.querySelector('button[aria-label="아모라 AI 상담"]')).not.toBeNull();
  });
});
