import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PostWithAuthor } from "@/types/community.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/useCommunityRealtime", () => ({ useCommunityRealtime: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));
vi.mock("@/components/community/CommunityDecisionDiscovery", () => ({
  default: () => null,
}));

import CommunityLandingClient from "./CommunityLandingClient";
import { useAuthStore } from "@/stores/authStore";
import { useCommunityStore } from "@/stores/communityStore";

const actorId = "10000000-0000-4000-8000-000000000001";
const postId = "20000000-0000-4000-8000-000000000001";
const roots: Root[] = [];
let posts: PostWithAuthor[];

function makePost(overrides: Partial<PostWithAuthor> = {}): PostWithAuthor {
  return {
    id: postId,
    author_id: actorId,
    content_origin: "member",
    category: "free",
    title: "QA 홈에서 이어 쓸 초안",
    content: "아직 발행하지 않은 합성 QA 글입니다.",
    images: [],
    slides: null,
    visibility: "draft",
    ad_disclosure: "general",
    sponsorship_detail: null,
    ai_comment: null,
    is_resolved: false,
    is_verified_review: false,
    verification_doc_url: null,
    price_data: null,
    is_quick_review: false,
    rating: null,
    cohort_room_id: null,
    under_review: false,
    upvote_count: 0,
    downvote_count: 0,
    comment_count: 0,
    view_count: 0,
    bookmark_count: 0,
    is_pinned: false,
    is_weekly_best: false,
    vendor_tags: [],
    tags: [],
    created_at: "2026-10-18T00:00:00.000Z",
    updated_at: "2026-10-18T00:00:00.000Z",
    author: {
      user_id: actorId,
      nickname: "QA 작성자",
      avatar_url: null,
      rank: "sprout",
      wedding_year: null,
      wedding_month: null,
      wedding_completed: false,
      progress_percent: 0,
      region: null,
      post_count: 1,
      comment_count: 0,
      total_upvotes_received: 0,
      warning_count: 0,
      is_suspended: false,
      created_at: "2026-10-18T00:00:00.000Z",
    },
    ...overrides,
  };
}

async function renderFeed() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<CommunityLandingClient />));
  const title = [...container.querySelectorAll("h3")]
    .find((heading) => heading.textContent === posts[0].title);
  const article = title?.closest("article");
  if (!article) throw new Error("Expected the actual community landing feed row");
  return article;
}

describe("community landing saved draft actions", () => {
  beforeEach(() => {
    posts = [makePost()];
    window.sessionStorage.clear();
    window.localStorage.clear();
    useCommunityStore.setState(useCommunityStore.getInitialState(), true);
    useCommunityStore.getState().bindViewer(actorId);
    useAuthStore.setState({
      user: { id: actorId, email: "qa@example.invalid" },
      profile: {
        id: actorId, name: "QA 작성자", role: null, couple_id: null,
        avatar_url: null, onboarding_completed: true, onboarding_step: 0,
        is_admin: false, created_at: "2026-10-18T00:00:00.000Z",
        updated_at: "2026-10-18T00:00:00.000Z",
      },
      isInitialized: true,
      isLoading: false,
      isDemo: false,
    });
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/community/posts") {
        return Response.json({ posts, total: posts.length, hasMore: false });
      }
      if (url.pathname === `/api/community/posts/${postId}/vote`) {
        return Response.json({ upvote_count: 1, downvote_count: 0 });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    }));
  });

  afterEach(async () => {
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    useAuthStore.getState().reset();
    useCommunityStore.setState(useCommunityStore.getInitialState(), true);
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("identifies the owner's saved draft and offers editing instead of public reactions", async () => {
    const article = await renderFeed();
    expect(article.textContent).toContain("임시저장 · 나만 보기");
    const edit = article.querySelector(`a[href="/wedding/community/post/write?edit=${postId}"]`);
    expect(edit?.textContent).toContain("이어서 작성");
    expect(article.querySelector('a[href$="#comments"]')).toBeNull();
    expect(article.querySelector("button")).toBeNull();
    expect(article.textContent).not.toContain("경험 나누기");
  });

  it.each([
    { category: "is_normal", is_resolved: false, comment_count: 0 },
    { category: "ama", is_resolved: false, comment_count: 2 },
    { category: "is_normal", is_resolved: true, comment_count: 2 },
  ] as const)("does not advertise a draft as a published question: $category/$is_resolved/$comment_count", async (question) => {
    posts = [makePost({
      ...question,
      is_weekly_best: true,
      poll: { id: "qa-poll", question: "발행 전 투표", total_voters: 0, closes_at: null },
    })];
    const article = await renderFeed();
    expect(article.textContent).toContain("임시저장 · 나만 보기");
    expect(article.textContent).not.toMatch(/답변 기다려요|해결됨|답변 \d+개|BEST|투표/);
    expect(article.querySelector('a[href$="#comments"]')).toBeNull();
    expect(article.querySelector("button")).toBeNull();
  });

  it.each(["public", "members"] as const)("keeps existing discussion and reaction actions for %s posts", async (visibility) => {
    posts = [makePost({ visibility, title: "QA 발행된 경험", content: "발행된 합성 QA 글입니다." })];
    const article = await renderFeed();
    expect(article.textContent).not.toContain("임시저장 · 나만 보기");
    expect(article.textContent).not.toContain("이어서 작성");
    expect(article.querySelector(`a[href="/wedding/community/post/${postId}#comments"]`)?.textContent)
      .toContain("경험 나누기");
    const helpful = article.querySelector<HTMLButtonElement>('button[aria-label="도움돼요 0개"]');
    expect(helpful).not.toBeNull();
    expect(article.querySelector('button[aria-label="북마크"]')).not.toBeNull();
    expect(article.querySelector('button[aria-label="공유"]')).not.toBeNull();
    await act(async () => helpful?.click());
    expect(fetch).toHaveBeenCalledWith(`/api/community/posts/${postId}/vote`, expect.objectContaining({
      method: "POST", body: JSON.stringify({ voteType: 1 }),
    }));
  });

  it("preserves published question, poll, best and sponsorship labels", async () => {
    posts = [makePost({
      visibility: "members", category: "is_normal", is_resolved: true,
      is_weekly_best: true, ad_disclosure: "sponsored", sponsorship_detail: "QA 혜택 안내",
      poll: { id: "qa-poll", question: "발행된 투표", total_voters: 0, closes_at: null },
    })];
    const article = await renderFeed();
    expect(article.textContent).toMatch(/해결됨/);
    expect(article.textContent).toMatch(/BEST/);
    expect(article.textContent).toMatch(/투표/);
    expect(article.textContent).toMatch(/협찬/);
    expect(article.querySelector('a[href$="#comments"]')?.textContent).toContain("해결 과정 보기");
  });

  it.each(["different-user", "different-profile"] as const)("does not offer draft editing with a mismatched actor: %s", async (mismatch) => {
    const otherId = "10000000-0000-4000-8000-000000000002";
    const profile = useAuthStore.getState().profile;
    if (!profile) throw new Error("Expected the test actor profile");
    useAuthStore.setState(mismatch === "different-user"
      ? { user: { id: otherId, email: "other@example.invalid" } }
      : { profile: { ...profile, id: otherId } });
    const article = await renderFeed();
    expect(article.textContent).toContain("임시저장 · 나만 보기");
    expect(article.textContent).not.toContain("이어서 작성");
    expect(article.querySelector('a[href*="/post/write?"]')).toBeNull();
    expect(article.querySelector("button")).toBeNull();
  });
});
