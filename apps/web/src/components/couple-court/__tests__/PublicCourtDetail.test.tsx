import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicCourtCase, PublicCourtComment } from "../types";

const mocks = vi.hoisted(() => {
  class MockCourtApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string,
    ) {
      super(message);
      this.name = "CourtApiError";
    }
  }

  return {
    CourtApiError: MockCourtApiError,
    captureCourtEvent: vi.fn(),
    createPublicComment: vi.fn(),
    getPublicCase: vi.fn(),
    listPublicComments: vi.fn(),
    reportPublicCase: vi.fn(),
    votePublicCase: vi.fn(),
  };
});

vi.mock("../api", () => ({
  CourtApiError: mocks.CourtApiError,
  createPublicComment: mocks.createPublicComment,
  getPublicCase: mocks.getPublicCase,
  listPublicComments: mocks.listPublicComments,
  reportPublicCase: mocks.reportPublicCase,
  votePublicCase: mocks.votePublicCase,
}));

vi.mock("../analytics", () => ({
  captureCourtEvent: mocks.captureCourtEvent,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, as, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { as?: string }) => (
    <a href={as ?? String(href)} {...props}>{children}</a>
  ),
}));

import PublicCourtDetail from "../PublicCourtDetail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const post: PublicCourtCase = {
  id: "post-1",
  title: "예산 대화가 엇갈린 사건",
  summary: "두 사람이 예산 우선순위를 다르게 이해했어요.",
  category: "budget",
  mode: "solo",
  commentsCount: 4,
  commentsEnabled: true,
  safetyLevel: "normal",
  votes: { total: 0, counts: {} },
};

const FIRST_REQUEST_ID = "00000000-0000-4000-8000-000000000010";
const SECOND_REQUEST_ID = "00000000-0000-4000-8000-000000000011";

