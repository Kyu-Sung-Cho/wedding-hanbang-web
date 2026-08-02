import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, readBoundedJsonValue } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import {
  COMMUNITY_WRITE_DENIED_MESSAGE,
  isCommunityActorWriteDenied,
} from "@/lib/community/actorWriteGate";

const MAX_BODY_BYTES = 2 * 1024;

// 댓글 투표
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

    const bodyResult = await readBoundedJsonValue(req, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.reason === "too_large" ? "요청 본문이 너무 큽니다." : "잘못된 요청입니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    const voteType = isRecord(bodyResult.value) ? bodyResult.value.voteType : undefined;

    if (voteType !== 1 && voteType !== -1 && voteType !== 0) {
      return NextResponse.json(
        { error: "잘못된 투표 값입니다." },
        { status: 400 }
      );
    }

    const { data: visibleComment, error: visibilityError } = await supabase
      .from("community_comments")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (visibilityError) {
      console.error(
        "Vote comment visibility check error:",
        safeErrorDiagnostic(visibilityError),
      );
      return NextResponse.json(
        { error: "댓글 접근을 확인하지 못했습니다." },
        { status: 500 },
      );
    }

    if (!visibleComment) {
      return NextResponse.json(
        { error: "댓글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // RPC 호출로 원자적 투표 처리
    // Keep the visibility check under caller RLS, then cross the mutation
    // boundary with the server role so direct clients cannot evade the
    // persistent limiter above.
    const { error } = await createAdminClient().rpc("community_vote_comment", {
      p_user_id: user.id,
      p_comment_id: id,
      p_vote_type: voteType,
    });

    if (error) {
      if (isCommunityActorWriteDenied(error)) {
        return NextResponse.json(
          { error: COMMUNITY_WRITE_DENIED_MESSAGE },
          { status: 403 },
        );
      }
      console.error("Vote comment RPC error:", safeErrorDiagnostic(error));
      return NextResponse.json(
        { error: "투표 처리에 실패했습니다." },
        { status: 500 }
      );
    }

    const { data: counts, error: countsError } = await supabase
      .from("community_comments")
      .select("upvote_count")
      .eq("id", id)
      .single();

    if (countsError || !counts) {
      console.error(
        "Read comment vote counts error:",
        safeErrorDiagnostic(countsError ?? "missing_vote_counts"),
      );
      return NextResponse.json(
        { error: "추천 수를 확인하지 못했습니다." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      upvote_count: counts.upvote_count ?? 0,
    });
  } catch (err) {
    console.error("Vote comment error:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
