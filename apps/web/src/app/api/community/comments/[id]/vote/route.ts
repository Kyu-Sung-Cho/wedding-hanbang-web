import { createClientFromRequest } from "@/lib/supabase/server";
import { log } from "@/utils/log";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

// 댓글 투표
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(req);
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
    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("community:comment:vote", req, user.id),
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

    if (voteType !== 0) {
      const writeAccess = await checkCommunityWriteAccess(supabase, user.id);
      if (!writeAccess.allowed) {
        return NextResponse.json(
          { error: writeAccess.message, code: writeAccess.code },
          { status: writeAccess.status },
        );
      }
    }

    const { data: visibleComment } = await supabase
      .from("community_comments")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (!visibleComment) {
      return NextResponse.json(
        { error: "댓글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // RPC 호출로 원자적 투표 처리
    const { error } = await supabase.rpc("community_vote_comment", {
      p_user_id: user.id,
      p_comment_id: id,
      p_vote_type: voteType,
    });

    if (error) {
      console.error("Vote comment RPC error:", error);
      return NextResponse.json(
        { error: "투표 처리에 실패했습니다." },
        { status: 500 }
      );
    }

    const { data: counts } = await supabase
      .from("community_comments")
      .select("upvote_count")
      .eq("id", id)
      .single();

    return NextResponse.json({
      upvote_count: counts?.upvote_count ?? 0,
    });
  } catch (err) {
    log.error("api/community/comments/[id]/vote", err);
    console.error("Vote comment error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
