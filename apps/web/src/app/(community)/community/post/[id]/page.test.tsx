import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostDetail } from "@/types/community.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  post: null as PostDetail | null,
  userId: "11111111-1111-4111-8111-111111111111" as string | null,
  fetchPostDetail: vi.fn(),
  incrementView: vi.fn(),
  votePost: vi.fn(),
  toggleBookmark: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  routerPush: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  getPublicCommunityPostDetail: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush }),
  notFound: mocks.notFound,
}));

vi.mock("@/lib/community/publicPostDetail", () => ({
  getPublicCommunityPostDetail: mocks.getPublicCommunityPostDetail,
}));

vi.mock("next/image", () => ({
  default: () => <span data-testid="next-image" />,
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: mocks.userId ? { id: mocks.userId } : null,
        },
      })),
    },
  }),
}));

vi.mock("@/stores/communityStore", () => ({
  useCommunityStore: () => ({
    currentPost: mocks.post,
    postLoading: false,
    fetchPostDetail: mocks.fetchPostDetail,
    incrementView: mocks.incrementView,
    votePost: mocks.votePost,
    toggleBookmark: mocks.toggleBookmark,
    updatePost: mocks.updatePost,
    deletePost: mocks.deletePost,
  }),
}));

vi.mock("@/hooks/useCommentsRealtime", () => ({
  useCommentsRealtime: vi.fn(),
}));

vi.mock("@/components/community/AiCommentBox", () => ({
  default: () => <div>ai comment</div>,
}));
vi.mock("@/components/community/CostShareDisplay", () => ({
  default: () => <div>cost</div>,
}));
vi.mock("@/components/community/CommentSection", () => ({
  default: () => <div>comments</div>,
}));
vi.mock("@/components/community/ServiceCTA", () => ({
  default: () => <div>service</div>,
}));
vi.mock("@/components/community/Avatar", () => ({
  default: () => <div>avatar</div>,
}));
vi.mock("@/components/community/AdDisclosureBadge", () => ({
  default: () => <div>disclosure</div>,
}));
vi.mock("@/components/community/PollDisplay", () => ({
  default: () => <div>poll</div>,
}));
vi.mock("@/components/community/SlideCarousel", () => ({
  default: () => <div>slides</div>,
}));

import PostDetailClient from "./PostDetailClient";
import PostDetailPage from "./page";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function question(overrides: Partial<PostDetail> = {}): PostDetail {
  return {
    id: "post-1",
    author_id: "11111111-1111-4111-8111-111111111111",
    content_origin: "member",
    category: "is_normal",
    title: "계약 전에 이 항목을 확인해야 할까요?",
    content: "견적서에 처음 보는 항목이 있어요.",
    images: [],
    slides: null,
    visibility: "public",
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
    comment_count: 2,
    view_count: 4,
    bookmark_count: 0,
    is_pinned: false,
    is_weekly_best: false,
    vendor_tags: [],
    tags: [],
    cost_data: null,
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
    author: {
      user_id: "11111111-1111-4111-8111-111111111111",
      nickname: "예비부부",
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
      created_at: "2026-07-30T00:00:00.000Z",
    },
    user_vote: null,
    user_bookmarked: false,
    poll: null,
    vendor_details: [],
    ...overrides,
  };
}

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(<PostDetailClient initialPost={mocks.post ?? question()} />);
    await Promise.resolve();
    await Promise.resolve();
  });

  return container;
}

describe("question resolution control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.post = question();
    mocks.userId = "11111111-1111-4111-8111-111111111111";
    mocks.updatePost.mockResolvedValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ posts: [] }),
      })),
    );
  });

  afterEach(async () => {
    await act(async () => {
      for (const { root } of mountedRoots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("lets the question author mark the post resolved", async () => {
    const container = await renderPage();
    expect(container.textContent).toContain("답변을 확인 중인 질문");
    expect(container.textContent).toContain("사람의 답변 2개");
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("해결됨으로 표시"),
    );

    expect(button).toBeDefined();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.updatePost).toHaveBeenCalledWith("post-1", {
      is_resolved: true,
    });
    expect(container.querySelector("#comments")?.textContent).toContain(
      "comments",
    );
  });

  it("offers reopening without calling any comment an accepted answer", async () => {
    mocks.post = question({ category: "ama", is_resolved: true });

    const container = await renderPage();

    expect(container.textContent).toContain("다시 열기");
    expect(container.textContent).toContain("질문자가 해결됐다고 표시한 기록");
    expect(container.textContent).not.toContain("채택된 답변");
    expect(container.textContent).not.toContain("답변 채택");
  });

  it("hides the control from someone who did not write the question", async () => {
    mocks.userId = "99999999-9999-4999-8999-999999999999";

    const container = await renderPage();

    expect(container.textContent).not.toContain("해결됨으로 표시");
    expect(container.textContent).not.toContain("다시 열기");
  });

  it("keeps a retryable control and explains a failed save", async () => {
    mocks.updatePost.mockResolvedValue(false);
    const container = await renderPage();
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("해결됨으로 표시"),
    );

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "연결을 확인한 뒤 다시 시도해 주세요.",
    );
    expect(button?.hasAttribute("disabled")).toBe(false);
  });
});

describe("public post server rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userId = null;
  });

  it("puts the public title, body, and database-backed origin in the server HTML", async () => {
    const initialPost = question({
      content_origin: "operator",
      title: "서버에서 먼저 보이는 계약 질문",
      content: "<p>원문 계약서를 먼저 확인했어요.</p>",
    });
    mocks.post = null;
    mocks.getPublicCommunityPostDetail.mockResolvedValue(initialPost);

    const element = await PostDetailPage({
      params: Promise.resolve({ id: "post-1" }),
    });
    const html = renderToStaticMarkup(element);

    expect(mocks.getPublicCommunityPostDetail).toHaveBeenCalledWith("post-1");
    expect(html).toContain("서버에서 먼저 보이는 계약 질문");
    expect(html).toContain("원문 계약서를 먼저 확인했어요.");
    expect(html).toContain('data-content-origin="operator"');
    expect(html).toContain("웨딩한방 운영팀");
    expect(html).not.toContain("게시글을 찾을 수 없습니다");
  });

  it("uses the framework 404 for a missing or non-public post", async () => {
    mocks.getPublicCommunityPostDetail.mockResolvedValue(null);

    await expect(
      PostDetailPage({
        params: Promise.resolve({ id: "private-post" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });
});
