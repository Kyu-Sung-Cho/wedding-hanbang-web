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
  serverUserId: null as string | null,
  serverAuthError: null as { message: string } | null,
  viewerPostVisible: true,
  cookieHeader: { value: null as string | null },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush }),
  notFound: mocks.notFound,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(
    mocks.cookieHeader.value ? { cookie: mocks.cookieHeader.value } : {},
  ),
}));

vi.mock("@/lib/community/publicPostDetail", () => ({
  getPublicCommunityPostDetail: mocks.getPublicCommunityPostDetail,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: mocks.serverUserId ? { id: mocks.serverUserId } : null,
        },
        error: mocks.serverAuthError,
      })),
    },
    from: vi.fn(() => {
      const query = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn(async () => ({
          data: mocks.viewerPostVisible ? { id: "post-1" } : null,
          error: null,
        })),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      return query;
    }),
  })),
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
    viewerId: mocks.userId,
    privacyEpoch: 0,
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
    const initialPost = mocks.post ?? question();
    root.render(
      <PostDetailClient postId={initialPost.id} initialPost={initialPost} />,
    );
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

  it("shows an own draft as private editing work without public reactions or comments", async () => {
    mocks.post = question({ visibility: "draft", comment_count: 0 });
    const container = await renderPage();
    expect(container.textContent).toContain("아직 발행하지 않은 임시저장 글");
    const resume = Array.from(container.querySelectorAll("a")).find((link) => link.textContent === "이어서 작성");
    expect(resume?.getAttribute("href")).toContain("/community/post/write?edit=post-1");
    expect(container.querySelector('[aria-label="좋아요"]')).toBeNull();
    expect(container.querySelector("#comments")).toBeNull();
    expect(container.querySelector("#decision-next-action")).toBeNull();
    expect(container.querySelector("main")).toBeNull();
  });

  it.each([
    { category: "tour_review", count: 2, status: "작성자가 남긴 기록", response: "의견 2" },
    { category: "is_normal", count: 2, status: "답변을 확인 중인 질문", response: "답변 2" },
    { category: "ama", count: 0, status: "첫 답변을 기다리는 질문", response: "답변" },
  ] as const)("keeps an unverified $category post's state and $count responses without claiming human authorship", async ({ category, count, status, response }) => {
    mocks.post = question({ category, comment_count: count, content_origin: "legacy_unverified" });
    const container = await renderPage();
    expect(container.textContent).not.toContain("사람이 남긴 경험 기록");
    expect(container.textContent).not.toContain("사람의 답변");
    expect(container.textContent).not.toContain("첫 사람 답변");
    expect(container.textContent).toContain("출처 확인 전");
    expect(container.textContent).toContain(status);
    const responseLink = container.querySelector('[aria-label="이 기록 둘러보기"] a[href="#comments"]');
    expect(responseLink?.textContent?.trim()).toBe(response);
    if (category === "is_normal") expect(container.textContent).toContain(`답변 ${count}개가 달렸고`);
  });

  it("lets the question author mark the post resolved", async () => {
    const container = await renderPage();
    expect(container.textContent).toContain("답변을 확인 중인 질문");
    expect(container.textContent).toContain("답변 2개");
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
    mocks.serverUserId = null;
    mocks.serverAuthError = null;
    mocks.viewerPostVisible = true;
    mocks.cookieHeader.value = null;
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

  /**
   * ⚠️ 이 검사는 `notFound()` 가 **던져지는 것**을 요구했다. 실제로 던지고 있었는데,
   * 사용자에게는 **빈 화면**이 나갔다.
   *
   * 이 라우트는 `dynamic = "force-dynamic"` 이라 커뮤니티 껍데기와 로딩 스켈레톤이
   * 먼저 흘러나간다. 그 뒤에 던지면 React 는 그 경계를 실패로 표시하고(`<!--$~-->`)
   * 대체 내용을 끝내 보내지 않는다 — 위 내비와 아래 푸터만 있고 가운데가 빈 화면이다.
   * 2026-08-29 실측(운영·로컬 동일): 실제 글 997자 vs 없는 글 319자, 20초를 기다려도
   * 그대로. `not-found.tsx`·`error.tsx` 를 이 세그먼트에 넣어도 **그리지 않았다.**
   *
   * 그래서 던지지 않고 그 자리에서 안내를 그린다. **지켜야 할 계약은 그대로다** —
   * 없는 글과 차단된 글이 구별되지 않아야 한다. 아래 두 검사가 그것을 잰다.
   */
  it("없는 글에 빈 화면이 아니라 안내를 그린다", async () => {
    mocks.getPublicCommunityPostDetail.mockResolvedValue(null);

    const element = await PostDetailPage({
      params: Promise.resolve({ id: "private-post" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("글을 찾을 수 없어요");
    expect(mocks.notFound).not.toHaveBeenCalled();
    // 껍데기만 남는 것을 막는 게 목적이다 — 본문이 실제로 있는지 센다.
    expect(html.replace(/<[^>]*>/gu, "").trim().length).toBeGreaterThan(40);
  });

  it("읽기 자체가 실패해도 빈 화면을 주지 않는다", async () => {
    // `postError`(예: 주소에 UUID 가 아닌 값)면 로더가 throw 한다. 그것까지 받아야
    // 한다 — 던지면 위와 같은 빈 화면이다.
    mocks.getPublicCommunityPostDetail.mockRejectedValue(
      new Error("COMMUNITY_PUBLIC_POST_DETAIL_UNAVAILABLE"),
    );

    const element = await PostDetailPage({
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("글을 불러오지 못했어요");
    // 내부 식별자와 DB 원문을 화면에 쓰지 않는다.
    expect(html).not.toContain("COMMUNITY_PUBLIC_POST_DETAIL_UNAVAILABLE");
  });

  it("차단된 글은 없는 글과 **글자 하나까지** 같아야 한다", async () => {
    // 여기가 이 검사의 핵심이다. 두 화면이 다르면 "차단됐다"와 "없다"를 구별할 수
    // 있게 되고, 그것만으로 글의 존재가 새어 나간다.
    mocks.serverUserId = "20000000-0000-4000-8000-000000000002";
    mocks.viewerPostVisible = false;
    mocks.getPublicCommunityPostDetail.mockResolvedValue(
      question({
        title: "anonymous fallback must stay hidden",
        content: "blocked author content",
      }),
    );

    const blocked = renderToStaticMarkup(
      await PostDetailPage({ params: Promise.resolve({ id: "post-1" }) }),
    );

    expect(blocked).not.toContain("anonymous fallback must stay hidden");
    expect(blocked).not.toContain("blocked author content");
    expect(mocks.getPublicCommunityPostDetail).not.toHaveBeenCalled();
    expect(mocks.notFound).not.toHaveBeenCalled();

    // 같은 렌더러로 "없는 글"을 그려 **똑같은지** 대조한다.
    mocks.serverUserId = null;
    mocks.viewerPostVisible = true;
    mocks.getPublicCommunityPostDetail.mockResolvedValue(null);
    const missing = renderToStaticMarkup(
      await PostDetailPage({ params: Promise.resolve({ id: "missing" }) }),
    );

    expect(blocked).toBe(missing);
  });

  it("does not put an anonymous detail fallback in signed-in server HTML", async () => {
    mocks.serverUserId = "20000000-0000-4000-8000-000000000002";
    mocks.viewerPostVisible = true;
    mocks.post = null;
    mocks.getPublicCommunityPostDetail.mockResolvedValue(
      question({
        title: "anonymous initial title must not hydrate a member viewer",
        content: "anonymous initial body must not hydrate a member viewer",
      }),
    );

    const element = await PostDetailPage({
      params: Promise.resolve({ id: "post-1" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain(
      "anonymous initial title must not hydrate a member viewer",
    );
    expect(html).not.toContain(
      "anonymous initial body must not hydrate a member viewer",
    );
    expect(mocks.getPublicCommunityPostDetail).not.toHaveBeenCalled();
  });

  /**
   * 로그아웃 방문자에게 getUser()는 늘 "세션 없음" 오류다. 그것까지 확인 실패로
   * 읽으면 익명 상세 로더가 한 번도 실행되지 않아 서버가 본문 없는 빈 화면을
   * 내려준다 — 링크 미리보기와 크롤러에는 제목조차 남지 않는다.
   */
  it("serves the anonymous detail to a visitor who presented no credential", async () => {
    mocks.serverAuthError = {
      name: "AuthSessionMissingError",
      message: "Auth session missing!",
    } as never;
    mocks.post = null;
    mocks.getPublicCommunityPostDetail.mockResolvedValue(
      question({
        title: "anonymous visitor receives the detail",
        content: "anonymous visitor body",
      }),
    );

    const element = await PostDetailPage({
      params: Promise.resolve({ id: "post-1" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("anonymous visitor receives the detail");
    expect(mocks.getPublicCommunityPostDetail).toHaveBeenCalledWith("post-1");
  });

  it("does not use the anonymous detail loader while authentication is uncertain", async () => {
    mocks.cookieHeader.value = "sb-slrtobkksjmxgzatjyqb-auth-token=broken";
    mocks.serverAuthError = { message: "auth unavailable" };
    mocks.post = null;
    mocks.getPublicCommunityPostDetail.mockResolvedValue(
      question({
        title: "uncertain viewer must not receive anonymous detail",
        content: "uncertain viewer body",
      }),
    );

    const element = await PostDetailPage({
      params: Promise.resolve({ id: "post-1" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain(
      "uncertain viewer must not receive anonymous detail",
    );
    expect(html).not.toContain("uncertain viewer body");
    expect(mocks.getPublicCommunityPostDetail).not.toHaveBeenCalled();
  });
});
