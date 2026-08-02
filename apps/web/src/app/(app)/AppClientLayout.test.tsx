import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AppClientLayout from "./AppClientLayout";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  pathname: "/wedding/lounge",
  searchParams: new URLSearchParams(),
  isDemo: true,
  userId: "demo" as string | null,
  sessionVerified: true,
  pageViewCalls: [] as boolean[],
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

vi.mock("@/hooks/useEventTracker", () => ({
  usePageViewTracker: (enabled = true) => {
    mocks.pageViewCalls.push(enabled);
  },
}));

vi.mock("@/hooks/useAuthSessionSync", () => ({
  useAuthSessionSync: () => mocks.sessionVerified,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    initialize: vi.fn(),
    isInitialized: true,
    isLoading: false,
    isDemo: mocks.isDemo,
    user: mocks.userId ? { id: mocks.userId, email: "user@example.com" } : null,
  }),
}));

describe("AppClientLayout global Amora panel", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.pathname = "/wedding/lounge";
    mocks.searchParams = new URLSearchParams();
    mocks.isDemo = true;
    mocks.userId = "demo";
    mocks.sessionVerified = true;
    mocks.pageViewCalls.length = 0;
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

  it("suppresses internal page-view writes only in admin vendor preview mode", async () => {
    mocks.isDemo = false;
    mocks.userId = "user-a";
    mocks.pathname = "/wedding/vendors";
    mocks.searchParams = new URLSearchParams("preview=1");
    await renderLayout();

    expect(mocks.pageViewCalls.at(-1)).toBe(false);
    expect(container.querySelector(".ph-no-capture")).not.toBeNull();
    expect(container.querySelector('button[aria-label="아모라 AI 상담"]')).toBeNull();

    mocks.searchParams = new URLSearchParams();
    await renderLayout();

    expect(mocks.pageViewCalls.at(-1)).toBe(true);
    expect(container.querySelector(".ph-no-capture")).toBeNull();
    expect(container.querySelector('button[aria-label="아모라 AI 상담"]')).not.toBeNull();
  });

  it("removes protected children while the server session is being revalidated", async () => {
    mocks.isDemo = false;
    mocks.userId = "user-a";
    mocks.sessionVerified = false;

    await renderLayout();

    expect(container.textContent).not.toContain("page content");
    expect(container.textContent).toContain("웨딩 라운지를 불러오는 중");
  });

  it("remounts the protected subtree when the authenticated identity changes", async () => {
    mocks.isDemo = false;
    mocks.userId = "user-a";

    function StatefulChild() {
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount((value) => value + 1)}>count:{count}</button>;
    }

    await act(async () => {
      root.render(<AppClientLayout><StatefulChild /></AppClientLayout>);
      await Promise.resolve();
    });
    const counter = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.startsWith("count:"));
    await act(async () => counter?.click());
    expect(container.textContent).toContain("count:1");

    mocks.userId = "user-b";
    await act(async () => {
      root.render(<AppClientLayout><StatefulChild /></AppClientLayout>);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("count:0");
    expect(container.textContent).not.toContain("count:1");
  });
});
