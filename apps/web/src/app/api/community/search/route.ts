import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import type { CommunityCategory } from "@/types/community.types";

// 전문 검색
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { searchParams } = new URL(req.url);

    const q = searchParams.get("q");
    const category = searchParams.get("category") as CommunityCategory | null;
    const page = Math.max(1, Math.min(1000, parseInt(searchParams.get("page") ?? "1") || 1));
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") ?? "20") || 20));
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
    const rlResult = checkRateLimit(
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
      .select(
        "*, author:community_profiles!community_posts_author_id_fkey(*)",
        { count: "exact" }
      )
      .textSearch("search_vector", q, {
        type: "plain",
        config: "korean",
      })
      .eq("visibility", "public")
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
      const escaped = q.replace(/[%_\\]/g, (c) => `\\${c}`);
      let fallbackQuery = supabase
        .from("community_posts")
        .select(
          "*, author:community_profiles!community_posts_author_id_fkey(*)",
          { count: "exact" }
        )
        .or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%`)
        .eq("visibility", "public")
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
        return NextResponse.json(
          { error: "검색에 실패했습니다." },
          { status: 500 }
        );
      }

      // 인증 사용자의 투표 상태
      let userVotesMap: Record<string, number> = {};
      if (user && fallbackPosts && fallbackPosts.length > 0) {
        const postIds = fallbackPosts.map((p) => p.id);
        const { data: votes } = await supabase
          .from("community_votes")
          .select("target_id, vote_type")
          .eq("user_id", user.id)
          .eq("target_type", "post")
          .in("target_id", postIds);

        if (votes) {
          userVotesMap = Object.fromEntries(
            votes.map((v) => [v.target_id, v.vote_type])
          );
        }
      }

      const postsWithVotes = (fallbackPosts ?? []).map((post) => ({
        ...post,
        user_vote: userVotesMap[post.id] ?? null,
      }));

      const total = fallbackCount ?? 0;
      return NextResponse.json({
        posts: postsWithVotes,
        total,
        hasMore: offset + limit < total,
      });
    }

    // 인증 사용자의 투표 상태
    let userVotesMap: Record<string, number> = {};
    if (user && posts && posts.length > 0) {
      const postIds = posts.map((p) => p.id);
      const { data: votes } = await supabase
        .from("community_votes")
        .select("target_id, vote_type")
        .eq("user_id", user.id)
        .eq("target_type", "post")
        .in("target_id", postIds);

      if (votes) {
        userVotesMap = Object.fromEntries(
          votes.map((v) => [v.target_id, v.vote_type])
        );
      }
    }

    const postsWithVotes = (posts ?? []).map((post) => ({
      ...post,
      user_vote: userVotesMap[post.id] ?? null,
    }));

    const total = count ?? 0;
    return NextResponse.json({
      posts: postsWithVotes,
      total,
      hasMore: offset + limit < total,
    });
  } catch (err) {
    console.error("Community search error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
