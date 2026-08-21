"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import { useCommunityStore } from "@/stores/communityStore";
import CommentItem from "@/components/community/CommentItem";
import type { CommentWithAuthor } from "@/types/community.types";
import { weddingPath } from "@/lib/weddingPaths";

interface CommentSectionProps {
  postId: string;
}

function mergeUniqueReplies(
  nestedReplies: CommentWithAuthor[],
  flatReplies: CommentWithAuthor[],
): CommentWithAuthor[] {
  const repliesById = new Map<string, CommentWithAuthor>();

  for (const reply of [...nestedReplies, ...flatReplies]) {
    const existing = repliesById.get(reply.id);
    repliesById.set(
      reply.id,
      existing
        ? {
            ...existing,
            ...reply,
            replies: mergeUniqueReplies(
              existing.replies ?? [],
              reply.replies ?? [],
            ),
          }
        : reply,
    );
  }

  return [...repliesById.values()];
}

export function buildCommentTree(
  sourceComments: CommentWithAuthor[],
): CommentWithAuthor[] {
  const topLevel: CommentWithAuthor[] = [];
  const repliesMap = new Map<string, CommentWithAuthor[]>();

  for (const comment of sourceComments) {
    if (!comment.parent_id) {
      topLevel.push(comment);
      continue;
    }

    const replies = repliesMap.get(comment.parent_id) ?? [];
    replies.push(comment);
    repliesMap.set(comment.parent_id, replies);
  }

  return topLevel.map((comment) => ({
    ...comment,
    replies: mergeUniqueReplies(
      comment.replies ?? [],
      repliesMap.get(comment.id) ?? [],
    ),
  }));
}

function removeBlockedAuthors(
  sourceComments: CommentWithAuthor[],
  blockedAuthorIds: ReadonlySet<string>,
): CommentWithAuthor[] {
  return sourceComments.flatMap((comment) => {
    if (blockedAuthorIds.has(comment.author_id)) return [];
    return [{
      ...comment,
      replies: removeBlockedAuthors(comment.replies ?? [], blockedAuthorIds),
    }];
  });
}

