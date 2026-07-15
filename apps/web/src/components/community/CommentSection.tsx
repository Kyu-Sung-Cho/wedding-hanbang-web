"use client";

import { useEffect, useState, useMemo } from "react";
import { MessageCircle } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { useCommunityStore } from "@/stores/communityStore";
import CommentItem from "@/components/community/CommentItem";

interface CommentSectionProps {
  postId: string;
}

export default function CommentSection({ postId }: CommentSectionProps) {
  const {
    comments,
    commentsPostId,
    commentsLoadStatus,
    commentsLoadError,
    fetchComments,
    updateComment,
    deleteComment,
    currentPost,
  } = useCommunityStore();

  const [user, setUser] = useState<{ id: string } | null>(null);

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
      void fetchComments(postId);
    }
  }, [postId, fetchComments]);

  // 댓글 트리 빌드 (1-depth only)
  const visibleComments = useMemo(
    () => (commentsPostId === postId ? comments : []),
    [comments, commentsPostId, postId]
  );
  const isLoadingCurrentComments =
    commentsPostId !== postId ||
    commentsLoadStatus === "idle" ||
    commentsLoadStatus === "loading";
  const commentsFailed = commentsPostId === postId && commentsLoadStatus === "error";
  // API와 store가 이미 1-depth 트리를 반환하므로 replies를 다시 만들며 지우지 않는다.
  const treeComments = visibleComments;

  const commentCount = currentPost?.id === postId
    ? currentPost.comment_count
    : visibleComments.length;

  return (
    <div>
      {/* 댓글 수 헤더 */}
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-base font-medium text-[#1A1A1F]">
          댓글{" "}
          {commentCount > 0 && (
            <span className="text-[#B5ADA3]">{commentCount}</span>
          )}
        </h3>
      </div>

      {/* 댓글 입력 */}
      <div className="mb-4 rounded-xl border border-[#E2D3C8] bg-[#FBF8F2] px-4 py-4">
        <p className="text-sm font-semibold text-[#36534E]">
          새 댓글과 답글 작성은 제공하지 않아요.
        </p>
        <p className="mt-1 text-sm leading-relaxed text-[#635b51]">
          기존 댓글은 계속 읽을 수 있고, 작성자는 수정·삭제할 수 있어요.
          문제가 있는 기존 댓글은 해당 댓글 아래의 신고 버튼으로 알려주세요.
        </p>
      </div>

      {/* 댓글 목록 */}
      {commentsFailed && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-700">댓글을 불러오지 못했어요.</p>
          <p className="mt-1 text-xs text-red-600">
            {commentsLoadError ?? "기존 댓글은 그대로 두었습니다. 잠시 후 다시 시도해주세요."}
          </p>
          <button
            type="button"
            onClick={() => void fetchComments(postId)}
            disabled={isLoadingCurrentComments}
            className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 disabled:opacity-50"
          >
            댓글 다시 불러오기
          </button>
        </div>
      )}
      {isLoadingCurrentComments && treeComments.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse flex gap-2">
              <div className="w-7 h-7 bg-[#F0EFED] rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-24 bg-[#F0EFED] rounded-lg" />
                <div className="h-4 w-3/4 bg-[#F0EFED] rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : treeComments.length === 0 ? (
        commentsFailed ? null : (
        <div className="text-center py-8">
          <MessageCircle className="w-8 h-8 mx-auto mb-2 text-[#B5ADA3]" />
          <p className="text-base text-[#878680]">
            아직 등록된 댓글이 없습니다.
          </p>
        </div>
        )
      ) : (
        <div className="divide-y divide-[#F0EFED]">
          {treeComments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              currentUserId={user?.id ?? null}
              onDelete={deleteComment}
              onEdit={updateComment}
            />
          ))}
        </div>
      )}
    </div>
  );
}
