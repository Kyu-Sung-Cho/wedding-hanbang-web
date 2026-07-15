import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { canReadCommunityPost } from "@/lib/community/publicPostRules";
import { getCommunityActorIdForUser } from "@/lib/community/actorIdentity";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isUuid } from "@/utils/requestValidation";
import type { PollWithOptions } from "@/types/community.types";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function loadHistoricalPoll(pollId: string, userId: string | null): Promise<PollWithOptions | null> {
  const serviceClient = getServiceClient();
  const { data: poll, error: pollError } = await serviceClient
    .from("community_polls")
    .select("id, post_id, question, allow_multiple, is_anonymous, hide_results_until_voted, closes_at, total_voters, total_votes, created_at")
    .eq("id", pollId)
    .maybeSingle();
  if (pollError || !poll) return null;

  const { data: options, error: optionError } = await serviceClient
    .from("community_poll_options")
    .select("id, poll_id, position, label, vote_count")
    .eq("poll_id", pollId)
    .order("position", { ascending: true });
  if (optionError) return null;

  let userVotedOptionIds: string[] = [];
  if (userId) {
    const { data: votes, error: voteError } = await serviceClient
      .from("community_poll_votes")
      .select("option_id")
      .eq("poll_id", pollId)
      .eq("user_id", userId);
    if (voteError) return null;
    userVotedOptionIds = (votes ?? []).map((vote) => vote.option_id as string);
  }

  return {
    ...poll,
    options: (options ?? []).map((option) => ({ ...option, image_url: null })),
    user_voted_option_ids: userVotedOptionIds,
  } as PollWithOptions;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ pollId: string }> },
) {
  const { pollId } = await params;
  if (!isUuid(pollId)) {
    return NextResponse.json({ error: "투표를 찾을 수 없습니다." }, { status: 404 });
  }

  const supabase = await createClientFromRequest(req);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    return NextResponse.json({ error: "로그인 상태를 확인하지 못했습니다." }, { status: 503 });
  }

  const poll = await loadHistoricalPoll(pollId, user?.id ?? null);
  if (!poll) {
    return NextResponse.json({ error: "투표를 찾을 수 없습니다." }, { status: 404 });
  }

  const viewerActorId = await getCommunityActorIdForUser(user?.id);
  const { data: post, error: postError } = await getServiceClient()
    .from("community_posts")
    .select("visibility, author_id:author_public_id, under_review")
    .eq("id", poll.post_id)
    .maybeSingle();
  if (postError) {
    return NextResponse.json({ error: "게시글 상태를 확인하지 못했습니다." }, { status: 503 });
  }
  if (!post || !canReadCommunityPost(post, {
    actorId: viewerActorId,
    isAuthenticated: Boolean(user),
  })) {
    const requiresLogin = post?.visibility === "members" && !user && post.under_review !== true;
    return NextResponse.json(
      { error: requiresLogin ? "로그인이 필요합니다." : "게시글을 찾을 수 없습니다." },
      { status: requiresLogin ? 401 : 404 },
    );
  }

  return NextResponse.json({ poll });
}

export async function POST() {
  return NextResponse.json(
    {
      error: "새 투표와 투표 변경은 현재 제공하지 않습니다.",
      code: "community_poll_writes_retired",
    },
    {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
