import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { canReadCommunityPost } from "@/lib/community/publicPostRules";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import { getCommunityPollActorProjection } from "@/lib/community/pollProjection";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { isRecord, isUuid } from "@/utils/requestValidation";

function getServiceClient() {
  return createAdminClient();
}

const PRIVATE_NO_STORE = "private, no-store, max-age=0";
const VIEWER_VARY = "Authorization, Cookie";

type RequestClient = Awaited<ReturnType<typeof createClientFromRequest>>;

async function loadViewerPollParent(
  client: RequestClient,
  pollId: string,
): Promise<{
  postId: string;
  post: { author_id: string; visibility: string; under_review: boolean };
} | null> {
  const { data: poll, error: pollError } = await client
    .from("community_polls")
    .select("post_id")
    .eq("id", pollId)
    .maybeSingle();
  if (pollError) throw pollError;
  if (!poll) return null;

  const { data: post, error: postError } = await client
    .from("community_posts")
    .select("author_id, visibility, under_review")
    .eq("id", poll.post_id)
    .maybeSingle();
  if (postError) throw postError;
  if (!post) return null;

  return {
    postId: poll.post_id,
    post: {
      author_id: post.author_id,
      visibility: post.visibility,
      under_review: post.under_review === true,
    },
  };
}

async function viewerCanSeeAuthor(
  viewerId: string | null,
  authorId: string,
): Promise<"visible" | "blocked" | "unavailable"> {
  if (!viewerId || viewerId === authorId) return "visible";

  const { data, error } = await getServiceClient().rpc(
    "community_viewer_can_see" as never,
    {
      p_viewer_user_id: viewerId,
      p_other_user_id: authorId,
    } as never,
  ) as { data: unknown; error: unknown };
  if (error || typeof data !== "boolean") return "unavailable";
  return data ? "visible" : "blocked";
}

