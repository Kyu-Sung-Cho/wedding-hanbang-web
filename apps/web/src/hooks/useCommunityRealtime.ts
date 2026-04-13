"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCommunityStore } from "@/stores/communityStore";

/**
 * 커뮤니티 피드 리얼타임 구독
 * - 새 게시글 INSERT → 피드 맨 위에 추가
 * - 게시글 UPDATE → 투표/댓글 수 실시간 반영
 * - 게시글 DELETE → 피드에서 제거
 */
export function useCommunityRealtime() {
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("community-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "community_posts" },
        async (payload) => {
          const newPost = payload.new as Record<string, unknown>;
          if (!newPost.id || newPost.visibility === "draft") return;

          // author 프로필 조회
          const { data: profile } = await supabase
            .from("community_profiles")
            .select("user_id, nickname, rank, wedding_year, wedding_month")
            .eq("user_id", newPost.author_id)
            .maybeSingle();

          const postWithAuthor = {
            ...newPost,
            author: profile ?? { nickname: "익명", rank: "sprout", wedding_year: null, wedding_month: null },
            user_vote: null,
          };

          useCommunityStore.setState((s) => {
            if (s.posts.some((p) => p.id === newPost.id)) return s;
            return { posts: [postWithAuthor as never, ...s.posts], total: s.total + 1 };
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "community_posts" },
        (payload) => {
          const updated = payload.new as Record<string, unknown>;
          useCommunityStore.setState((s) => ({
            posts: s.posts.map((p) =>
              p.id === updated.id
                ? {
                    ...p,
                    upvote_count: (updated.upvote_count as number) ?? p.upvote_count,
                    downvote_count: (updated.downvote_count as number) ?? p.downvote_count,
                    comment_count: (updated.comment_count as number) ?? p.comment_count,
                    view_count: (updated.view_count as number) ?? p.view_count,
                    title: (updated.title as string) ?? p.title,
                    is_pinned: (updated.is_pinned as boolean) ?? p.is_pinned,
                    is_weekly_best: (updated.is_weekly_best as boolean) ?? p.is_weekly_best,
                  }
                : p
            ),
          }));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "community_posts" },
        (payload) => {
          const deletedId = (payload.old as Record<string, unknown>).id;
          useCommunityStore.setState((s) => ({
            posts: s.posts.filter((p) => p.id !== deletedId),
            total: Math.max(0, s.total - 1),
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}
