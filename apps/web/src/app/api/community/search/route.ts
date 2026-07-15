import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { getCommunityActorIdForUser } from "@/lib/community/actorIdentity";
import { getMutedActorIds, mutedActorFilterValue } from "@/lib/community/mutes";
import {
  CommunityAuthorProfileUnavailableError,
  getCommunityAuthorMap,
  requireCommunityAuthor,
} from "@/lib/community/authorProfiles";
import { PUBLIC_COMMUNITY_POST_QUERY_FILTERS } from "@/lib/community/publicPostRules";
import { isCommunityCategory } from "@/lib/community/routes";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { cleanPostgrestSearchTerm, escapePostgrestLikePattern } from "@/utils/requestValidation";

type CommunityPostWithAuthorId = {
  id: string;
  author_id: string;
} & Record<string, unknown>;

type SupabaseServerClient = Awaited<ReturnType<typeof createClientFromRequest>>;

async function attachAuthorProfiles(
  supabase: SupabaseServerClient,
  posts: CommunityPostWithAuthorId[],
  viewerActorId: string | null,
) {
  const authorIds = [...new Set(posts.map((post) => post.author_id))].filter(
    Boolean
  );
  const authorMap = await getCommunityAuthorMap(supabase, authorIds);

  return posts.map((post) => ({
    ...post,
    author: requireCommunityAuthor(authorMap, post.author_id),
    viewer_is_author: Boolean(viewerActorId && post.author_id === viewerActorId),
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
    const page = Math.max(1, Math.min(100, parseInt(searchParams.get("page") ?? "1") || 1));
    const limit = Math.max(1, Math.min(20, parseInt(searchParams.get("limit") ?? "20") || 20));
    const offset = (page - 1) * limit;

    if (!q || q.trim().length === 0) {
      return NextResponse.json(
        { error: "검색어를 입력해주세요." },
        { status: 400 }
      );
    }

    // 검색어 최대 길이 제한
    if (q.length > 100) {
      return NextResponse.json(
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
      error: authError,
    } = await supabase.auth.getUser();
    if (authError) {
      return NextResponse.json(
        { error: "로그인 상태를 확인하지 못했습니다." },
        {
          status: 503,
          headers: { "Cache-Control": "private, no-store, max-age=0" },
        },
      );
    }

    const viewerActorId = await getCommunityActorIdForUser(user?.id);
    const mutedActorIds = await getMutedActorIds(user?.id);
    const mutedActors = mutedActorFilterValue(mutedActorIds);

    // search_vector는 공개 열이 아니다. 안전한 공개 DTO 열만 대상으로 검색한다.
    const safeTerm = cleanPostgrestSearchTerm(q, 100);
    const escaped = safeTerm ? escapePostgrestLikePattern(safeTerm) : "";
    if (!escaped) {
      return NextResponse.json(
        { error: "검색어를 입력해주세요." },
        { status: 400 }
      );
    }

    let query = supabase
      .from("community_posts")
      .select(COMMUNITY_POST_PUBLIC_SELECT, { count: "exact" })
      .or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%`)
      .eq("visibility", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.visibility)
      .eq("under_review", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.underReview)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (mutedActors) {
      query = query.not("author_public_id", "in", mutedActors);
    }

    if (category) {
      query = query.eq("category", category);
    }

    const { data: posts, count, error } = await query;

    if (error) {
      console.error("Community search error:", error);
      return NextResponse.json(
        { error: "검색에 실패했습니다." },
        { status: 500 }
      );
    }

    // 인증 사용자의 투표 상태
    const postsWithAuthors = await attachAuthorProfiles(
      supabase,
      (posts ?? []) as CommunityPostWithAuthorId[],
      viewerActorId,
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

    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      return NextResponse.json(
        { error: "검색 결과 수를 확인하지 못했습니다." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const total = count;
    return NextResponse.json({
      posts: postsWithVotes,
      total,
      hasMore: offset + limit < total,
    });
  } catch (err) {
    console.error("Community search error:", err);
    if (err instanceof CommunityAuthorProfileUnavailableError) {
      return NextResponse.json(
        { error: "작성자 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
