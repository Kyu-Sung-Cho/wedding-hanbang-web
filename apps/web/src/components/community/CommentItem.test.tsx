import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CommentItem from "./CommentItem";
import type { CommentWithAuthor } from "@/types/community.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const baseComment: CommentWithAuthor = {
  id: "comment-1",
  post_id: "post-1",
  parent_id: null,
  author_id: "author-1",
  content_origin: "member",
  content: "도움이 필요한 질문",
  upvote_count: 2,
  is_deleted: false,
  created_at: "2026-07-30T00:00:00.000Z",
  updated_at: "2026-07-30T00:00:00.000Z",
  author: {
    user_id: "author-1",
    nickname: "예비부부",
    avatar_url: null,
    badge: "member",
    rank: "sprout",
    wedding_year: null,
    wedding_month: null,
    wedding_completed: false,
    progress_percent: 0,
    region: null,
    post_count: 0,
    comment_count: 0,
    total_upvotes_received: 0,
    warning_count: 0,
    is_suspended: false,
    created_at: "2026-07-30T00:00:00.000Z",
  },
};

function changeTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CommentItem participation recovery", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onReply = vi.fn<
    (parentId: string, content: string) => Promise<boolean>
  >();
  const onVote = vi.fn<
    (commentId: string, voteType: 1 | -1 | 0) => Promise<void>
  >();

  beforeEach(() => {
    onReply.mockReset();
    onReply.mockResolvedValue(false);
    onVote.mockReset();
    onVote.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  function renderItem(
    currentUserId: string | null,
    comment: CommentWithAuthor = baseComment,
  ) {
    return act(async () => {
      root.render(
        <CommentItem
          comment={comment}
          postId="post-1"
          currentUserId={currentUserId}
          onDelete={vi.fn(async () => true)}
          onEdit={vi.fn(async () => true)}
          onVote={onVote}
          onReply={onReply}
        />,
      );
      await Promise.resolve();
    });
  }

  it("keeps reply text visible and explains a failed submission", async () => {
    await renderItem("member-1");

    const replyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "답글",
    );
    await act(async () => replyButton?.click());

    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="답글을 작성해 주세요..."]',
    );
    expect(textarea).not.toBeNull();
    await act(async () => {
      if (textarea) changeTextarea(textarea, "지우면 안 되는 답글");
    });

    const submitButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "등록",
    );
    await act(async () => {
      submitButton?.click();
      await Promise.resolve();
    });

    expect(onReply).toHaveBeenCalledWith("comment-1", "지우면 안 되는 답글");
    expect(container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="답글을 작성해 주세요..."]',
    )?.value).toBe("지우면 안 되는 답글");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "내용을 그대로 두었으니 다시 시도해 주세요",
    );
  });

  it("uses an honest 도움됐어요 label", async () => {
    await renderItem("member-1");

    expect(container.textContent).toContain("도움됐어요");
    expect(container.textContent).not.toContain("좋아요");
  });

  it("sends logged-out vote and reply actions through login and back to comments", async () => {
    await renderItem(null);

    const expectedHref =
      "/login?redirect=%2Fwedding%2Fcommunity%2Fpost%2Fpost-1%23comments";
    const actionLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(`a[href="${expectedHref}"]`),
    );

    const actionLabels = actionLinks.map((link) => link.textContent?.trim());
    expect(actionLabels.some((label) => label?.startsWith("도움됐어요"))).toBe(true);
    expect(actionLabels).toContain("답글");
    expect(onVote).not.toHaveBeenCalled();
  });

  it("returns a logged-out reporter to the exact answer anchor", async () => {
    await renderItem(null);

    const expectedHref =
      "/login?redirect=%2Fwedding%2Fcommunity%2Fpost%2Fpost-1%23comment-comment-1";
    const reportLink = container.querySelector<HTMLAnchorElement>(
      `a[href="${expectedHref}"]`,
    );

    expect(reportLink?.textContent?.trim()).toBe("신고");
    expect(reportLink?.getAttribute("aria-label")).toContain(
      "로그인하고 답변 신고",
    );
  });

  it("uses only content_origin for AI disclosure, never the nickname", async () => {
    await renderItem("member-1", {
      ...baseComment,
      author: {
        ...baseComment.author,
        nickname: "아모라 AI",
      },
      content_origin: "member",
    });

    expect(
      container.querySelector('[data-content-origin="member"]')?.textContent,
    ).toContain("일반 회원");
    expect(container.querySelector('[data-content-origin="ai"]')).toBeNull();

    await renderItem("member-1", {
      ...baseComment,
      author_id: "another-id",
      author: {
        ...baseComment.author,
        user_id: "another-id",
        nickname: "무작위 이름",
      },
      content_origin: "ai",
    });

    expect(
      container.querySelector('[data-content-origin="ai"]')?.textContent,
    ).toContain("AI 생성");
  });

  it("offers privacy reporting for another member but never for oneself", async () => {
    await renderItem("member-1");

    const reportButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "신고",
    );
    await act(async () => reportButton?.click());

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain("개인정보가 노출된 것 같아요");
    expect(container.textContent).toContain(
      "노출된 개인정보를 설명란에 다시 적지 마세요",
    );

    await renderItem("author-1");
    expect(
      Array.from(container.querySelectorAll("button, a")).some(
        (element) => element.textContent?.trim() === "신고",
      ),
    ).toBe(false);
  });

  it("turns a duplicate report response into a clear recovery message", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: "이미 접수한 답변이에요.",
          code: "COMMUNITY_REPORT_ALREADY_EXISTS",
        }),
        {
          status: 409,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderItem("member-1");

    const reportButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "신고",
    );
    await act(async () => reportButton?.click());

    const privacyRadio = container.querySelector<HTMLInputElement>(
      'input[value="privacy"]',
    );
    await act(async () => privacyRadio?.click());

    const submitButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "신고 접수",
    );
    await act(async () => {
      submitButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/community/comments/comment-1/report",
      expect.objectContaining({ method: "POST" }),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "이미 접수한 답변",
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
