import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { fallbackCommunityAuthor, getCommunityAuthorMap } from "@/lib/community/authorProfiles";
import { PUBLIC_COMMUNITY_POST_QUERY_FILTERS } from "@/lib/community/publicPostRules";
import { isCommunityCategory } from "@/lib/community/routes";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { cleanPostgrestSearchTerm, escapePostgrestLikePattern } from "@/utils/requestValidation";

type CommunityPostWithAuthorId = {
  id: string;
  author_id: string;
} & Record<string, unknown>;

type SupabaseServerClient = Awaited<ReturnType<typeof createClientFromRequest>>;

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, Cookie, Origin, Sec-Fetch-Site",
};

function json(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    ...init,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

async function attachAuthorProfiles(
  supabase: SupabaseServerClient,
  posts: CommunityPostWithAuthorId[]
) {
  const authorIds = [...new Set(posts.map((post) => post.author_id))].filter(
    Boolean
  );
  const authorMap = await getCommunityAuthorMap(supabase, authorIds);

  return posts.map((post) => ({
    ...post,
    author: authorMap[post.author_id] ?? fallbackCommunityAuthor(post.author_id),
  }));
}

// 전문 검색
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { searchParams } = new URL(req.url);

    const q = searchParams.get("q");
    const categoryParam = searchParams.get("category");
    const category = isCommunityCategory(categoryParam) ? categoryParam : null;
    const page = Math.max(1, Math.min(1000, parseInt(searchParams.get("page") ?? "1") || 1));
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") ?? "20") || 20));
    const offset = (page - 1) * limit;

    if (!q || q.trim().length === 0) {
      return json(
        { error: "검색어를 입력해주세요." },
        { status: 400 }
      );
    }

    // 검색어 최대 길이 제한
    if (q.length > 100) {
      return json(
        { error: "검색어는 100자 이내로 입력해주세요." },
        { status: 400 }
      );
    }

    // Rate limit: 30 searches per minute per IP
    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("community:search", req),
      { maxRequests: 30, windowMs: 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // search_vector를 사용한 전문 검색
    let query = supabase
      .from("community_posts")
      .select(COMMUNITY_POST_PUBLIC_SELECT, { count: "exact" })
      .textSearch("search_vector", q, {
        type: "plain",
        config: "simple",
      })
      .eq("visibility", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.visibility)
      .eq("under_review", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.underReview)
      .eq("ad_disclosure", "general")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) {
      query = query.eq("category", category);
    }

    const { data: posts, count, error } = await query;

    if (error) {
      console.error("Community search error:", error);

      // search_vector 칼럼이 없는 경우 ilike 폴백
      // SQL 특수 문자 이스케이프 (SQL injection 방지)
      const safeTerm = cleanPostgrestSearchTerm(q, 100);
      const escaped = safeTerm ? escapePostgrestLikePattern(safeTerm) : "";
      if (!escaped) {
        return json(
          { error: "검색어를 입력해주세요." },
          { status: 400 }
        );
      }
      let fallbackQuery = supabase
        .from("community_posts")
        .select(COMMUNITY_POST_PUBLIC_SELECT, { count: "exact" })
        .or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%`)
        .eq("visibility", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.visibility)
        .eq("under_review", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.underReview)
        .eq("ad_disclosure", "general")
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (category) {
        fallbackQuery = fallbackQuery.eq("category", category);
      }

      const {
        data: fallbackPosts,
        count: fallbackCount,
        error: fallbackError,
      } = await fallbackQuery;

      if (fallbackError) {
        console.error("Community search fallback error:", fallbackError);
        return json(
          { error: "검색에 실패했습니다." },
          { status: 500 }
        );
      }

      // 인증 사용자의 투표 상태
      const postsWithAuthors = await attachAuthorProfiles(
        supabase,
        (fallbackPosts ?? []) as CommunityPostWithAuthorId[]
      );

      let userVotesMap: Record<string, number> = {};
      if (user && postsWithAuthors.length > 0) {
        const postIds = postsWithAuthors.map((p) => p.id);
        const { data: votes } = await supabase
          .from("community_votes")
          .select("post_id, vote_type")
          .eq("user_id", user.id)
          .in("post_id", postIds);

        if (votes) {
          userVotesMap = Object.fromEntries(
            votes.map((v) => [v.post_id, v.vote_type])
          );
        }
      }

      const postsWithVotes = postsWithAuthors.map((post) => ({
        ...post,
        user_vote: userVotesMap[post.id] ?? null,
      }));

      const total = fallbackCount ?? 0;
      return json({
        posts: postsWithVotes,
        total,
        hasMore: offset + limit < total,
      });
    }

    // 인증 사용자의 투표 상태
    const postsWithAuthors = await attachAuthorProfiles(
      supabase,
      (posts ?? []) as CommunityPostWithAuthorId[]
    );

    let userVotesMap: Record<string, number> = {};
    if (user && postsWithAuthors.length > 0) {
      const postIds = postsWithAuthors.map((p) => p.id);
      const { data: votes } = await supabase
        .from("community_votes")
        .select("post_id, vote_type")
        .eq("user_id", user.id)
        .in("post_id", postIds);

      if (votes) {
        userVotesMap = Object.fromEntries(
          votes.map((v) => [v.post_id, v.vote_type])
        );
      }
    }

    const postsWithVotes = postsWithAuthors.map((post) => ({
      ...post,
      user_vote: userVotesMap[post.id] ?? null,
    }));

    const total = count ?? 0;
    return json({
      posts: postsWithVotes,
      total,
      hasMore: offset + limit < total,
    });
  } catch (err) {
    console.error("Community search error:", err);
    return json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
