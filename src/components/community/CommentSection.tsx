"use client";

import { useEffect, useState, useMemo } from "react";
import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import { useCommunityStore } from "@/stores/communityStore";
import CommentItem from "@/components/community/CommentItem";
import type { CommentWithAuthor } from "@/types/community.types";

interface CommentSectionProps {
  postId: string;
}

export default function CommentSection({ postId }: CommentSectionProps) {
  const {
    comments,
    commentsLoading,
    fetchComments,
    createComment,
    deleteComment,
    voteComment,
    currentPost,
  } = useCommunityStore();

  const [user, setUser] = useState<{ id: string } | null>(null);
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 유저 상태 확인
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ? { id: data.user.id } : null);
    });
  }, []);

  // 댓글 불러오기
  useEffect(() => {
    if (postId) {
      fetchComments(postId);
    }
  }, [postId, fetchComments]);

  // 댓글 작성
  async function handleSubmit() {
    if (!newComment.trim() || submitting) return;
    setSubmitting(true);
    const ok = await createComment({
      post_id: postId,
      content: newComment.trim(),
    });
    if (ok) {
      setNewComment("");
    }
    setSubmitting(false);
  }

  // 엔터키 제출 (Ctrl+Enter 또는 Cmd+Enter)
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  // 댓글 트리 빌드 (1-depth only)
  const treeComments = useMemo(() => {
    const topLevel: CommentWithAuthor[] = [];
    const repliesMap: Record<string, CommentWithAuthor[]> = {};

    comments.forEach((c) => {
      if (!c.parent_id) {
        topLevel.push(c);
      } else {
        if (!repliesMap[c.parent_id]) repliesMap[c.parent_id] = [];
        repliesMap[c.parent_id].push(c);
      }
    });

    return topLevel.map((c) => ({
      ...c,
      replies: repliesMap[c.id] ?? [],
    }));
  }, [comments]);

  const commentCount = currentPost?.comment_count ?? comments.length;

  return (
    <div>
      {/* 댓글 수 헤더 */}
      <div className="flex items-center gap-2 mb-4">
        <MessageCircle className="w-4 h-4 text-[#6B7280]" />
        <h3 className="text-sm font-semibold text-[#1c1c1e]">
          댓글{" "}
          {commentCount > 0 && (
            <span className="text-[#2563EB]">{commentCount}</span>
          )}
        </h3>
      </div>

      {/* 댓글 입력 */}
      {user ? (
        <div className="mb-4">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="댓글을 작성해 주세요..."
            rows={3}
            maxLength={2000}
            className="w-full px-3 py-2 text-sm text-[#1c1c1e] bg-white border border-[#E5E7EB] rounded-lg resize-none focus:outline-none focus:border-[#2563EB] focus:shadow-[0_0_0_2px_rgba(37,99,235,0.1)] transition-all duration-200 placeholder:text-[#6B7280]"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-[#6B7280]">
              {newComment.length}/2000
            </span>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!newComment.trim() || submitting}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "등록 중..." : "등록"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-4 relative">
          <div className="px-4 py-4 text-center bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg">
            <MessageCircle className="w-6 h-6 mx-auto mb-2 text-[#D1D5DB]" />
            <p className="text-sm text-[#6B7280]">
              <Link
                href="/login"
                className="text-[#2563EB] font-semibold hover:underline"
              >
                로그인
              </Link>
              하고 댓글을 작성해 보세요
            </p>
          </div>
        </div>
      )}

      {/* 댓글 목록 */}
      {commentsLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse flex gap-2">
              <div className="w-7 h-7 bg-[#F4F6F8] rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-24 bg-[#F4F6F8] rounded-lg" />
                <div className="h-4 w-3/4 bg-[#F4F6F8] rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : treeComments.length === 0 ? (
        <div className="text-center py-8">
          <MessageCircle className="w-8 h-8 mx-auto mb-2 text-[#D1D5DB]" />
          <p className="text-sm text-[#6B7280]">
            아직 댓글이 없습니다. 첫 댓글을 남겨보세요!
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#F4F6F8]">
          {treeComments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              postId={postId}
              currentUserId={user?.id ?? null}
              onDelete={deleteComment}
              onVote={voteComment}
              onReply={async (parentId, content) => {
                await createComment({
                  post_id: postId,
                  parent_id: parentId,
                  content,
                });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
