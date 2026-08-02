import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { isRecord, readBoundedJsonValue } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import {
  COMMUNITY_WRITE_DENIED_MESSAGE,
  isCommunityActorWriteDenied,
} from "@/lib/community/actorWriteGate";

const MAX_BODY_BYTES = 2 * 1024;

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

    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("community:post:vote", req, user.id),
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

    if (!isPostVoteType(voteType)) {
      return NextResponse.json(
        { error: "게시물 좋아요는 좋아요 또는 취소만 가능합니다." },
        { status: 400 }
      );
    }

    const { data: visiblePost, error: visibilityError } = await supabase
      .from("community_posts")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (visibilityError) {
      console.error(
        "Vote post visibility check error:",
        safeErrorDiagnostic(visibilityError),
      );
      return NextResponse.json(
        { error: "게시글 접근을 확인하지 못했습니다." },
        { status: 500 },
      );
    }

    if (!visiblePost) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // The mutation RPC is service-only. The caller-scoped visibility check
    // above still runs under RLS, while this server-owned call prevents
    // native/PostgREST clients from bypassing the durable route limiter.
    const { error } = await createAdminClient().rpc("community_vote_post", {
      p_user_id: user.id,
      p_post_id: id,
      p_vote_type: voteType,
    });

    if (error) {
      if (isCommunityActorWriteDenied(error)) {
        return NextResponse.json(
          { error: COMMUNITY_WRITE_DENIED_MESSAGE },
          { status: 403 },
        );
      }
      console.error("Vote post RPC error:", safeErrorDiagnostic(error));
      return NextResponse.json(
        { error: "좋아요 처리에 실패했습니다." },
        { status: 500 }
      );
    }

    const { data: counts, error: countsError } = await supabase
      .from("community_posts")
      .select("upvote_count, downvote_count")
      .eq("id", id)
      .single();

    if (countsError || !counts) {
      console.error(
        "Read post vote counts error:",
        safeErrorDiagnostic(countsError ?? "missing_vote_counts"),
      );
      return NextResponse.json(
        { error: "추천 수를 확인하지 못했습니다." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      upvote_count: Math.max(0, counts.upvote_count ?? 0),
      downvote_count: Math.max(0, counts.downvote_count ?? 0),
    });
  } catch (err) {
    console.error("Vote post error:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
