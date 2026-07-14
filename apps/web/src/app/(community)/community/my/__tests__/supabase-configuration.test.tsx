import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const routerPush = vi.fn();
  return {
    createBrowserClient: vi.fn(),
    routerPush,
    router: { push: routerPush },
  };
});

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));

vi.mock("@/components/community/PostCard", () => ({
  default: () => <div>post</div>,
}));

vi.mock("@/components/community/Avatar", () => ({
  default: () => <div>avatar</div>,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => null,
}));

import MyBookmarksPage from "../bookmarks/page";
import MyPostsPage from "../posts/page";
import MyUpvotedPage from "../upvoted/page";

const pages: Array<{ name: string; Page: ComponentType }> = [
  { name: "bookmarks", Page: MyBookmarksPage },
  { name: "posts", Page: MyPostsPage },
  { name: "upvoted", Page: MyUpvotedPage },
];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

async function renderPage(Page: ComponentType) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(<Page />);
    await Promise.resolve();
  });

  return { root, container };
}

describe("community my pages Supabase configuration boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    mocks.createBrowserClient.mockImplementation(() => {
      throw new Error("missing configuration must not create a browser client");
    });
  });

  afterEach(async () => {
    await act(async () => {
      for (const { root } of mountedRoots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
    vi.unstubAllEnvs();
  });

  it.each(pages)("renders an explicit missing-configuration state: $name", async ({ Page }) => {
    const { container } = await renderPage(Page);

    expect(mocks.createBrowserClient).not.toHaveBeenCalled();
    expect(container.textContent).toContain("서비스 연결이 잠시 원활하지 않아요");
    expect(container.textContent).toContain("내 활동을 지금 불러오지 못했어요");
    expect(container.textContent).toContain("다시 시도");
    expect(container.querySelector('a[href="/wedding"]')).not.toBeNull();
    expect(container.querySelector('a[href^="/wedding/community/my/"]')).not.toBeNull();
  });

  it.each(pages)("creates one client after configured render and checks auth: $name", async ({ Page }) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://preview.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "preview-public-key");
    const events: string[] = [];
    const getUser = vi.fn(async () => {
      events.push("getUser");
      return { data: { user: null } };
    });
    mocks.createBrowserClient.mockImplementation(() => {
      events.push("createBrowserClient");
      return { auth: { getUser } };
    });

    const { root } = await renderPage(Page);
    await act(async () => {
      root.render(<Page />);
      await Promise.resolve();
    });

    expect(events).toEqual(["createBrowserClient", "getUser"]);
    expect(mocks.createBrowserClient).toHaveBeenCalledOnce();
    expect(mocks.createBrowserClient).toHaveBeenCalledWith(
      "https://preview.example.test",
      "preview-public-key"
    );
    expect(mocks.routerPush).toHaveBeenCalledOnce();
    expect(mocks.routerPush).toHaveBeenCalledWith(expect.stringContaining("/login?redirect="));
  });

  it("falls back when configured client construction fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "malformed-preview-url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "preview-public-key");
    mocks.createBrowserClient.mockImplementation(() => {
      throw new Error("invalid Supabase URL");
    });

    const { container } = await renderPage(MyBookmarksPage);

    expect(container.textContent).toContain("내 활동을 지금 불러오지 못했어요");
    expect(mocks.routerPush).not.toHaveBeenCalled();
  });

  it("falls back when the configured auth check rejects", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://preview.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "preview-public-key");
    mocks.createBrowserClient.mockReturnValue({
      auth: { getUser: vi.fn().mockRejectedValue(new Error("auth unavailable")) },
    });

    const { container } = await renderPage(MyBookmarksPage);

    expect(container.textContent).toContain("내 활동을 지금 불러오지 못했어요");
    expect(mocks.routerPush).not.toHaveBeenCalled();
  });
});
