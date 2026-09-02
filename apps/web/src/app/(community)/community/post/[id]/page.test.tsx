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
  viewerPostError: null as { code?: string; message: string } | null,
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
          data:
            mocks.viewerPostError || !mocks.viewerPostVisible
              ? null
              : { id: "post-1" },
          error: mocks.viewerPostError,
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
    mocks.serverUserId = null;
    mocks.serverAuthError = null;
    mocks.viewerPostVisible = true;
    mocks.viewerPostError = null;
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

  /**
   * 세션을 확인하지 못한 방문자에게도 **공개 글은 공개 글대로** 보여준다.
   *
   * ## 전에는 반대였고, 그것이 출시를 막은 화면이었다
   *
   * 여기 있던 검사는 "확인이 불확실하면 익명 로더를 쓰지 않는다" 를 요구했다.
   * 그래서 만료·폐기된 세션 쿠키를 든 사람은 `initialPost={null}` 인 클라이언트
   * 껍데기를 받았고, 그 껍데기를 채워야 할 `/api/community/posts/<id>` 는 **같은
   * 이유로** 503 을 냈다. 스피너가 끝나지 않고, 오류 문구조차 없다.
   *
   * 2026-09-02 운영 실측(형식은 정상이고 Supabase 가 거절하는 세션 쿠키):
   *
   *     /wedding/community/post/<uuid>  → 200, 본문 0자, aria-busy 스피너만
   *     /api/community/posts/<uuid>     → 503
   *     보이는 글자 354자 = 내비와 푸터뿐
   *
   * ## 왜 이제 보여줘도 되는가 — 이 payload 에는 뷰어가 없다
   *
   * `getPublicCommunityPostDetail` 은 `visibility=public`·`under_review=false` 만
   * 읽고 `user_vote`·`user_bookmarked` 를 null 로, `verification_doc_url` 을 null 로
   * 고정한다. **로그아웃 방문자가 받는 바이트와 같다.**
   *
   * 그 바이트는 이미 인터넷 전체에 열려 있다 — 2026-09-02 실측: 세션 없이 anon 키만
   * 으로 PostgREST 가 같은 행을 200 으로 내주고, 쿠키 없는 브라우저는 본문을 받는다.
   *
   * 차단(`community_viewer_can_see`)은 이 판단과 층이 다르다. 그 함수는 뷰어 id 와
   * 상대 id 를 **둘 다** 요구하고 하나라도 null 이면 예외를 던진다(마이그레이션
   * `20260804180000`). 즉 누구인지 모르는 방문자에게는 **정의되지 않는** 제품 기능이지
   * 공개 글에 걸린 기밀 경계가 아니다. 차단당한 사람도 시크릿 창이면 같은 글을 읽는다.
   *
   * 신원이 **확인된** 뷰어에게 차단이 그대로 적용되는 것은 아래 두 검사가 계속 잰다.
   */
  it("세션을 확인하지 못해도 공개 글은 본문까지 내려준다", async () => {
    mocks.cookieHeader.value = "sb-slrtobkksjmxgzatjyqb-auth-token=stale-session";
    mocks.serverAuthError = { message: "auth unavailable" };
    mocks.post = null;
    mocks.getPublicCommunityPostDetail.mockResolvedValue(
      question({
        title: "확인 못 한 방문자도 공개 글을 읽는다",
        content: "공개 본문",
      }),
    );

    const element = await PostDetailPage({
      params: Promise.resolve({ id: "post-1" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("확인 못 한 방문자도 공개 글을 읽는다");
    expect(html).toContain("공개 본문");
    // 뷰어 클라이언트가 아니라 **공개 로더**를 탄다 — 그래야 members·검토중 글이
    // 섞이지 않는다.
    expect(mocks.getPublicCommunityPostDetail).toHaveBeenCalledWith("post-1");
  });

  it("세션을 확인하지 못한 방문자에게도 없는 글은 없다고 말한다", async () => {
    mocks.cookieHeader.value = "sb-slrtobkksjmxgzatjyqb-auth-token=stale-session";
    mocks.serverAuthError = { message: "auth unavailable" };
    mocks.getPublicCommunityPostDetail.mockResolvedValue(null);

    const html = renderToStaticMarkup(
      await PostDetailPage({ params: Promise.resolve({ id: "missing" }) }),
    );

    expect(html).toContain("글을 찾을 수 없어요");
  });
});

/**
 * 로그인한 사람에게도 "왜 못 보여주는지" 를 사실대로 말한다.
 *
 * 이 갈래는 `visiblePostError || !visiblePost` 를 한 덩어리로 묶어 **무엇이든**
 * 「글을 찾을 수 없어요」로 답했다. 그래서 DB 가 잠깐 흔들린 것도 "없는 글" 이 됐고,
 * 사용자에게는 되돌릴 방법이 없는 최종 답처럼 보였다.
 */
describe("로그인한 뷰어의 실패 구분", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userId = null;
    mocks.post = null;
    mocks.cookieHeader.value = null;
    mocks.serverAuthError = null;
    mocks.viewerPostVisible = true;
    mocks.serverUserId = "20000000-0000-4000-8000-000000000002";
    mocks.viewerPostError = null;
  });

  it("일시적인 읽기 실패를 '없는 글' 이라고 하지 않는다", async () => {
    mocks.viewerPostError = { code: "57014", message: "canceling statement" };

    const html = renderToStaticMarkup(
      await PostDetailPage({ params: Promise.resolve({ id: "post-1" }) }),
    );

    expect(html).toContain("글을 불러오지 못했어요");
    expect(html).not.toContain("글을 찾을 수 없어요");
    // 내부 오류 원문은 화면에 쓰지 않는다.
    expect(html).not.toContain("canceling statement");
    expect(html).not.toContain("57014");
  });

  it("UUID 가 아닌 주소에는 '잠시 뒤 다시' 가 아니라 '없는 글' 이라고 말한다", async () => {
    // 22P02 는 비교 자체가 불가능하다는 뜻이라 다시 시도해도 영원히 같다.
    // 로그아웃 경로와 같은 답을 줘야 두 화면이 갈리지 않는다.
    mocks.viewerPostError = {
      code: "22P02",
      message: 'invalid input syntax for type uuid: "1"',
    };

    const html = renderToStaticMarkup(
      await PostDetailPage({ params: Promise.resolve({ id: "1" }) }),
    );

    expect(html).toContain("글을 찾을 수 없어요");
    expect(html).not.toContain("글을 불러오지 못했어요");
  });
});
