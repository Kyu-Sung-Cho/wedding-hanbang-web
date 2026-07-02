"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCommunityStore } from "@/stores/communityStore";

/**
 * 게시글 댓글 리얼타임 구독
 * - 새 댓글 INSERT → 목록에 추가
 * - 댓글 UPDATE → 수정/소프트삭제 반영
 */
export function useCommentsRealtime(postId: string | null) {
  useEffect(() => {
    if (!postId) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`comments:${postId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "community_comments",
          filter: `post_id=eq.${postId}`,
        },
        async (payload) => {
          const newComment = payload.new as Record<string, unknown>;

          // author 프로필 조회
          const { data: profile } = await supabase
            .from("community_profiles")
            .select("user_id, nickname, rank, avatar_url, wedding_year, wedding_month")
            .eq("user_id", newComment.author_id)
            .maybeSingle();

          const commentWithAuthor = {
            ...newComment,
            author: profile ?? { nickname: "익명", rank: "sprout", avatar_url: null },
            user_vote: null,
            replies: [],
          };

          useCommunityStore.setState((s) => {
            if (s.commentsPostId && s.commentsPostId !== postId) return s;
            if (s.comments.some((c) => c.id === newComment.id)) return s;

            // 대댓글이면 부모에 추가
            if (newComment.parent_id) {
              return {
                commentsPostId: postId,
                comments: s.comments.map((c) =>
                  c.id === newComment.parent_id
                    ? { ...c, replies: [...(c.replies ?? []), commentWithAuthor as never] }
                    : c
                ),
              };
            }

            return { commentsPostId: postId, comments: [...s.comments, commentWithAuthor as never] };
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "community_comments",
          filter: `post_id=eq.${postId}`,
        },
        (payload) => {
          const updated = payload.new as Record<string, unknown>;
          if (useCommunityStore.getState().commentsPostId !== postId) return;
          useCommunityStore.setState((s) => ({
            comments: s.comments.map((c) => {
              if (c.id === updated.id) {
                return {
                  ...c,
                  content: (updated.content as string) ?? c.content,
                  is_deleted: (updated.is_deleted as boolean) ?? c.is_deleted,
                  upvote_count: (updated.upvote_count as number) ?? c.upvote_count,
                };
              }
              // 대댓글 체크
              if (c.replies?.length) {
                return {
                  ...c,
                  replies: c.replies.map((r) =>
                    r.id === updated.id
                      ? { ...r, content: (updated.content as string) ?? r.content, is_deleted: (updated.is_deleted as boolean) ?? r.is_deleted, upvote_count: (updated.upvote_count as number) ?? r.upvote_count }
                      : r
                  ),
                };
              }
              return c;
            }),
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [postId]);
}
