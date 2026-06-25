import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { PUBLIC_COMMUNITY_POST_VISIBILITY } from "@/lib/community/publicPostRules";
import { createPublicClient } from "@/lib/supabase/public";
import type {
  CommunityProfile,
  InitialCommunityFeed,
  PollSummary,
  PostWithAuthor,
} from "@/types/community.types";

const DEFAULT_LIMIT = 10;

function fallbackAuthor(userId: string): CommunityProfile {
  return {
    user_id: userId,
    nickname: "익명",
    avatar_url: null,
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
    created_at: "",
  };
}

function normalizeProfile(profile: Partial<CommunityProfile> | null | undefined, userId: string): CommunityProfile {
  const fallback = fallbackAuthor(userId);
  return {
    ...fallback,
    ...profile,
    user_id: profile?.user_id ?? userId,
    nickname: profile?.nickname || fallback.nickname,
    avatar_url: profile?.avatar_url ?? null,
    rank: profile?.rank ?? fallback.rank,
    wedding_year: profile?.wedding_year ?? null,
    wedding_month: profile?.wedding_month ?? null,
  };
}

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
      .eq("visibility", PUBLIC_COMMUNITY_POST_VISIBILITY)
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

    let authorMap = new Map<string, CommunityProfile>();
    if (authorIds.length > 0) {
      const { data: profiles, error: profileError } = await supabase
        .from("community_profiles")
        .select("user_id, nickname, avatar_url, rank, wedding_year, wedding_month")
        .in("user_id", authorIds);

      if (profileError) {
        console.error("[community.initialFeed] profile query failed:", profileError);
      } else {
        authorMap = new Map(
          (profiles ?? []).map((profile) => [
            profile.user_id as string,
            normalizeProfile(profile as Partial<CommunityProfile>, profile.user_id as string),
          ]),
        );
      }
    }

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
        author: authorMap.get(authorId) ?? fallbackAuthor(authorId),
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
