import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CommentSection from "./CommentSection";
import type { CommentWithAuthor } from "@/types/community.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
  fetchComments: vi.fn(async () => undefined),
  createComment: vi.fn(async (
    input: unknown,
    options?: { idempotencyKey?: string },
  ) => {
    void input;
    void options;
    return true;
  }),
  updateComment: vi.fn(async () => true),
  deleteComment: vi.fn(async () => true),
  voteComment: vi.fn(async () => undefined),
  purgePrivacyState: vi.fn(),
  comments: [] as CommentWithAuthor[],
  commentsPostId: "post-1" as string | null,
  commentsLoading: false,
  currentPost: null as { id: string; comment_count: number } | null,
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

vi.mock("@/stores/communityStore", () => {
  const useCommunityStore = Object.assign(
    () => ({
      comments: mocks.comments,
      commentsPostId: mocks.commentsPostId,
      commentsLoading: mocks.commentsLoading,
      fetchComments: mocks.fetchComments,
      createComment: mocks.createComment,
      updateComment: mocks.updateComment,
      deleteComment: mocks.deleteComment,
      voteComment: mocks.voteComment,
      currentPost: mocks.currentPost,
    }),
    {
      getState: () => ({ purgePrivacyState: mocks.purgePrivacyState }),
    },
  );
  return { useCommunityStore };
});

function comment(
  id: string,
  content: string,
  parentId: string | null = null,
): CommentWithAuthor {
  return {
    id,
    post_id: "post-1",
    parent_id: parentId,
    author_id: `${id}-author`,
    content_origin: "member",
    content,
    upvote_count: 0,
    is_deleted: false,
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
    author: {
      user_id: `${id}-author`,
      nickname: `${id}-nickname`,
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
}

describe("CommentSection participation recovery", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.comments = [];
    mocks.commentsPostId = "post-1";
    mocks.commentsLoading = false;
    mocks.currentPost = null;
    mocks.createComment.mockResolvedValue(true);
    mocks.createBrowserClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null } })),
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("preserves replies that already arrive nested under their parent", async () => {
    const parent = comment("parent", "부모 댓글");
    parent.replies = [comment("reply", "보존되어야 하는 답글", parent.id)];
    mocks.comments = [parent];

    await act(async () => {
      root.render(<CommentSection postId="post-1" />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("부모 댓글");
    expect(container.textContent).toContain("보존되어야 하는 답글");
  });

  it("returns logged-out users to the post answer section without duplicating its anchor", async () => {
    await act(async () => {
      root.render(<CommentSection postId="post-1" />);
      await Promise.resolve();
    });

    const section = container.firstElementChild as HTMLElement | null;
    expect(section?.className).toContain("scroll-mt-");
    expect(container.querySelector("#comments")).toBeNull();
    expect(container.querySelector(
      'a[href="/login?redirect=%2Fwedding%2Fcommunity%2Fpost%2Fpost-1%23comments"]',
    )).not.toBeNull();
  });

  it("gives a logged-in answerer one stable composer target", async () => {
    mocks.createBrowserClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "member-1" } } })),
      },
    });

    await act(async () => {
      root.render(<CommentSection postId="post-1" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelectorAll("#comment-composer")).toHaveLength(1);
    expect(container.querySelector("#comments")).toBeNull();
  });

  it("reuses one idempotency key after failure and rotates it after success", async () => {
    mocks.createBrowserClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "member-1" } } })),
      },
    });
    mocks.createComment
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    await act(async () => {
      root.render(<CommentSection postId="post-1" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = container.querySelector(
      "#comment-composer",
    ) as HTMLTextAreaElement;
    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "답변 등록",
    ) as HTMLButtonElement;
    const setTextarea = (value: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    };

    await act(async () => setTextarea("같은 답변"));
    await act(async () => {
      submit.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "내용을 유지",
    );
    await act(async () => {
      submit.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();

    const firstKey = mocks.createComment.mock.calls[0]?.[1]?.idempotencyKey;
    const retryKey = mocks.createComment.mock.calls[1]?.[1]?.idempotencyKey;
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(retryKey).toBe(firstKey);

    await act(async () => setTextarea("같은 답변"));
    await act(async () => {
      submit.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const afterSuccessKey =
      mocks.createComment.mock.calls[2]?.[1]?.idempotencyKey;
    expect(afterSuccessKey).not.toBe(firstKey);
  });

  it("rotates the pending idempotency key when failed content changes", async () => {
    mocks.createBrowserClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "member-1" } } })),
      },
    });
    mocks.createComment.mockResolvedValue(false);

    await act(async () => {
      root.render(<CommentSection postId="post-1" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = container.querySelector(
      "#comment-composer",
    ) as HTMLTextAreaElement;
    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "답변 등록",
    ) as HTMLButtonElement;
    const change = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set?.call(textarea, value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    await change("첫 내용");
    await act(async () => {
      submit.click();
      await Promise.resolve();
    });
    await change("바꾼 내용");
    await act(async () => {
      submit.click();
      await Promise.resolve();
    });

    expect(mocks.createComment.mock.calls[0]?.[1]?.idempotencyKey).not.toBe(
      mocks.createComment.mock.calls[1]?.[1]?.idempotencyKey,
    );
  });

  it("immediately removes every visible answer from a newly blocked author", async () => {
    const blockedUserId = "10000000-0000-4000-8000-000000000002";
    const first = comment("first", "첫 번째 숨길 답변");
    const second = comment("second", "두 번째 숨길 답변");
    for (const item of [first, second]) {
      item.author_id = blockedUserId;
      item.author = {
        ...item.author,
        user_id: blockedUserId,
        nickname: "숨길회원",
      };
    }
    mocks.comments = [first, second];
    mocks.createBrowserClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "member-1" } } })),
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        blocked_user_id: blockedUserId,
        blocked: true,
        changed: true,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    await act(async () => {
      root.render(<CommentSection postId="post-1" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="숨길회원님 차단"]',
      )?.click();
    });
    const confirm = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("차단하기"),
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("첫 번째 숨길 답변");
    expect(container.textContent).not.toContain("두 번째 숨길 답변");
    expect(container.textContent).toContain(
      "차단한 회원의 답변을 이 화면에서도 숨겼어요",
    );
  });
});
