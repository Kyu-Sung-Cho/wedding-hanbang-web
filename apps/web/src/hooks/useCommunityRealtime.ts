"use client";

import { useEffect } from "react";
import { isPreviewStubMode } from "@/lib/previewStub";
import { createClient } from "@/lib/supabase/client";
import { useCommunityStore } from "@/stores/communityStore";
import type {
  CommunityCategory,
  PostSort,
  PostWithAuthor,
  TimePeriod,
} from "@/types/community.types";

const QUESTION_CATEGORIES = new Set(["is_normal", "ama"]);
const PERSONALIZED_SORTS = new Set<PostSort>(["my_cohort", "my_posts"]);
const GENERAL_ONLY_SORTS = new Set<PostSort>([
  "hot",
  "top",
  "unanswered",
  "resolved",
]);

export interface CommunityRealtimeFeedFilter {
  category: CommunityCategory | null;
  sort: PostSort;
  period: TimePeriod;
  tag: string | null;
  authorId: string | null;
}

export type CommunityRealtimeDecision =
  | "ignore"
  | "merge"
  | "remove"
  | "refetch";

type CommunityRealtimeEvent = "INSERT" | "UPDATE" | "DELETE";

interface CommunityRealtimeListState {
  posts: PostWithAuthor[];
  total: number;
}

function isWithinTopPeriod(
  post: Record<string, unknown>,
  period: TimePeriod,
  nowMs: number,
): boolean {
  if (period === "all") return true;
  if (typeof post.created_at !== "string") return false;

  const createdAt = Date.parse(post.created_at);
  if (!Number.isFinite(createdAt)) return false;

  const cutoff = new Date(nowMs);
  if (period === "week") {
    cutoff.setDate(cutoff.getDate() - 7);
  } else {
    cutoff.setMonth(cutoff.getMonth() - 1);
  }

  return createdAt >= cutoff.getTime();
}

/**
 * Returns true only when a realtime row can safely be shown in the active
 * non-personalized feed. Personalized membership is server-derived, so those
 * feeds deliberately return false and converge through a refetch instead.
 */
export function matchesCommunityRealtimeFeed(
  post: Record<string, unknown>,
  filter: CommunityRealtimeFeedFilter,
  nowMs = Date.now(),
): boolean {
  if (PERSONALIZED_SORTS.has(filter.sort)) return false;
  if (post.visibility !== "public" || post.under_review !== false) return false;

  if (filter.category && post.category !== filter.category) return false;
  if (filter.authorId && post.author_id !== filter.authorId) return false;
  if (
    filter.tag &&
    (!Array.isArray(post.tags) || !post.tags.includes(filter.tag))
  ) {
    return false;
  }

  if (
    GENERAL_ONLY_SORTS.has(filter.sort) &&
    post.ad_disclosure !== "general"
  ) {
    return false;
  }

  if (filter.sort === "top" && !isWithinTopPeriod(post, filter.period, nowMs)) {
    return false;
  }

  if (filter.sort === "unanswered") {
    return (
      typeof post.category === "string" &&
      QUESTION_CATEGORIES.has(post.category) &&
      post.is_resolved === false &&
      post.comment_count === 0
    );
  }

  if (filter.sort === "resolved") {
    return (
      typeof post.category === "string" &&
      QUESTION_CATEGORIES.has(post.category) &&
      post.is_resolved === true
    );
  }

  return true;
}

export function decideCommunityRealtimeChange(
  event: CommunityRealtimeEvent,
  post: Record<string, unknown>,
  filter: CommunityRealtimeFeedFilter,
  isVisible: boolean,
): CommunityRealtimeDecision {
  if (event === "DELETE") return isVisible ? "remove" : "ignore";

  // Cohort membership and the current user's id are not present in the
  // realtime payload. Never insert a global event directly into these feeds.
  if (PERSONALIZED_SORTS.has(filter.sort)) return "refetch";

  const matches = matchesCommunityRealtimeFeed(post, filter);
  if (matches) {
    return isVisible ? "merge" : "refetch";
  }

  return isVisible ? "remove" : "ignore";
}

export function reduceCommunityRealtimeFeed(
  state: CommunityRealtimeListState,
  post: Record<string, unknown>,
  decision: CommunityRealtimeDecision,
): CommunityRealtimeListState {
  if (typeof post.id !== "string") return state;

  if (decision === "remove") {
    const isVisible = state.posts.some((current) => current.id === post.id);
    if (!isVisible) return state;

    return {
      posts: state.posts.filter((current) => current.id !== post.id),
      total: Math.max(0, state.total - 1),
    };
  }

  if (decision === "merge") {
    return {
      posts: state.posts.map((current) =>
        current.id === post.id
          ? ({
              ...current,
              ...post,
              author: current.author,
            } as PostWithAuthor)
          : current,
      ),
      total: state.total,
    };
  }

  return state;
}

function currentFeedFilter(): CommunityRealtimeFeedFilter {
  const state = useCommunityStore.getState();
  return {
    category: state.currentCategory,
    sort: state.currentSort,
    period: state.currentPeriod,
    tag: state.currentTag,
    authorId: state.currentAuthorId,
  };
}

/**
 * Community feed realtime subscription.
 *
 * Realtime rows are accepted only when they satisfy the same public filters as
 * the list API. Events whose placement or personalized membership cannot be
 * derived locally trigger a debounced page-one refetch.
 */
export function useCommunityRealtime() {
  useEffect(() => {
    if (isPreviewStubMode()) return;

    const supabase = createClient();
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleSafeRefetch = () => {
      if (refetchTimer) return;
      refetchTimer = setTimeout(() => {
        refetchTimer = null;
        // reset=false bypasses the short-lived feed cache while still replacing
        // the list with the authoritative first page.
        void useCommunityStore.getState().fetchPosts(false);
      }, 50);
    };

    const handleChange = (
      event: CommunityRealtimeEvent,
      post: Record<string, unknown>,
    ) => {
      if (typeof post.id !== "string") return;

      const state = useCommunityStore.getState();
      const isVisible = state.posts.some((current) => current.id === post.id);
      const decision = decideCommunityRealtimeChange(
        event,
        post,
        currentFeedFilter(),
        isVisible,
      );

      if (decision === "refetch") {
        scheduleSafeRefetch();
        return;
      }

      if (decision === "merge" || decision === "remove") {
        useCommunityStore.setState((current) =>
          reduceCommunityRealtimeFeed(
            { posts: current.posts, total: current.total },
            post,
            decision,
          ),
        );
      }
    };

    const channel = supabase
      .channel("community-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "community_posts" },
        (payload) => {
          handleChange("INSERT", payload.new as Record<string, unknown>);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "community_posts" },
        (payload) => {
          handleChange("UPDATE", payload.new as Record<string, unknown>);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "community_posts" },
        (payload) => {
          handleChange("DELETE", payload.old as Record<string, unknown>);
        },
      )
      .subscribe();

    return () => {
      if (refetchTimer) clearTimeout(refetchTimer);
      supabase.removeChannel(channel);
    };
  }, []);
}