// 폴 단건 조회 (이미 후속 갱신 시 유용)
async function getPollResponse(
  req: NextRequest,
  { params }: { params: Promise<{ pollId: string }> }
) {
  try {
    const { pollId } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
      error: viewerError,
    } = await supabase.auth.getUser();
    if (viewerError) {
      return NextResponse.json(
        { error: "투표를 불러올 수 없습니다." },
        { status: 503 },
      );
    }

    const parent = await loadViewerPollParent(supabase, pollId);
    if (!parent) {
      return NextResponse.json(
        { error: "투표를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    if (
      parent.post.under_review
      || !canReadCommunityPost(parent.post, { userId: user?.id ?? null })
    ) {
      const requiresLogin =
        parent.post.visibility === "members"
        && !user
        && !parent.post.under_review;
      return NextResponse.json(
        { error: requiresLogin ? "로그인이 필요합니다." : "게시글을 찾을 수 없습니다." },
        { status: requiresLogin ? 401 : 404 },
      );
    }

    if (user && parent.post.author_id !== user.id) {
      const viewerVisibility = await viewerCanSeeAuthor(
        user.id,
        parent.post.author_id,
      );
      if (viewerVisibility === "unavailable") {
        return NextResponse.json(
          { error: "투표를 불러올 수 없습니다." },
          { status: 503 },
        );
      }
      if (viewerVisibility === "blocked") {
        return NextResponse.json(
          { error: "게시글을 찾을 수 없습니다." },
          { status: 404 },
        );
      }
    }

    const poll = await getCommunityPollActorProjection(
      getServiceClient(),
      user?.id ?? null,
      pollId,
    );
    if (!poll) {
      return NextResponse.json({ error: "투표를 찾을 수 없습니다." }, { status: 404 });
    }

    // 전체 투표를 읽은 뒤에도 요청 사용자 RLS를 다시 통과시켜 차단 경합을 닫는다.
    const { data: finalVisibleParent, error: finalVisibilityError } = await supabase
      .from("community_posts")
      .select("id")
      .eq("id", poll.post_id)
      .eq("under_review", false)
      .maybeSingle();
    if (finalVisibilityError || !finalVisibleParent) {
      return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ poll });
  } catch (err) {
    console.error("[poll.GET] error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ pollId: string }> },
) {
  const response = await getPollResponse(req, context);
  response.headers.set("Cache-Control", PRIVATE_NO_STORE);
  response.headers.set("Vary", VIEWER_VARY);
  return response;
}

type SetPollVoteResult = {
  ok: boolean;
  error?: string;
  action?: string;
  current_version?: number;
  poll?: Record<string, unknown>;
};

function pollReceiptUnavailable() {
  return NextResponse.json(
    {
      code: "COMMUNITY_POLL_RECEIPT_UNAVAILABLE",
      error: "저장된 투표 처리 결과를 안전하게 확인하지 못했습니다.",
    },
    { status: 503 },
  );
}

function pollVoteReceiptResponse(
  value: unknown,
  pollId: string,
): NextResponse | null {
  if (
    !isRecord(value)
    || typeof value.ok !== "boolean"
    || Object.hasOwn(value, "replayed")
  ) {
    return null;
  }

  if (value.ok) {
    if (
      typeof value.action !== "string"
      || !["selected", "switched", "unselected", "unchanged"].includes(value.action)
      || !isRecord(value.poll)
      || value.poll.id !== pollId
    ) {
      return null;
    }
    return NextResponse.json({ poll: value.poll, action: value.action });
  }

  const code = value.error;
  if (typeof code !== "string") return null;
  if (code === "poll_stale") {
    if (
      typeof value.current_version !== "number"
      || !Number.isSafeInteger(value.current_version)
      || value.current_version < 1
    ) {
      return null;
    }
    return NextResponse.json(
      {
        error: "투표 내용이 변경되었습니다. 최신 내용을 확인한 뒤 다시 선택해 주세요.",
        code: "COMMUNITY_POLL_STALE",
        current_version: value.current_version,
      },
      { status: 409 },
    );
  }

  const failure = {
    poll_closed: { error: "마감된 투표입니다.", status: 410 },
    poll_not_found: { error: "투표를 찾을 수 없습니다.", status: 404 },
    option_invalid: { error: "잘못된 옵션입니다.", status: 400 },
    forbidden: { error: "투표 권한이 없습니다.", status: 403 },
    actor_ineligible: { error: "투표 처리에 실패했습니다.", status: 400 },
  }[code];
  return failure
    ? NextResponse.json({ error: failure.error }, { status: failure.status })
    : null;
}

function pollRpcFailure(error: { message?: string | null }) {
  const message = error.message ?? "";
  if (message.includes("idempotency key reused with different payload")) {
    return NextResponse.json(
      {
        code: "COMMUNITY_POLL_IDEMPOTENCY_CONFLICT",
        error: "같은 투표 요청 키를 다른 선택에 다시 사용할 수 없습니다.",
      },
      { status: 409 },
    );
  }
  if (message.includes("community is read_only") || message.includes("community is disabled")) {
    return NextResponse.json(
      {
        code: "COMMUNITY_RUNTIME_UNAVAILABLE",
        error: "현재 투표 변경을 잠시 사용할 수 없습니다.",
      },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }
  if (message.includes("receipt")) {
    return pollReceiptUnavailable();
  }
  return NextResponse.json(
    { code: "COMMUNITY_POLL_SAVE_FAILED", error: "투표 처리에 실패했습니다." },
    { status: 500 },
  );
}

// 투표 최종 상태 설정 (재시도해도 의도가 반전되지 않음)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pollId: string }> }
) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const { pollId } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";
    if (!isUuid(idempotencyKey)) {
      return NextResponse.json(
        {
          code: "COMMUNITY_POLL_IDEMPOTENCY_REQUIRED",
          error: "투표 요청 식별자가 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.",
        },
        { status: 400 },
      );
    }

    const body: unknown = await req.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: "투표 요청 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const optionId = body.option_id;
    const selected = body.selected;
    const pollVersion = body.poll_version;
    if (
      !isUuid(optionId)
      || typeof selected !== "boolean"
      || typeof pollVersion !== "number"
      || !Number.isSafeInteger(pollVersion)
      || pollVersion < 1
    ) {
      return NextResponse.json(
        { error: "투표 옵션, 선택 상태 또는 버전이 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const serviceClient = getServiceClient();
    const { data: replayRaw, error: replayError } = await serviceClient.rpc(
      "community_replay_poll_vote_command_service" as never,
      {
        p_actor_id: user.id,
        p_poll_id: pollId,
        p_option_id: optionId,
        p_selected: selected,
        p_expected_poll_version: pollVersion,
        p_idempotency_key: idempotencyKey,
      } as never,
    ) as { data: unknown; error: { message?: string | null } | null };
    if (replayError) return pollRpcFailure(replayError);
    if (replayRaw !== null) {
      return pollVoteReceiptResponse(replayRaw, pollId)
        ?? pollReceiptUnavailable();
    }

    // New commands alone consume the mutable rate-limit budget. An exact
    // receipt has already returned above, before current visibility or access
    // state can change the historical HTTP result.
    const rl = await checkRateLimitPersistent(
      rateLimitKey("community:poll:vote", req, user.id),
      { maxRequests: 30, windowMs: 60_000 }
    );
    if (rl) return rl;

    const parent = await loadViewerPollParent(supabase, pollId);
    if (!parent) {
      return NextResponse.json({ error: "투표를 찾을 수 없습니다." }, { status: 404 });
    }

    if (
      parent.post.under_review
      || !canReadCommunityPost(parent.post, { userId: user.id })
    ) {
      return NextResponse.json({ error: "투표 권한이 없습니다." }, { status: 403 });
    }

    // 정지 상태에서도 명시적인 selected=false 철회/무변경 요청은 허용한다.
    const viewerVisibility = await viewerCanSeeAuthor(
      user.id,
      parent.post.author_id,
    );
    if (viewerVisibility === "unavailable") {
      return NextResponse.json(
        { error: "투표 접근 권한을 확인하지 못했습니다." },
        { status: 503 },
      );
    }
    if (viewerVisibility === "blocked") {
      return NextResponse.json(
        { error: "투표를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    if (selected) {
      const writeAccess = await checkCommunityWriteAccess(supabase, user.id);
      if (!writeAccess.allowed) {
        return NextResponse.json(
          { error: writeAccess.message, code: writeAccess.code },
          { status: writeAccess.status }
        );
      }
    }

    const { data: rpcRaw, error: rpcError } = await serviceClient.rpc(
      "community_set_poll_vote",
      {
        p_user_id: user.id,
        p_poll_id: pollId,
        p_option_id: optionId,
        p_selected: selected,
        p_expected_poll_version: pollVersion,
        p_idempotency_key: idempotencyKey,
      }
    );

    if (rpcError) {
      return pollRpcFailure(rpcError);
    }

    return pollVoteReceiptResponse(rpcRaw as SetPollVoteResult | null, pollId)
      ?? pollReceiptUnavailable();
  } catch (err) {
    console.error("[poll.POST] error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
