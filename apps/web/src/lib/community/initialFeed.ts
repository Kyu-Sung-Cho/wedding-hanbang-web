import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { fallbackCommunityAuthor, getCommunityAuthorMap } from "@/lib/community/authorProfiles";
import { PUBLIC_COMMUNITY_POST_QUERY_FILTERS } from "@/lib/community/publicPostRules";
import { createPublicClient } from "@/lib/supabase/public";
import type { InitialCommunityFeed, PollSummary, PostWithAuthor } from "@/types/community.types";

const DEFAULT_LIMIT = 10;

export async function getInitialCommunityFeed(limit = DEFAULT_LIMIT): Promise<InitialCommunityFeed> {
  const emptyFeed: InitialCommunityFeed = {
    posts: [],
    total: 0,
    hasMore: false,
    fetchedAt: new Date().toISOString(),
  };

  try {
    const supabase = createPublicClient();
    const safeLimit = Math.max(1, Math.min(20, limit));
    const queryLimit = safeLimit + 1;

    const { data: queriedPosts, count, error } = await supabase
      .from("community_posts")
      .select(COMMUNITY_POST_PUBLIC_SELECT, { count: "exact" })
      .eq("visibility", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.visibility)
      .eq("under_review", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.underReview)
      // 고정 글을 먼저 — 새 글이 뜸한 시기에도 첫 화면이 비어 보이지 않게 한다.
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .range(0, queryLimit - 1);

    if (error || !queriedPosts?.length) {
      if (error) console.error("[community.initialFeed] posts query failed:", error);
      return emptyFeed;
    }

    const posts = queriedPosts.slice(0, safeLimit);
    const hasMore = (count ?? queriedPosts.length) > safeLimit;
    const authorIds = [...new Set(posts.map((post) => post.author_id as string).filter(Boolean))];
    const postIds = posts.map((post) => post.id as string).filter(Boolean);

    const authorMap = await getCommunityAuthorMap(supabase, authorIds);

    let pollSummaryMap = new Map<string, PollSummary>();
    if (postIds.length > 0) {
      const { data: polls, error: pollError } = await supabase
        .from("community_polls")
        .select("id, post_id, question, total_voters, closes_at")
        .in("post_id", postIds);

      if (pollError) {
        console.error("[community.initialFeed] poll query failed:", pollError);
      } else {
        pollSummaryMap = new Map(
          (polls ?? []).map((poll) => [
            poll.post_id as string,
            {
              id: poll.id as string,
              question: poll.question as string,
              total_voters: poll.total_voters as number,
              closes_at: poll.closes_at as string | null,
            },
          ]),
        );
      }
    }

    const postsWithAuthor = posts.map((post) => {
      const authorId = post.author_id as string;
      return {
        ...post,
        author: authorMap[authorId] ?? fallbackCommunityAuthor(authorId),
        user_vote: null,
        user_bookmarked: false,
        poll: pollSummaryMap.get(post.id as string) ?? null,
      } as PostWithAuthor;
    });

    const total = count ?? postsWithAuthor.length;
    return {
      posts: postsWithAuthor,
      total,
      hasMore,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[community.initialFeed] failed:", error);
    return emptyFeed;
  }
}
