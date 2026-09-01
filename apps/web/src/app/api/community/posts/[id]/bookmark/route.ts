import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/utils/log";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { isRecord, isUuid, readBoundedUtf8Text } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 512;

function getServiceClient() {
  return createAdminClient();
}

// 북마크 상태 설정
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
    if (!isUuid(id)) {
      return NextResponse.json(
        { error: "잘못된 게시글 ID입니다." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const supabase = await createClientFromRequest(req);
    const serviceClient = getServiceClient();
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
      rateLimitKey("community:bookmark", req, user.id),
      { maxRequests: 30, windowMs: 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const rawBody = await readBoundedUtf8Text(req, MAX_BODY_BYTES);
    if (!rawBody.ok) {
      return NextResponse.json(
        { error: rawBody.reason === "too_large" ? "요청 본문이 너무 큽니다." : "잘못된 요청입니다." },
        {
          status: rawBody.reason === "too_large" ? 413 : 400,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody.text);
    } catch {
      return NextResponse.json(
        { error: "잘못된 요청입니다." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (
      !isRecord(body)
      || Object.keys(body).some((key) => key !== "bookmarked")
      || typeof body.bookmarked !== "boolean"
    ) {
      return NextResponse.json(
        { error: "북마크 상태를 확인해 주세요." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    if (body.bookmarked) {
      const writeAccess = await checkCommunityWriteAccess(supabase, user.id);
      if (!writeAccess.allowed) {
        return NextResponse.json(
          { error: writeAccess.message, code: writeAccess.code },
          { status: writeAccess.status }
        );
      }
    }

    const { data: result, error } = await serviceClient.rpc(
      "community_set_post_bookmark",
      {
        p_user_id: user.id,
        p_post_id: id,
        p_bookmarked: body.bookmarked,
      },
    );
    if (
      error
      || !isRecord(result)
      || typeof result.bookmarked !== "boolean"
      || !Number.isSafeInteger(result.bookmark_count)
      || (result.bookmark_count as number) < 0
    ) {
      console.error("Atomic bookmark intent error:", error);
      return NextResponse.json(
        { error: "북마크 상태를 안전하게 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    return NextResponse.json(
      {
        bookmarked: result.bookmarked,
        bookmark_count: result.bookmark_count,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    log.error("api/community/posts/[id]/bookmark", err);
    console.error("Bookmark toggle error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
