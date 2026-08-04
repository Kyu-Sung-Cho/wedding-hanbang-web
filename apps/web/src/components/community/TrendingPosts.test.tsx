import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

import TrendingPosts from "./TrendingPosts";
import { useAuthStore } from "@/stores/authStore";
import { useCommunityStore } from "@/stores/communityStore";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flushEffects() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("TrendingPosts viewer cache boundary", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    useAuthStore.setState({
      user: { id: "user-a", email: "a@example.com" },
      isInitialized: true,
    });
    useCommunityStore.getState().reset();
    useCommunityStore.getState().bindViewer("user-a");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
  });

  it("never renders A's cached trending result after switching to B", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          posts: [{ id: "a-post", title: "A private title", upvote_count: 3, comment_count: 1 }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          posts: [{ id: "b-post", title: "B safe title", upvote_count: 4, comment_count: 2 }],
        }),
      });

    await act(async () => {
      root?.render(<TrendingPosts />);
      await flushEffects();
    });
    expect(container?.textContent).toContain("A private title");

    await act(async () => {
      useCommunityStore.getState().bindViewer("user-b");
      useAuthStore.setState({
        user: { id: "user-b", email: "b@example.com" },
        isInitialized: true,
      });
      await flushEffects();
    });

    expect(container?.textContent).not.toContain("A private title");
    expect(container?.textContent).toContain("B safe title");
    const communityKeys = Array.from(
      { length: sessionStorage.length },
      (_, index) => sessionStorage.key(index),
    ).filter((key): key is string => Boolean(key?.startsWith("community:")));
    expect(communityKeys.some((key) => key.includes("user-a"))).toBe(false);
    expect(communityKeys.some((key) => key.includes("user-b"))).toBe(true);
  });
});
