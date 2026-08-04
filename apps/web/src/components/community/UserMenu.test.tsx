import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import UserMenu from "./UserMenu";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  reset: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({ auth: { signOut: mocks.signOut } }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({
    user: { id: "11111111-1111-4111-8111-111111111111" },
    reset: mocks.reset,
  }),
}));

vi.mock("@/components/community/CommunityReplyNotifications", () => ({
  default: () => null,
}));

describe("community user menu notification session cleanup", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signOut.mockResolvedValue({ error: null });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("clears owner-bound state before navigating away after logout", async () => {
    await act(async () => root.render(<UserMenu />));
    const menuTrigger = container.querySelector(
      'button[aria-label="내 메뉴"]',
    ) as HTMLButtonElement;
    await act(async () => menuTrigger.click());
    const logout = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("로그아웃"),
    );
    expect(logout).toBeDefined();

    await act(async () => {
      logout?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.reset).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.reset.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.push.mock.invocationCallOrder[0],
    );
  });
});
