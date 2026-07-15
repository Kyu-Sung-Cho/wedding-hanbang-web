import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import CommentSection from "../CommentSection";
import CommentItem from "../CommentItem";
import type { CommentWithAuthor } from "@/types/community.types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: { getUser: vi.fn() },
  }),
}));

vi.mock("@/stores/communityStore", () => ({
  useCommunityStore: () => ({
    comments: [],
    commentsPostId: "post-1",
    commentsLoadStatus: "ready",
    commentsLoadError: null,
    fetchComments: vi.fn(),
    createComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    currentPost: { id: "post-1", comment_count: 0 },
  }),
}));

describe("community comment publishing boundary", () => {
  it("keeps existing comments readable while explaining why new comments and replies are closed", () => {
    const html = renderToStaticMarkup(<CommentSection postId="post-1" />);

    expect(html).toContain("새 댓글과 답글 작성은 제공하지 않아요");
    expect(html).toContain("기존 댓글은 계속 읽을 수 있고, 작성자는 수정·삭제할 수 있어요");
    expect(html).toContain("해당 댓글 아래의 신고 버튼");
    expect(html).not.toContain("게시글의 신고 버튼으로 알려주세요");
    expect(html).not.toContain("댓글을 작성해 주세요");
    expect(html).not.toContain("첫 댓글을 남겨보세요");
  });

  it("keeps an author's edit and delete controls but exposes no new-reply control", () => {
    const comment: CommentWithAuthor = {
      id: "comment-1",
      post_id: "post-1",
      parent_id: null,
      author_id: "user-1",
      content: "기존 댓글",
      upvote_count: 3,
      is_deleted: false,
      created_at: "2026-07-13T00:00:00.000Z",
      updated_at: "2026-07-13T00:00:00.000Z",
      viewer_is_author: true,
      author: {
        user_id: "user-1",
        nickname: "작성자",
        avatar_url: null,
      },
      replies: [],
    };

    const html = renderToStaticMarkup(
      <CommentItem
        comment={comment}
        currentUserId="user-1"
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    expect(html).toContain("좋아요 3");
    expect(html).not.toContain('aria-label="댓글 좋아요"');
    expect(html).toContain("기존 댓글");
    expect(html).toContain("수정");
    expect(html).toContain("삭제");
    expect(html).not.toContain(">신고<");
    expect(html).not.toContain("답글");
  });
});
