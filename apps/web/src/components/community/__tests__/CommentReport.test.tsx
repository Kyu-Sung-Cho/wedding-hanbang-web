import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommentItem from "../CommentItem";
import type { CommentWithAuthor } from "@/types/community.types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

const comment: CommentWithAuthor = {
  id: "323e4567-e89b-42d3-a456-426614174000",
  post_id: "423e4567-e89b-42d3-a456-426614174000",
  parent_id: null,
  author_id: "223e4567-e89b-42d3-a456-426614174000",
  content: "검토가 필요한 기존 댓글",
  upvote_count: 0,
  is_deleted: false,
  created_at: "2026-07-13T00:00:00.000Z",
  updated_at: "2026-07-13T00:00:00.000Z",
  viewer_is_author: false,
  author: {
    user_id: "223e4567-e89b-42d3-a456-426614174000",
    nickname: "댓글작성자",
    avatar_url: null,
  },
  replies: [],
};

function buttonByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text,
  );
}

describe("CommentItem reporting", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("requires login before opening a comment report dialog", () => {
    act(() => root.render(
      <CommentItem
        comment={comment}
        currentUserId={null}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />,
    ));

    act(() => buttonByText(container, "신고")?.click());

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "댓글 신고는 로그인 후 이용할 수 있어요",
    );
    expect(container.querySelector<HTMLAnchorElement>('a[href*="/login"]')).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the accessible dialog, reason, and details when submission fails", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      JSON.stringify({ error: "신고 접수 상태를 확인하지 못했습니다." }),
      { status: 503, headers: { "content-type": "application/json" } },
    ));
    act(() => root.render(
      <CommentItem
        comment={comment}
        currentUserId="123e4567-e89b-42d3-a456-426614174000"
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />,
    ));

    act(() => buttonByText(container, "신고")?.click());
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog?.getAttribute("aria-describedby")).toBeTruthy();

    const abuse = container.querySelector<HTMLInputElement>('input[value="abuse"]');
    act(() => abuse?.click());
    const details = container.querySelector<HTMLTextAreaElement>("textarea");
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    act(() => {
      setValue?.call(details, "선택 내용은 보존되어야 합니다.");
      details?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      buttonByText(container, "신고하기")?.click();
    });

    expect(fetch).toHaveBeenCalledWith(
      `/api/community/comments/${comment.id}/report`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          reason: "abuse",
          details: "선택 내용은 보존되어야 합니다.",
        }),
      }),
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[value="abuse"]')?.checked).toBe(true);
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "선택 내용은 보존되어야 합니다.",
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "신고 접수 상태를 확인하지 못했습니다.",
    );
  });
});
