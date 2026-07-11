import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

type PostVoteType = 0 | 1;

function isPostVoteType(value: unknown): value is PostVoteType {
  return value === 0 || value === 1;
}

// 게시물 좋아요
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const rlResult = checkRateLimit(
      rateLimitKey("community:post:vote", req, user.id),
      { maxRequests: 60, windowMs: 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const { voteType } = (await req.json()) as { voteType?: unknown };

    if (!isPostVoteType(voteType)) {
      return NextResponse.json(
        { error: "게시물 좋아요는 좋아요 또는 취소만 가능합니다." },
        { status: 400 }
      );
    }

    const { data: visiblePost } = await supabase
      .from("community_posts")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (!visiblePost) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const admin = createAdminClient();
    const { error } = await admin.rpc("community_vote_post", {
      p_user_id: user.id,
      p_post_id: id,
      p_vote_type: voteType,
    });

    if (error) {
      console.error("Vote post RPC error:", error);
      return NextResponse.json(
        { error: "좋아요 처리에 실패했습니다." },
        { status: 500 }
      );
    }

    const { data: counts } = await admin
      .from("community_posts")
      .select("upvote_count, downvote_count")
      .eq("id", id)
      .single();

    return NextResponse.json({
      upvote_count: Math.max(0, counts?.upvote_count ?? 0),
      downvote_count: Math.max(0, counts?.downvote_count ?? 0),
    });
  } catch (err) {
    console.error("Vote post error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
