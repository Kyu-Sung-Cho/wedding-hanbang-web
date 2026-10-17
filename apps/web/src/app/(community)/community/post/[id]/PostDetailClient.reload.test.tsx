import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostDetail } from "@/types/community.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ push: vi.fn(), getUser: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/image", () => ({ default: () => <span /> }));
vi.mock("@supabase/ssr", () => ({ createBrowserClient: () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/hooks/useCommentsRealtime", () => ({ useCommentsRealtime: vi.fn() }));
vi.mock("@/components/community/AiCommentBox", () => ({ default: () => null }));
vi.mock("@/components/community/CostShareDisplay", () => ({ default: () => null }));
vi.mock("@/components/community/CommentSection", () => ({ default: () => null }));
vi.mock("@/components/community/ServiceCTA", () => ({ default: () => null }));
vi.mock("@/components/community/Avatar", () => ({ default: () => null }));
vi.mock("@/components/community/PollDisplay", () => ({ default: () => null }));
vi.mock("@/components/community/SlideCarousel", () => ({ default: () => null }));
vi.mock("@/components/community/BlockUserButton", () => ({ default: () => null }));

import PostDetailClient from "./PostDetailClient";
import { useCommunityStore } from "@/stores/communityStore";
import { useAuthStore } from "@/stores/authStore";

const POST = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";
const roots: Root[] = [];
let detailFetch = vi.fn<() => Promise<Response>>();

function post(authorId = B, visibility: "draft" | "public" | "members" = "draft"): PostDetail {
  return {
    id: POST, author_id: authorId, content_origin: "member", category: "free",
    title: `${authorId === B ? "B" : "A"}의 저장한 글`, content: `<p>${authorId === B ? "B" : "A"}의 본문</p>`,
    images: [], slides: null, visibility, ad_disclosure: "general", sponsorship_detail: null,
    ai_comment: null, is_resolved: false, is_verified_review: false, verification_doc_url: null,
    price_data: null, is_quick_review: false, rating: null, cohort_room_id: null, under_review: false,
    upvote_count: 0, downvote_count: 0, comment_count: 0, view_count: 0, bookmark_count: 0,
    is_pinned: false, is_weekly_best: false, vendor_tags: [], tags: ["저장한 태그"], cost_data: null,
    created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-18T00:00:00Z",
    author: { user_id: authorId, nickname: "합성 작성자", avatar_url: null, rank: "sprout", wedding_year: null, wedding_month: null, wedding_completed: false, progress_percent: 0, region: null, post_count: 1, comment_count: 0, total_upvotes_received: 0, warning_count: 0, is_suspended: false, created_at: "2026-10-18T00:00:00Z" },
    user_vote: null, user_bookmarked: false, vendor_details: [], poll: null,
  };
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
async function render(initialPost?: PostDetail | null) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => { root.render(<PostDetailClient postId={POST} initialPost={initialPost} />); });
  return container;
}
async function bind(id: string | null) {
  await act(async () => { useCommunityStore.getState().bindViewer(id); });
}
async function respond(request: ReturnType<typeof deferred>, payload: PostDetail) {
  await act(async () => { request.resolve(Response.json(payload)); });
}

describe("post detail reload ownership and recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    useCommunityStore.setState({ viewerId: null, privacyEpoch: 0, currentPost: null, postLoading: false, errorMessage: null, comments: [], commentsPostId: null });
    useAuthStore.setState({ user: null, profile: null, isInitialized: false, isLoading: false });
    mocks.getUser.mockResolvedValue({ data: { user: { id: B } } });
    detailFetch = vi.fn<() => Promise<Response>>();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === `/api/community/posts/${POST}` && !init?.method) return detailFetch();
      return Promise.resolve(Response.json({ posts: [] }));
    }));
  });
  afterEach(async () => {
    await act(async () => { roots.splice(0).forEach(root => root.unmount()); });
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("requeries after null → B bootstrap instead of leaving the rejected first response blank", async () => {
    const guestRequest = deferred();
    detailFetch.mockReturnValueOnce(guestRequest.promise).mockResolvedValueOnce(Response.json(post()));
    const container = await render();
    await bind(B);
    await respond(guestRequest, post());
    expect(detailFetch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("B의 저장한 글");
    expect(container.textContent).toContain("B의 본문");
    expect(container.textContent).toContain("아직 발행하지 않은 임시저장 글");
  });

  it("recovers when bootstrap binds B after the first GET already completed", async () => {
    detailFetch.mockImplementation(async () => Response.json(post()));
    const container = await render();
    expect(container.textContent).not.toContain("B의 본문");
    await bind(B);
    expect(detailFetch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("B의 본문");
  });

  it("keeps a late B detail fenced after B → A and displays only A's fresh receipt", async () => {
    useCommunityStore.getState().bindViewer(B);
    const oldB = deferred();
    detailFetch.mockReturnValueOnce(oldB.promise).mockResolvedValueOnce(Response.json(post(A)));
    const container = await render();
    await bind(A);
    await respond(oldB, post());
    expect(detailFetch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("A의 본문");
    expect(container.textContent).not.toContain("B의 본문");
    expect(useCommunityStore.getState().currentPost?.author_id).toBe(A);
  });

  it("does not restore a private B receipt on logout while the SDK still reports B", async () => {
    useCommunityStore.getState().bindViewer(B);
    const oldB = deferred();
    detailFetch.mockReturnValueOnce(oldB.promise).mockResolvedValueOnce(Response.json(post()));
    const container = await render();
    await bind(null);
    await respond(oldB, post());
    expect(container.textContent).not.toContain("B의 본문");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('a[href*="/post/write"]')).toBeNull();
  });

  it("clears an already displayed private detail on logout and can show an anonymous public retry", async () => {
    useCommunityStore.getState().bindViewer(B);
    detailFetch.mockResolvedValueOnce(Response.json(post())).mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(Response.json(post(A, "public")));
    const container = await render();
    expect(container.textContent).toContain("B의 본문");
    await bind(null);
    expect(container.textContent).not.toContain("B의 본문");
    const retry = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("다시 불러오기"));
    await act(async () => { retry?.click(); });
    expect(container.textContent).toContain("A의 본문");
    expect(container.querySelector('a[href*="/post/write"]')).toBeNull();
  });

  it.each(["draft", "members"] as const)("does not render a %s receipt under the anonymous boundary", async visibility => {
    detailFetch.mockResolvedValueOnce(Response.json(post(B, visibility)));
    const container = await render();
    expect(container.textContent).not.toContain("B의 본문");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("does not render another account's draft even if a successful response arrives in the new boundary", async () => {
    useCommunityStore.getState().bindViewer(A);
    detailFetch.mockResolvedValueOnce(Response.json(post()));
    const container = await render();
    expect(container.textContent).not.toContain("B의 본문");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("preserves server-authorized admin reading only for the confirmed current actor", async () => {
    useCommunityStore.getState().bindViewer(A);
    const reviewed = { ...post(), under_review: true };
    useAuthStore.setState({ user: { id: A, email: "admin@example.invalid" }, profile: {
      id: A, name: "합성 관리자", role: null, couple_id: null, avatar_url: null,
      onboarding_completed: true, onboarding_step: 1, is_admin: true,
      created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-18T00:00:00Z",
    }, isInitialized: true });
    detailFetch.mockImplementation(async () => Response.json(reviewed));
    const container = await render();
    expect(container.textContent).toContain("B의 본문");
    await bind(B);
    await bind(null);
    expect(container.textContent).not.toContain("B의 본문");
  });

  it("keeps the old epoch fenced when the same B account signs in again", async () => {
    useCommunityStore.getState().bindViewer(B);
    const oldB = deferred();
    const newB = { ...post(), title: "새 세션의 B 글", content: "<p>새 세션 본문</p>" };
    detailFetch.mockReturnValueOnce(oldB.promise).mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(Response.json(newB));
    const container = await render();
    await bind(null);
    await bind(B);
    await respond(oldB, post());
    expect(detailFetch).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("새 세션 본문");
    expect(container.textContent).not.toContain("B의 본문");
  });

  it("preserves anonymous public SSR content while its own lookup is pending", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    detailFetch.mockReturnValue(deferred().promise);
    const container = await render(post(A, "public"));
    expect(container.textContent).toContain("A의 본문");
    expect(container.querySelector('a[href*="/post/write"]')).toBeNull();
  });

  it("does not reuse an anonymous initial cache after a viewer change rejects access", async () => {
    detailFetch.mockResolvedValue(new Response(null, { status: 404 }));
    const container = await render(post(A, "public"));
    expect(container.textContent).toContain("A의 본문");
    await bind(B);
    expect(container.textContent).not.toContain("A의 본문");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it.each([401, 404, 503])("shows a recoverable error for HTTP %s and loads a successful retry", async status => {
    useCommunityStore.getState().bindViewer(B);
    detailFetch.mockResolvedValueOnce(new Response(null, { status })).mockResolvedValueOnce(Response.json(post()));
    const container = await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("불러오지 못했어요");
    const retry = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("다시 불러오기"));
    expect(retry).toBeDefined();
    await act(async () => { retry?.click(); });
    expect(detailFetch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("B의 본문");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows the same recovery after a network rejection without leaking its internal message", async () => {
    useCommunityStore.getState().bindViewer(B);
    detailFetch.mockRejectedValueOnce(new Error("private-internal-db-context"));
    const container = await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("불러오지 못했어요");
    expect(container.textContent).not.toContain("private-internal-db-context");
  });

  it("bounds a hanging request and permits retry without exposing a cached unrelated post", async () => {
    vi.useFakeTimers();
    useCommunityStore.getState().bindViewer(B);
    useCommunityStore.setState({ currentPost: { ...post(), id: "other-post", title: "관련 없는 캐시" } });
    const slow = deferred();
    const latest = { ...post(), title: "재시도로 확인한 최신 글", content: "<p>재시도의 최신 본문</p>" };
    detailFetch.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(Response.json(latest));
    const container = await render();
    expect(container.textContent).toContain("글을 불러오는 중");
    expect(container.textContent).not.toContain("관련 없는 캐시");
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("불러오지 못했어요");
    const retry = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("다시 불러오기"));
    await act(async () => { retry?.click(); });
    expect(container.textContent).toContain("재시도의 최신 본문");
    await respond(slow, post());
    expect(container.textContent).toContain("재시도의 최신 본문");
    expect(container.textContent).not.toContain("B의 본문");
  });
});
