import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Math.min(1000, parseInt(searchParams.get("page") ?? "1") || 1));
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") ?? "20") || 20));
    const offset = (page - 1) * limit;

    // 사용자가 upvote한 게시글 ID 목록 가져오기
    const { data: votes, error: votesError } = await supabase
      .from("community_votes")
      .select("post_id, created_at")
      .eq("user_id", user.id)
      .eq("vote_type", 1)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (votesError) {
      console.error("Voted posts query error:", votesError);
      return NextResponse.json(
        { error: "좋아요한 글을 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    if (!votes || votes.length === 0) {
      return NextResponse.json({ posts: [], total: 0, hasMore: false });
    }

    const postIds = votes.map((v) => v.post_id);

    // 게시글 상세 정보 가져오기
    const { data: posts, error: postsError } = await supabase
      .from("community_posts")
      .select("*")
      .in("id", postIds)
      .or(`visibility.eq.public,visibility.eq.members`);

    if (postsError) {
      console.error("Voted posts detail error:", postsError);
      return NextResponse.json(
        { error: "게시글을 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    // 작성자 프로필 조회
    const authorIds = [...new Set((posts ?? []).map((p) => p.author_id))];
    let authorMap: Record<string, { nickname: string; rank: string; wedding_year: number | null; wedding_month: number | null }> = {};
    if (authorIds.length > 0) {
      const { data: profiles } = await supabase
        .from("community_profiles")
        .select("user_id, nickname, rank, wedding_year, wedding_month")
        .in("user_id", authorIds);
      if (profiles) {
        authorMap = Object.fromEntries(
          profiles.map((p) => [p.user_id, { nickname: p.nickname, rank: p.rank, wedding_year: p.wedding_year, wedding_month: p.wedding_month }])
        );
      }
    }

    // 투표 순서대로 정렬 (최근 좋아요한 것이 위)
    const postMap = new Map((posts ?? []).map((p) => [p.id, p]));
    const sortedPosts = postIds
      .map((id) => postMap.get(id))
      .filter(Boolean)
      .map((post) => ({
        ...post,
        author: authorMap[post!.author_id] ?? { nickname: "익명", rank: "sprout", wedding_year: null, wedding_month: null },
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

    return NextResponse.json({ posts: sortedPosts, total, hasMore });
  } catch (err) {
    console.error("Voted posts error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