export default function CommentSection({ postId }: CommentSectionProps) {
  const {
    comments,
    commentsPostId,
    commentsLoading,
    errorMessage,
    fetchComments,
    createComment,
    updateComment,
    deleteComment,
    voteComment,
    currentPost,
  } = useCommunityStore();

  const [user, setUser] = useState<{ id: string } | null>(null);
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [blockedAuthorIds, setBlockedAuthorIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [blockNotice, setBlockNotice] = useState(false);
  const pendingSubmissionKeys = useRef(
    new Map<string, { content: string; idempotencyKey: string }>(),
  );

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

  async function submitWithStableKey(input: {
    post_id: string;
    parent_id?: string;
    content: string;
  }) {
    const content = input.content.trim();
    const lane = input.parent_id ? `reply:${input.parent_id}` : "answer";
    const pending = pendingSubmissionKeys.current.get(lane);
    const idempotencyKey =
      pending?.content === content
        ? pending.idempotencyKey
        : globalThis.crypto.randomUUID();

    pendingSubmissionKeys.current.set(lane, { content, idempotencyKey });
    const ok = await createComment(
      { ...input, content },
      { idempotencyKey },
    );
    if (ok) pendingSubmissionKeys.current.delete(lane);
    return ok;
  }

  // 댓글 작성
  async function handleSubmit() {
    if (!newComment.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const ok = await submitWithStableKey({
      post_id: postId,
      content: newComment.trim(),
    });
    if (ok) {
      setNewComment("");
    } else {
      setSubmitError(
        "답변이 저장되지 않았어요. 내용을 유지했으니 잠시 후 다시 등록해 주세요.",
      );
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
  const visibleComments = useMemo(() => {
    const currentComments = commentsPostId === postId ? comments : [];
    return removeBlockedAuthors(currentComments, blockedAuthorIds);
  }, [blockedAuthorIds, comments, commentsPostId, postId]);
  const isLoadingCurrentComments = commentsPostId === postId && commentsLoading;

  const treeComments = useMemo(
    () => buildCommentTree(visibleComments),
    [visibleComments],
  );

  const commentCount = currentPost?.id === postId
    ? currentPost.comment_count
    : visibleComments.length;
  const commentsReturnPath =
    `${weddingPath(`/community/post/${postId}`)}#comments`;
  const loginHref = `/login?redirect=${encodeURIComponent(commentsReturnPath)}`;

  return (
    <div className="scroll-mt-24">
      {/* 댓글 수 헤더 */}
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-base font-medium text-[#1A1A1F]">
          답변{" "}
          {commentCount > 0 && (
            <span className="text-[#B5ADA3]">{commentCount}</span>
          )}
        </h3>
      </div>

      {blockNotice ? (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#d8d1cc] bg-[#FBF8F2] px-3 py-2.5 text-xs leading-relaxed text-[#635b51]"
        >
          <span>차단한 회원의 답변을 이 화면에서도 숨겼어요.</span>
          <Link
            href={weddingPath("/community/my/blocks")}
            className="font-semibold text-[#36534E] hover:underline"
          >
            차단 관리
          </Link>
        </div>
      ) : null}

      {/* 댓글 입력 */}
      {user ? (
        <div className="mb-4">
          <textarea
            id="comment-composer"
            value={newComment}
            onChange={(e) => {
              const nextValue = e.target.value;
              const pending = pendingSubmissionKeys.current.get("answer");
              if (pending && pending.content !== nextValue.trim()) {
                pendingSubmissionKeys.current.delete("answer");
              }
              setSubmitError(null);
              setNewComment(nextValue);
            }}
            onKeyDown={handleKeyDown}
            placeholder="직접 겪은 범위와 질문자가 다음에 확인할 행동을 적어주세요."
            rows={3}
            maxLength={2000}
            className="ugc-text w-full px-3 py-2 text-sm text-[#1A1A1F] bg-white border border-[#F0EFED] rounded-xl resize-none focus:outline-none focus:border-[#36534E] focus:shadow-[0_0_0_2px_rgba(54,83,78,0.1)] transition-all duration-200 placeholder:text-[#B5ADA3]"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-[#B5ADA3]">
              {newComment.length}/2000
            </span>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!newComment.trim() || submitting}
              className="px-4 py-2 text-base font-semibold text-white bg-[#36534E] hover:bg-[#2B423E] rounded-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "등록 중..." : "답변 등록"}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[#8F6662]">
            전화번호·이메일·주소·계좌번호·서명·QR코드는 답변에 적지 마세요.
          </p>
          {submitError && (
            <p
              role="alert"
              className="mt-2 rounded-lg bg-[#FBF8F2] px-3 py-2 text-xs leading-relaxed text-[#8F6662]"
            >
              {submitError}
            </p>
          )}
        </div>
      ) : (
        <div className="mb-4 relative">
          <div className="px-4 py-4 text-center bg-[#FAFAF8] border border-[#F0EFED] rounded-xl">
            <MessageCircle className="w-6 h-6 mx-auto mb-2 text-[#B5ADA3]" />
            <p className="text-base text-[#878680]">
              <Link
                href={loginHref}
                className="text-[#36534E] font-semibold hover:underline"
              >
                로그인
              </Link>
              하고 답변을 작성해 보세요
            </p>
          </div>
        </div>
      )}

      {/* 댓글 목록 */}
      {isLoadingCurrentComments ? (
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
      ) : treeComments.length === 0 && errorMessage ? (
        // 못 불러온 것을 "아직 없다"고 말하면 사용자가 같은 질문을 다시 올린다.
        <div className="text-center py-8">
          <MessageCircle className="w-8 h-8 mx-auto mb-2 text-[#B5ADA3]" />
          <p className="text-base text-[#878680]">답변을 불러오지 못했어요.</p>
          <button
            type="button"
            onClick={() => fetchComments(postId)}
            className="mt-3 inline-flex min-h-9 items-center rounded-full border border-[#F0EFED] px-4 text-sm font-semibold text-[#1A1A1F]"
          >
            다시 불러오기
          </button>
        </div>
      ) : treeComments.length === 0 ? (
        <div className="text-center py-8">
          <MessageCircle className="w-8 h-8 mx-auto mb-2 text-[#B5ADA3]" />
          <p className="text-base text-[#878680]">
            아직 답변이 없습니다. 첫 경험을 나눠주세요.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#F0EFED]">
          {treeComments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              postId={postId}
              currentUserId={user?.id ?? null}
              onDelete={deleteComment}
              onEdit={updateComment}
              onVote={voteComment}
              onBlockedUser={(blockedUserId) => {
                setBlockedAuthorIds((current) => {
                  const next = new Set(current);
                  next.add(blockedUserId);
                  return next;
                });
                setBlockNotice(true);
              }}
              onReply={(parentId, content) => {
                return submitWithStableKey({
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
