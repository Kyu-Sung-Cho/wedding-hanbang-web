import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { fallbackCommunityAuthor, getCommunityAuthorMap } from "@/lib/community/authorProfiles";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { communityReadablePostOrFilter } from "@/lib/community/publicPostRules";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCommunityPublicIdForUser } from "@/lib/community/publicIdentity";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
};

// 사용자가 좋아요한 글 목록 조회
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:posts:voted", req, user.id),
      { maxRequests: 60, windowMs: 60 * 1000 },
    );
    if (limited) return limited;

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Math.min(200, parseInt(searchParams.get("page") ?? "1") || 1));
    const limit = Math.max(1, Math.min(50, parseInt(searchParams.get("limit") ?? "20") || 20));
    const offset = (page - 1) * limit;
    const viewerPublicId = await getCommunityPublicIdForUser(
      createAdminClient(),
      user.id,
    );
    if (!viewerPublicId) {
      return NextResponse.json(
        { posts: [], total: 0, hasMore: false },
        { headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    // 사용자가 upvote한 게시글 ID 목록 가져오기
    const { data: votes, error: votesError } = await supabase
      .from("community_votes")
      .select("post_id, created_at")
      .eq("user_id", user.id)
      .eq("vote_type", 1)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (votesError) {
      console.error("Voted posts query error", safeErrorDiagnostic(votesError));
      return NextResponse.json(
        { error: "좋아요한 글을 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    if (!votes || votes.length === 0) {
      return NextResponse.json(
        { posts: [], total: 0, hasMore: false },
        { headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    const postIds = votes.map((v) => v.post_id);

    // 게시글 상세 정보 가져오기
    const { data: posts, error: postsError } = await supabase
      .from("community_posts")
      .select(COMMUNITY_POST_PUBLIC_SELECT)
      .in("id", postIds)
      .or(communityReadablePostOrFilter(viewerPublicId));

    if (postsError) {
      console.error("Voted posts detail error", safeErrorDiagnostic(postsError));
      return NextResponse.json(
        { error: "게시글을 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    // 작성자 프로필 조회
    const authorIds = [...new Set((posts ?? []).map((p) => p.author_id))];
    const authorMap = await getCommunityAuthorMap(supabase, authorIds);

    // 투표 순서대로 정렬 (최근 좋아요한 것이 위)
    const postMap = new Map((posts ?? []).map((p) => [p.id, p]));
    const sortedPosts = postIds
      .map((id) => postMap.get(id))
      .filter(Boolean)
      .map((post) => ({
        ...post,
        author: authorMap[post!.author_id] ?? fallbackCommunityAuthor(post!.author_id),
        is_author: post!.author_id === viewerPublicId,
        user_vote: 1 as const,
      }));

    // 총 upvote 수 조회 (페이지네이션용)
    const { count: totalCount } = await supabase
      .from("community_votes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("vote_type", 1);

    const total = totalCount ?? 0;
    const hasMore = offset + limit < total;

    return NextResponse.json(
      { posts: sortedPosts, total, hasMore },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error("Voted posts error", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
