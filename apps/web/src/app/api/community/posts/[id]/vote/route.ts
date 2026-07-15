import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 1024;

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
    if (!isUuid(id)) {
      return NextResponse.json({ error: "게시글을 확인할 수 없습니다." }, { status: 400 });
    }
    if (isBodyTooLarge(req, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      return NextResponse.json(
        { error: "로그인 상태를 확인하지 못했습니다." },
        { status: 503 },
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("community:post:vote", req, user.id),
      { maxRequests: 60, windowMs: 60 * 1000 },
      user.id,
    );
    if (rlResult) return rlResult;

    const body = await req.json().catch(() => null);
    const voteType = isRecord(body) ? body.voteType : undefined;

    if (
      !isPostVoteType(voteType) ||
      !isRecord(body) ||
      Object.keys(body).some((key) => key !== "voteType")
    ) {
      return NextResponse.json(
        { error: "게시물 좋아요는 좋아요 또는 취소만 가능합니다." },
        { status: 400 }
      );
    }

    const { data: visiblePost, error: visiblePostError } = await supabase
      .from("community_posts")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (visiblePostError) {
      return NextResponse.json(
        { error: "게시글 접근 상태를 확인하지 못했습니다." },
        { status: 503 },
      );
    }

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

    const { data: counts, error: countsError } = await admin
      .from("community_posts")
      .select("upvote_count, downvote_count")
      .eq("id", id)
      .single();

    if (
      countsError ||
      typeof counts?.upvote_count !== "number" ||
      !Number.isSafeInteger(counts.upvote_count) ||
      counts.upvote_count < 0 ||
      typeof counts.downvote_count !== "number" ||
      !Number.isSafeInteger(counts.downvote_count) ||
      counts.downvote_count < 0
    ) {
      return NextResponse.json(
        {
          error: "좋아요 저장 결과를 확인하지 못했습니다. 같은 상태로 다시 시도해주세요.",
          retrySafe: true,
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      upvote_count: counts.upvote_count,
      downvote_count: counts.downvote_count,
    });
  } catch (err) {
    console.error("Vote post error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
