import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

// 게시글 투표
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // Rate limit: 60 votes per minute per user
    const rlResult = checkRateLimit(
      rateLimitKey("community:post:vote", req, user.id),
      { maxRequests: 60, windowMs: 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const { voteType } = (await req.json()) as { voteType: 1 | -1 | 0 };

    if (![1, -1, 0].includes(voteType)) {
      return NextResponse.json(
        { error: "잘못된 투표 값입니다." },
        { status: 400 }
      );
    }

    // RPC 호출로 원자적 투표 처리
    const { data, error } = await supabase.rpc("community_vote_post", {
      p_user_id: user.id,
      p_post_id: id,
      p_vote_type: voteType,
    });

    if (error) {
      console.error("Vote post RPC error:", error);
      return NextResponse.json(
        { error: "투표 처리에 실패했습니다." },
        { status: 500 }
      );
    }

    // 게이미피케이션: 추천 시 글 작성자에게 XP 지급 (비차단)
    if (voteType === 1) {
      try {
        const admin = createSupabaseClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        const { data: post } = await admin
          .from("community_posts")
          .select("author_id")
          .eq("id", id)
          .single();

        if (post && post.author_id !== user.id) {
          void admin
            .rpc("community_award_xp", {
              p_user_id: post.author_id,
              p_action: "receive_upvote",
              p_xp: 5,
              p_reference_id: id,
            })
            .then(() => {}, () => {});
        }
      } catch {
        // 게이미피케이션 오류는 무시
      }
    }

    return NextResponse.json({
      upvote_count: data?.upvote_count ?? 0,
      downvote_count: data?.downvote_count ?? 0,
    });
  } catch (err) {
    console.error("Vote post error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
