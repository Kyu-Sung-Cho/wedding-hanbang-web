import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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
