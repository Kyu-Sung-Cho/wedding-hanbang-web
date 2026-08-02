import { createAdminClient } from "@/lib/supabase/admin";
import { canReadCommunityPost } from "@/lib/community/publicPostRules";
import { PrivateNextResponse as NextResponse } from "@/lib/http/privateResponse";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import {
  COMMUNITY_WRITE_DENIED_MESSAGE,
  isCommunityActorWriteDenied,
} from "@/lib/community/actorWriteGate";

function getServiceClient() {
  return createAdminClient();
}

// 북마크 토글
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json(
        { error: "잘못된 게시글 ID입니다." },
        { status: 400 },
      );
    }

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
      rateLimitKey("community:bookmark", req, user.id),
      { maxRequests: 30, windowMs: 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const { data: visiblePost, error: visibilityError } = await getServiceClient()
      .from("community_posts")
      .select("id, author_id, visibility, under_review")
      .eq("id", id)
      .maybeSingle();

    if (visibilityError) {
      console.error(
        "Bookmark visibility check error:",
        safeErrorDiagnostic(visibilityError),
      );
      return NextResponse.json(
        { error: "게시글 접근 확인에 실패했습니다." },
        { status: 500 },
      );
    }

    if (!visiblePost || !canReadCommunityPost(visiblePost, { userId: user.id })) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const serviceClient = getServiceClient();
    const { data: toggleResult, error: toggleError } = await serviceClient.rpc(
      "community_toggle_bookmark",
      {
        p_post_id: id,
        p_user_id: user.id,
      },
    );

    if (toggleError) {
      if (isCommunityActorWriteDenied(toggleError)) {
        return NextResponse.json(
          { error: COMMUNITY_WRITE_DENIED_MESSAGE },
          { status: 403 },
        );
      }
      if (toggleError.code === "P0002") {
        return NextResponse.json(
          { error: "게시글을 찾을 수 없습니다." },
          { status: 404 },
        );
      }

      console.error("Bookmark toggle RPC error:", safeErrorDiagnostic(toggleError));
      return NextResponse.json(
        { error: "북마크 처리에 실패했습니다." },
        { status: 500 },
      );
    }

    if (
      !isRecord(toggleResult)
      || typeof toggleResult.bookmarked !== "boolean"
      || typeof toggleResult.bookmark_count !== "number"
      || !Number.isInteger(toggleResult.bookmark_count)
      || toggleResult.bookmark_count < 0
    ) {
      console.error("Bookmark toggle RPC returned an invalid result");
      return NextResponse.json(
        { error: "북마크 처리에 실패했습니다." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      bookmarked: toggleResult.bookmarked,
      bookmark_count: toggleResult.bookmark_count,
    });
  } catch (err) {
    console.error("Bookmark toggle error:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
