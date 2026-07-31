import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "author-1" } },
      })),
    },
  }),
}));

vi.mock("@/components/community/Avatar", () => ({
  default: () => <div>avatar</div>,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => null,
}));

import MyPostsPage from "./page";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(<MyPostsPage />);
  });
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  });

  return container;
}

describe("my question status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://preview-project.supabase.co",
    );
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "preview-public-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/community/posts?")) {
          await new Promise((resolve) => window.setTimeout(resolve, 5));
          return {
            ok: true,
            json: async () => ({
              posts: [
                {
                  id: "post-1",
                  category: "is_normal",
                  title: "해결한 질문",
                  visibility: "public",
                  is_resolved: true,
                  created_at: "2026-07-30T00:00:00.000Z",
                  view_count: 4,
                  upvote_count: 1,
                  comment_count: 3,
                },
                {
                  id: "post-2",
                  category: "ama",
                  title: "답변을 받는 질문",
                  visibility: "public",
                  is_resolved: false,
                  created_at: "2026-07-30T00:00:00.000Z",
                  view_count: 2,
                  upvote_count: 0,
                  comment_count: 1,
                },
              ],
            }),
          };
        }
        if (url === "/api/community/profile") {
          return {
            ok: true,
            json: async () => ({}),
          };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(async () => {
    await act(async () => {
      for (const { root } of mountedRoots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("shows open and resolved states and links comment counts to the discussion", async () => {
    const container = await renderPage();

    expect(fetch).toHaveBeenCalledWith(
      "/api/community/posts?author_id=author-1&limit=100",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(container.textContent).toContain("해결됨");
    expect(container.textContent).toContain("답변 받는 중");
    expect(
      container.querySelector(
        'a[href="/wedding/community/post/post-1#comments"]',
      )?.textContent,
    ).toContain("답변 3");
    expect(
      container.querySelector(
        'a[href="/wedding/community/post/post-2#comments"]',
      )?.textContent,
    ).toContain("답변 1");
  });
});
