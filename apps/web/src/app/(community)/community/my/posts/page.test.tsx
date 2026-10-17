import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("next/navigation", () => {
  const router = { push: mocks.routerPush };
  return { useRouter: () => router };
});

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: mocks.getUser,
    },
  }),
}));

vi.mock("@/components/community/Avatar", () => ({
  default: () => <div>avatar</div>,
}));

import MyPostsPage from "./page";
import { useAuthStore } from "@/stores/authStore";
import { useCommunityStore } from "@/stores/communityStore";

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

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

async function changeSession(id: string) {
  await act(async () => {
    useCommunityStore.getState().bindViewer(id);
    useAuthStore.setState({ user: { id, email: "qa@example.invalid" }, profile: null, isInitialized: true, isDemo: false });
  });
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 20)); });
}

describe("my question status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "author-1" } } });
    useCommunityStore.getState().bindViewer("author-1");
    useAuthStore.setState({ user: { id: "author-1", email: "qa@example.invalid" }, profile: null, isInitialized: true, isDemo: false });
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://preview-project.supabase.co",
    );
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "preview-public-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("/api/community/posts?")) {
          await new Promise((resolve) => window.setTimeout(resolve, 5));
          return {
            ok: true,
            json: async () => ({
              posts: [
                {
                  id: "post-1",
                  author_id: "author-1",
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
                  author_id: "author-1",
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
          if (init?.method === "POST") {
            return {
              ok: true,
              json: async () => ({
                profile: {
                  user_id: "author-1",
                  nickname: "anonymous-couple",
                  avatar_url: null,
                },
              }),
            };
          }
          return {
            ok: true,
            json: async () => ({ profile: null }),
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
    useAuthStore.getState().reset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("shows open and resolved states and links comment counts to the discussion", async () => {
    const container = await renderPage();

    expect(fetch).toHaveBeenCalledWith(
      "/api/community/posts?author_id=author-1&limit=100",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/community/profile",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
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

  it("bootstraps a fresh uninitialized session through the verified user lookup", async () => {
    useCommunityStore.setState({ viewerId: null, privacyEpoch: 0 });
    useAuthStore.setState({ user: null, profile: null, isInitialized: false });
    const container = await renderPage();
    expect(container.textContent).toContain("해결한 질문");
    expect(mocks.routerPush).not.toHaveBeenCalled();
  });

  it("clears local posts and profile on logout without accepting the still-pending SDK session again", async () => {
    const container = await renderPage();
    expect(container.textContent).toContain("해결한 질문");
    expect(container.textContent).toContain("anonymous-couple");
    const previousCalls = mocks.getUser.mock.calls.length;
    await act(async () => {
      useAuthStore.getState().reset();
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
    expect(container.textContent).not.toContain("해결한 질문");
    expect(container.textContent).not.toContain("anonymous-couple");
    expect(mocks.getUser.mock.calls.length).toBe(previousCalls);
  });

  it("does not reuse the outgoing SDK session when mounted after a reset", async () => {
    const first = await renderPage();
    expect(first.textContent).toContain("해결한 질문");
    await act(async () => {
      const previous = mountedRoots.pop()!;
      previous.root.unmount(); previous.container.remove();
      useAuthStore.getState().reset();
    });
    const previousCalls = mocks.getUser.mock.calls.length;
    const container = await renderPage();
    expect(container.textContent).not.toContain("해결한 질문");
    expect(container.textContent).not.toContain("anonymous-couple");
    expect(mocks.getUser.mock.calls.length).toBe(previousCalls);
    await changeSession("author-1");
    expect(container.textContent).toContain("해결한 질문");
  });

  it("ignores an outgoing account's late post response even when abort is ignored", async () => {
    const pending = deferredResponse();
    const fallback = fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("author_id=author-1")) return pending.promise;
      if (String(input).includes("author_id=author-2")) return Response.json({ posts: [{ id: "b-post", author_id: "author-2", category: "free", visibility: "public", title: "B의 새 글", created_at: "2026-10-17T00:00:00Z" }] });
      return fallback(input, init);
    }));
    const container = await renderPage();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "author-2" } } });
    await changeSession("author-2");
    expect(container.textContent).toContain("B의 새 글");
    await act(async () => {
      pending.resolve(Response.json({ posts: [{ id: "late-a", author_id: "author-1", category: "free", visibility: "public", title: "A의 늦은 글" }] }));
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("A의 늦은 글");
    expect(container.textContent).toContain("B의 새 글");
  });

  it("does not auto-create a profile after its owner changed during the preceding GET", async () => {
    const pending = deferredResponse();
    const fallback = fetch;
    let profileReads = 0;
    const profileCreates = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/community/profile") {
        if (init?.method === "POST") { profileCreates(); return Response.json({ profile: null }); }
        if (++profileReads === 1) return pending.promise;
        return Response.json({ profile: { user_id: "author-2", nickname: "B 프로필", avatar_url: null } });
      }
      if (String(input).includes("author_id=author-2")) return Response.json({ posts: [] });
      return fallback(input, init);
    }));
    const container = await renderPage();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "author-2" } } });
    await changeSession("author-2");
    await act(async () => { pending.resolve(Response.json({ profile: null })); await Promise.resolve(); });
    expect(profileCreates).not.toHaveBeenCalled();
    expect(container.textContent).toContain("B 프로필");
    expect(container.textContent).not.toContain("anonymous-couple");
  });

  it.each([401, 403, 503])("shows a %s read failure separately from a normal empty list and can retry", async (status) => {
    const fallback = fetch;
    let failed = true;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/community/posts?") && failed) return Response.json({ error: "synthetic failure" }, { status });
      return fallback(input, init);
    }));
    const container = await renderPage();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(status === 401 ? "로그인" : status === 403 ? "접근" : "불러오지 못했어요");
    expect(container.textContent).not.toContain("아직 작성한 글이 없습니다");
    failed = false;
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="내 글 다시 불러오기"]')?.click());
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 20)); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("해결한 질문");
  });

  it("keeps a successful zero-result response distinct from read errors", async () => {
    const fallback = fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith("/api/community/posts?") ? Response.json({ posts: [] }) : fallback(input, init)));
    const container = await renderPage();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("아직 작성한 글이 없습니다");
  });

  it.each([{ posts: null }, { posts: [{ id: "unknown-owner" }] }, { posts: [{ id: "foreign", author_id: "author-2" }] }])("rejects malformed or foreign-owner post payloads: %j", async (payload) => {
    const fallback = fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith("/api/community/posts?") ? Response.json(payload) : fallback(input, init)));
    const container = await renderPage();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("작성자를 확인하지 못했어요");
    expect(container.textContent).not.toContain("아직 작성한 글이 없습니다");
  });

  it("ignores an old profile PATCH after logout and signing back into the same user id", async () => {
    const pending = deferredResponse();
    const fallback = fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input) === "/api/community/profile" && init?.method === "PATCH" ? pending.promise : fallback(input, init)));
    const container = await renderPage();
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("프로필 수정"))?.click());
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "저장")?.click());
    await act(async () => { useAuthStore.getState().reset(); });
    await changeSession("author-1");
    await act(async () => { pending.resolve(Response.json({ profile: { user_id: "author-1", nickname: "이전 세션의 늦은 이름" } })); await Promise.resolve(); });
    expect(container.textContent).not.toContain("이전 세션의 늦은 이름");
    expect(container.textContent).not.toContain("프로필이 저장되었습니다");
    expect(container.textContent).toContain("anonymous-couple");
  });

  it("ignores an old delete receipt after logout and returning to the same account", async () => {
    const pending = deferredResponse();
    const fallback = fetch;
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => init?.method === "DELETE" ? pending.promise : fallback(input, init)));
    const container = await renderPage();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="해결한 질문 삭제"]')?.click());
    await act(async () => { useAuthStore.getState().reset(); });
    await changeSession("author-1");
    await act(async () => { pending.resolve(Response.json({ ok: true })); await Promise.resolve(); });
    expect(container.textContent).toContain("해결한 질문");
  });
});