function courtComment(id: string, body: string): PublicCourtComment {
  return { id, body, commentType: "empathy" };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(label));
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("PublicCourtDetail resilient public journey", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.resetAllMocks();
    window.sessionStorage.clear();
    vi.spyOn(window.crypto, "randomUUID").mockReturnValue(FIRST_REQUEST_ID);
    mocks.getPublicCase.mockResolvedValue(post);
    mocks.listPublicComments.mockResolvedValue({ comments: [], nextCursor: null });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps the public case usable when only the comments request fails", async () => {
    mocks.listPublicComments.mockRejectedValue(new Error("댓글 서버에 잠시 연결할 수 없어요."));

    await act(async () => root.render(<PublicCourtDetail postId="post-1" />));
    await settle();

    expect(container.textContent).toContain(post.title);
    expect(container.textContent).toContain(post.summary);
    expect(container.textContent).toContain("댓글 서버에 잠시 연결할 수 없어요.");
    expect(container.textContent).toContain("댓글 다시 불러오기");
    expect(container.textContent).not.toContain("공개 사건을 불러오지 못했어요.");
  });

  it("prepends older comment pages and removes overlap without losing order", async () => {
    mocks.listPublicComments
      .mockResolvedValueOnce({
        comments: [courtComment("comment-3", "세 번째 댓글"), courtComment("comment-4", "네 번째 댓글")],
        nextCursor: "older-cursor",
      })
      .mockResolvedValueOnce({
        comments: [
          courtComment("comment-1", "첫 번째 댓글"),
          courtComment("comment-2", "두 번째 댓글"),
          courtComment("comment-3", "세 번째 댓글"),
        ],
        nextCursor: null,
      });

    await act(async () => root.render(<PublicCourtDetail postId="post-1" />));
    await settle();

    const loadOlder = button(container, "이전 댓글 더 보기");
    expect(loadOlder).toBeDefined();
    await act(async () => loadOlder?.click());
    await settle();

    const bodies = Array.from(container.querySelectorAll("li p"), (node) => node.textContent);
    expect(bodies).toEqual(["첫 번째 댓글", "두 번째 댓글", "세 번째 댓글", "네 번째 댓글"]);
    expect(mocks.listPublicComments).toHaveBeenNthCalledWith(2, "post-1", "older-cursor");
    expect(container.textContent).not.toContain("이전 댓글 더 보기");
  });

  it("restores the post-scoped comment after a full login remount and clears it after success", async () => {
    mocks.createPublicComment.mockRejectedValue(
      new mocks.CourtApiError("로그인이 필요해요.", 401, "AUTH_REQUIRED"),
    );

    await act(async () => root.render(<PublicCourtDetail postId="post-1" />));
    await settle();

    const textarea = container.querySelector<HTMLTextAreaElement>("#court-comment");
    const typeSelect = container.querySelector<HTMLSelectElement>("#comment-type");
    expect(textarea).not.toBeNull();
    await act(async () => {
      if (!textarea || !typeSelect) return;
      setTextareaValue(textarea, "작성 중이던 따뜻한 댓글");
      setSelectValue(typeSelect, "question");
    });
    await act(async () => button(container, "댓글 남기기")?.click());
    await settle();

    expect(mocks.createPublicComment).toHaveBeenLastCalledWith(
      "post-1",
      "question",
      "작성 중이던 따뜻한 댓글",
      FIRST_REQUEST_ID,
    );

    expect(textarea?.value).toBe("작성 중이던 따뜻한 댓글");
    expect(container.textContent).toContain("로그인하면 작성한 내용을 유지한 채");
    const loginLink = Array.from(container.querySelectorAll("a"))
      .find((candidate) => candidate.textContent?.includes("로그인하고 이어서"));
    expect(loginLink?.getAttribute("href")).toBe(
      "/wedding/login?next=%2Fwedding%2Fcouple-court%2Fpublic%2Fpost-1",
    );

    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(
      <PublicCourtDetail postId="post-1" viewerUserId="user-a" />,
    ));
    await settle();

    expect(container.querySelector<HTMLTextAreaElement>("#court-comment")?.value).toBe("");
    expect(container.textContent).toContain("로그인 전에 작성한 댓글 초안");
    await act(async () => button(container, "이 계정으로 초안 가져오기")?.click());
    await settle();

    expect(container.querySelector<HTMLTextAreaElement>("#court-comment")?.value)
      .toBe("작성 중이던 따뜻한 댓글");
    expect(container.querySelector<HTMLSelectElement>("#comment-type")?.value)
      .toBe("question");

    mocks.createPublicComment.mockResolvedValue({ moderationStatus: "pending", reused: true });
    await act(async () => button(container, "댓글 남기기")?.click());
    await settle();

    expect(mocks.createPublicComment).toHaveBeenLastCalledWith(
      "post-1",
      "question",
      "작성 중이던 따뜻한 댓글",
      FIRST_REQUEST_ID,
    );

    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(
      <PublicCourtDetail postId="post-1" viewerUserId="user-a" />,
    ));
    await settle();

    expect(container.querySelector<HTMLTextAreaElement>("#court-comment")?.value).toBe("");
    expect(container.querySelector<HTMLSelectElement>("#comment-type")?.value).toBe("empathy");
  });

  it("keeps one request id after a lost acknowledgement and removes it only after success", async () => {
    mocks.createPublicComment
      .mockRejectedValueOnce(new Error("응답을 확인하지 못했어요."))
      .mockResolvedValueOnce({ moderationStatus: "visible", reused: true });

    await act(async () => root.render(<PublicCourtDetail postId="post-1" />));
    await settle();
    const textarea = container.querySelector<HTMLTextAreaElement>("#court-comment");
    await act(async () => {
      if (textarea) setTextareaValue(textarea, "ACK를 잃어도 한 번만 저장할 댓글");
    });

    await act(async () => button(container, "댓글 남기기")?.click());
    await settle();

    expect(mocks.createPublicComment).toHaveBeenNthCalledWith(
      1,
      "post-1",
      "empathy",
      "ACK를 잃어도 한 번만 저장할 댓글",
      FIRST_REQUEST_ID,
    );
    const storedBeforeRetry = Array.from(
      { length: window.sessionStorage.length },
      (_, index) => window.sessionStorage.getItem(window.sessionStorage.key(index) ?? ""),
    ).find(Boolean);
    expect(JSON.parse(storedBeforeRetry ?? "null")).toMatchObject({
      version: 2,
      ownerUserId: "anonymous",
      value: {
        submissionRequestId: FIRST_REQUEST_ID,
        body: "ACK를 잃어도 한 번만 저장할 댓글",
      },
    });

    await act(async () => button(container, "댓글 남기기")?.click());
    await settle();

    expect(mocks.createPublicComment).toHaveBeenNthCalledWith(
      2,
      "post-1",
      "empathy",
      "ACK를 잃어도 한 번만 저장할 댓글",
      FIRST_REQUEST_ID,
    );
    expect(window.sessionStorage.length).toBe(0);
    expect(container.textContent).toContain("댓글을 게시했어요.");
    expect(container.textContent).toContain("댓글 4개");
  });

  it("rotates the request id when the payload changes after an uncertain failure", async () => {
    vi.mocked(window.crypto.randomUUID)
      .mockReturnValueOnce(FIRST_REQUEST_ID)
      .mockReturnValueOnce(SECOND_REQUEST_ID);
    mocks.createPublicComment.mockRejectedValue(new Error("네트워크 오류"));

    await act(async () => root.render(<PublicCourtDetail postId="post-1" />));
    await settle();
    const textarea = container.querySelector<HTMLTextAreaElement>("#court-comment");
    await act(async () => {
      if (textarea) setTextareaValue(textarea, "첫 번째 전송 내용입니다.");
    });
    await act(async () => button(container, "댓글 남기기")?.click());
    await settle();

    await act(async () => {
      if (textarea) setTextareaValue(textarea, "수정한 두 번째 전송 내용입니다.");
    });
    await act(async () => button(container, "댓글 남기기")?.click());
    await settle();

    expect(mocks.createPublicComment.mock.calls.map((call) => call[3])).toEqual([
      FIRST_REQUEST_ID,
      SECOND_REQUEST_ID,
    ]);
  });

  it("drops same-tick double submission before React can disable the button", async () => {
    let resolveRequest: ((value: { moderationStatus: string; reused: boolean }) => void) | undefined;
    mocks.createPublicComment.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    await act(async () => root.render(<PublicCourtDetail postId="post-1" />));
    await settle();
    const textarea = container.querySelector<HTMLTextAreaElement>("#court-comment");
    await act(async () => {
      if (textarea) setTextareaValue(textarea, "동시에 눌러도 한 번만 전송합니다.");
    });

    await act(async () => {
      const submit = button(container, "댓글 남기기");
      submit?.click();
      submit?.click();
    });

    expect(mocks.createPublicComment).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLTextAreaElement>("#court-comment")?.disabled).toBe(true);
    expect(container.querySelector<HTMLSelectElement>("#comment-type")?.disabled).toBe(true);
    await act(async () => resolveRequest?.({ moderationStatus: "pending", reused: false }));
    await settle();
  });

  it("keeps authenticated comment drafts isolated across an account switch", async () => {
    mocks.createPublicComment.mockRejectedValue(new Error("네트워크 오류"));

    await act(async () => root.render(
      <PublicCourtDetail postId="post-1" viewerUserId="user-a" />,
    ));
    await settle();
    const textarea = container.querySelector<HTMLTextAreaElement>("#court-comment");
    await act(async () => {
      if (textarea) setTextareaValue(textarea, "A 계정만 볼 수 있는 댓글 초안");
    });
    await act(async () => button(container, "댓글 남기기")?.click());
    await settle();

    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(
      <PublicCourtDetail postId="post-1" viewerUserId="user-b" />,
    ));
    await settle();
    expect(container.querySelector<HTMLTextAreaElement>("#court-comment")?.value).toBe("");
    expect(container.textContent).not.toContain("A 계정만 볼 수 있는 댓글 초안");

    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(
      <PublicCourtDetail postId="post-1" viewerUserId="user-a" />,
    ));
    await settle();
    expect(container.querySelector<HTMLTextAreaElement>("#court-comment")?.value)
      .toBe("A 계정만 볼 수 있는 댓글 초안");
  });

  it("keeps terminally moderated text visible and requires an edit before retry", async () => {
    mocks.createPublicComment.mockResolvedValue({
      moderationStatus: "hidden",
      reused: false,
    });

    await act(async () => root.render(<PublicCourtDetail postId="post-1" />));
    await settle();
    const textarea = container.querySelector<HTMLTextAreaElement>("#court-comment");
    await act(async () => {
      if (textarea) setTextareaValue(textarea, "검토 결과를 확인할 댓글 내용");
    });
    await act(async () => button(container, "댓글 남기기")?.click());
    await settle();

    expect(textarea?.value).toBe("검토 결과를 확인할 댓글 내용");
    expect(container.textContent).toContain("이 댓글은 게시되지 않았어요");
    expect(button(container, "내용을 수정한 뒤 다시 제출")?.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      if (textarea) setTextareaValue(textarea, "개인정보를 빼고 수정한 댓글 내용");
    });
    expect(button(container, "댓글 남기기")?.hasAttribute("disabled")).toBe(false);
  });

  it("expires an unauthenticated comment draft after thirty minutes", async () => {
    const now = Date.UTC(2026, 6, 14, 3, 0, 0);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    mocks.createPublicComment.mockRejectedValue(
      new mocks.CourtApiError("로그인이 필요해요.", 401, "AUTH_REQUIRED"),
    );

    await act(async () => root.render(<PublicCourtDetail postId="post-1" />));
    await settle();

    const textarea = container.querySelector<HTMLTextAreaElement>("#court-comment");
    await act(async () => {
      if (textarea) setTextareaValue(textarea, "로그인 뒤 이어 쓸 댓글");
    });
    await act(async () => button(container, "댓글 남기기")?.click());
    await settle();

    nowSpy.mockReturnValue(now + (30 * 60 * 1000) + 1);
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<PublicCourtDetail postId="post-1" />));
    await settle();

    expect(container.querySelector<HTMLTextAreaElement>("#court-comment")?.value).toBe("");
  });

  it("keeps unauthenticated comment drafts isolated by public post", async () => {
    mocks.getPublicCase.mockImplementation(async (postId: string) => ({ ...post, id: postId }));
    mocks.createPublicComment.mockRejectedValue(
      new mocks.CourtApiError("로그인이 필요해요.", 401, "AUTH_REQUIRED"),
    );

    await act(async () => root.render(<PublicCourtDetail postId="post-1" />));
    await settle();

    const textarea = container.querySelector<HTMLTextAreaElement>("#court-comment");
    await act(async () => {
      if (textarea) setTextareaValue(textarea, "첫 번째 공개재판의 댓글");
    });
    await act(async () => button(container, "댓글 남기기")?.click());
    await settle();

    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<PublicCourtDetail postId="post-2" />));
    await settle();
    expect(container.querySelector<HTMLTextAreaElement>("#court-comment")?.value).toBe("");

    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<PublicCourtDetail postId="post-1" />));
    await settle();
    expect(container.querySelector<HTMLTextAreaElement>("#court-comment")?.value)
      .toBe("첫 번째 공개재판의 댓글");
  });
});
