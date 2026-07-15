import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  CommunityAuthorProfileUnavailableError,
  getCommunityAuthorMap,
  requireCommunityAuthor,
} from "@/lib/community/authorProfiles";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { getCommunityActorIdForUser } from "@/lib/community/actorIdentity";
import { getMutedActorIds, mutedActorFilterValue } from "@/lib/community/mutes";

// 사용자가 좋아요한 글 목록 조회
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError) {
      return NextResponse.json(
        { error: "로그인 상태를 확인하지 못했습니다." },
        { status: 503 },
      );
    }

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

    const viewerActorId = await getCommunityActorIdForUser(user.id);
    const mutedActorIds = await getMutedActorIds(user.id);
    const mutedActors = mutedActorFilterValue(mutedActorIds);

    // Join the readable post while counting votes so hidden, moderated, or
    // muted posts never inflate the total or leave partially empty pages.
    let votesQuery = supabase
      .from("community_votes")
      .select("post_id, created_at, community_posts!inner(author_public_id)", { count: "exact" })
      .eq("user_id", user.id)
      .eq("vote_type", 1)
      .in("community_posts.visibility", ["public", "members"])
      .eq("community_posts.under_review", false);

    if (mutedActors) {
      votesQuery = votesQuery.not("community_posts.author_public_id", "in", mutedActors);
    }

    const { data: votes, count: totalCount, error: votesError } = await votesQuery
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (votesError) {
      console.error("Voted posts query error:", votesError);
      return NextResponse.json(
        { error: "좋아요한 글을 불러올 수 없습니다." },
        { status: 500 }
      );
    }
    if (
      typeof totalCount !== "number" ||
      !Number.isSafeInteger(totalCount) ||
      totalCount < 0
    ) {
      return NextResponse.json(
        { error: "좋아요한 글 수를 확인하지 못했습니다." },
        { status: 503 },
      );
    }

    if (!votes || votes.length === 0) {
      return NextResponse.json({ posts: [], total: totalCount, hasMore: false });
    }

    const postIds = votes.map((v) => v.post_id);

    // 게시글 상세 정보 가져오기
    let postsQuery = supabase
      .from("community_posts")
      .select(COMMUNITY_POST_PUBLIC_SELECT)
      .in("id", postIds)
      .in("visibility", ["public", "members"])
      .eq("under_review", false);

    if (mutedActors) {
      postsQuery = postsQuery.not("author_public_id", "in", mutedActors);
    }

    const { data: posts, error: postsError } = await postsQuery;

    if (postsError) {
      console.error("Voted posts detail error:", postsError);
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
        ...post!,
        author: requireCommunityAuthor(authorMap, post!.author_id),
        viewer_is_author: Boolean(viewerActorId && post!.author_id === viewerActorId),
        user_vote: 1 as const,
      }));

    const total = totalCount;
    const hasMore = offset + limit < total;

    return NextResponse.json({ posts: sortedPosts, total, hasMore });
  } catch (err) {
    console.error("Voted posts error:", err);
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
