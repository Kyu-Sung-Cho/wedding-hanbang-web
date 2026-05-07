import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import type { PollWithOptions } from "@/types/community.types";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface PollRow {
  id: string;
  post_id: string;
  question: string;
  allow_multiple: boolean;
  is_anonymous: boolean;
  hide_results_until_voted: boolean;
  closes_at: string | null;
  total_voters: number;
  total_votes: number;
  created_at: string;
}

interface OptionRow {
  id: string;
  poll_id: string;
  position: number;
  label: string;
  image_url: string | null;
  vote_count: number;
}

async function loadPollWithOptions(
  serviceClient: ReturnType<typeof getServiceClient>,
  pollId: string,
  userId: string | null
): Promise<PollWithOptions | null> {
  const { data: poll } = await serviceClient
    .from("community_polls")
    .select("*")
    .eq("id", pollId)
    .maybeSingle();
  if (!poll) return null;
  const pollRow = poll as PollRow;

  const { data: options } = await serviceClient
    .from("community_poll_options")
    .select("*")
    .eq("poll_id", pollId)
    .order("position", { ascending: true });
  const optionRows = (options ?? []) as OptionRow[];

  let userVotedOptionIds: string[] = [];
  if (userId) {
    const { data: votes } = await serviceClient
      .from("community_poll_votes")
      .select("option_id")
      .eq("poll_id", pollId)
      .eq("user_id", userId);
    userVotedOptionIds = (votes ?? []).map((v: { option_id: string }) => v.option_id);
  }

  return {
    id: pollRow.id,
    post_id: pollRow.post_id,
    question: pollRow.question,
    allow_multiple: pollRow.allow_multiple,
    is_anonymous: pollRow.is_anonymous,
    hide_results_until_voted: pollRow.hide_results_until_voted,
    closes_at: pollRow.closes_at,
    total_voters: pollRow.total_voters,
    total_votes: pollRow.total_votes,
    created_at: pollRow.created_at,
    options: optionRows,
    user_voted_option_ids: userVotedOptionIds,
  };
}

// 폴 단건 조회 (이미 후속 갱신 시 유용)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ pollId: string }> }
) {
  try {
    const { pollId } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const serviceClient = getServiceClient();

    const poll = await loadPollWithOptions(serviceClient, pollId, user?.id ?? null);
    if (!poll) {
      return NextResponse.json({ error: "투표를 찾을 수 없습니다." }, { status: 404 });
    }

    // 부모 게시글 가시성 검증
    const { data: post } = await serviceClient
      .from("community_posts")
      .select("visibility, author_id")
      .eq("id", poll.post_id)
      .maybeSingle();
    if (!post) {
      return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
    }
    if (post.visibility === "draft" && post.author_id !== user?.id) {
      return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
    }
    if (post.visibility === "members" && !user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    return NextResponse.json({ poll });
  } catch (err) {
    console.error("[poll.GET] error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

// 투표 (토글 / 교체)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pollId: string }> }
) {
  try {
    const { pollId } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // Rate limit: 30 votes / minute / user — 사용자가 빠르게 마음 바꾸는 건 허용
    const rl = checkRateLimit(
      rateLimitKey("community:poll:vote", req, user.id),
      { maxRequests: 30, windowMs: 60_000 }
    );
    if (rl) return rl;

    const body = await req.json().catch(() => ({}));
    const optionId = typeof body.option_id === "string" ? body.option_id : null;
    if (!optionId) {
      return NextResponse.json({ error: "옵션을 선택해주세요." }, { status: 400 });
    }

    const serviceClient = getServiceClient();

    const { data: rpcRaw, error: rpcError } = await serviceClient.rpc(
      "community_cast_poll_vote",
      {
        p_poll_id: pollId,
        p_option_id: optionId,
        p_user_id: user.id,
      }
    );

    if (rpcError) {
      console.error("[poll.POST] RPC error:", rpcError);
      return NextResponse.json({ error: "투표 처리에 실패했습니다." }, { status: 500 });
    }

    const rpcResult = rpcRaw as { ok: boolean; error?: string; action?: string } | null;
    if (!rpcResult || !rpcResult.ok) {
      const code = rpcResult?.error;
      const msg =
        code === "poll_closed"
          ? "마감된 투표입니다."
          : code === "poll_not_found"
            ? "투표를 찾을 수 없습니다."
            : code === "option_invalid"
              ? "잘못된 옵션입니다."
              : code === "forbidden"
                ? "투표 권한이 없습니다."
                : "투표 처리에 실패했습니다.";
      const status =
        code === "poll_not_found"
          ? 404
          : code === "forbidden"
            ? 403
            : code === "poll_closed"
              ? 410
              : 400;
      return NextResponse.json({ error: msg }, { status });
    }

    const updatedPoll = await loadPollWithOptions(serviceClient, pollId, user.id);
    if (!updatedPoll) {
      return NextResponse.json({ error: "투표 결과를 불러올 수 없습니다." }, { status: 500 });
    }

    return NextResponse.json({ poll: updatedPoll, action: rpcResult.action });
  } catch (err) {
    console.error("[poll.POST] error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
