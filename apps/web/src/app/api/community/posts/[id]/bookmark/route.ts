import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 1024;

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function refreshBookmarkCount(
  serviceClient: ReturnType<typeof getServiceClient>,
  postId: string
) {
  const { error: refreshError } = await serviceClient.rpc("community_update_bookmark_count", {
    p_post_id: postId,
  });
  if (refreshError) return null;

  const { data, error } = await serviceClient
    .from("community_posts")
    .select("bookmark_count")
    .eq("id", postId)
    .single();
  if (
    error ||
    typeof data?.bookmark_count !== "number" ||
    !Number.isSafeInteger(data.bookmark_count) ||
    data.bookmark_count < 0
  ) {
    return null;
  }

  return data.bookmark_count;
}

// 북마크 토글
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
    const serviceClient = getServiceClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      return NextResponse.json(
        { error: "로그인 상태를 확인하지 못했습니다." },
        { status: 503 }
      );
    }
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("community:bookmark", req, user.id),
      { maxRequests: 30, windowMs: 60 * 1000 },
      user.id,
    );
    if (rlResult) return rlResult;

    const body = await req.json().catch(() => null);
    if (
      !isRecord(body) ||
      Object.keys(body).some((key) => key !== "bookmarked") ||
      typeof body.bookmarked !== "boolean"
    ) {
      return NextResponse.json(
        { error: "저장할 북마크 상태를 확인할 수 없습니다." },
        { status: 400 }
      );
    }
    const desiredBookmarked = body.bookmarked;

    // RLS가 현재 사용자가 읽을 수 있다고 확인한 글만 service-role mutation에 넘긴다.
    const { data: visiblePost, error: visiblePostError } = await supabase
      .from("community_posts")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (visiblePostError) {
      return NextResponse.json(
        { error: "게시글 접근 상태를 확인하지 못했습니다." },
        { status: 503 }
      );
    }
    if (!visiblePost) {
      return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
    }

    // 토글이 아니라 최종 상태를 받는다. 응답 유실 뒤 같은 요청을 다시 보내도
    // 반대 상태로 뒤집히지 않는 idempotent write다.
    if (!desiredBookmarked) {
      const { error } = await serviceClient
        .from("community_bookmarks")
        .delete()
        .eq("user_id", user.id)
        .eq("post_id", id);

      if (error) {
        console.error("Bookmark delete error:", error);
        return NextResponse.json(
          { error: "북마크 처리에 실패했습니다." },
          { status: 500 }
        );
      }
    } else {
      const { error } = await serviceClient
        .from("community_bookmarks")
        .insert({
          user_id: user.id,
          post_id: id,
        });

      if (error && error.code !== "23505") {
        console.error("Bookmark insert error:", error);
        return NextResponse.json(
          { error: "북마크 처리에 실패했습니다." },
          { status: 500 }
        );
      }
    }

    const { data: confirmedBookmark, error: confirmationError } = await serviceClient
      .from("community_bookmarks")
      .select("id")
      .eq("user_id", user.id)
      .eq("post_id", id)
      .maybeSingle();
    if (confirmationError || Boolean(confirmedBookmark) !== desiredBookmarked) {
      return NextResponse.json(
        {
          error: "북마크 저장 결과를 확인하지 못했습니다. 같은 상태로 다시 시도해주세요.",
          retrySafe: true,
        },
        { status: 503 }
      );
    }

    const bookmarkCount = await refreshBookmarkCount(serviceClient, id);

    return NextResponse.json({
      bookmarked: desiredBookmarked,
      bookmark_count: bookmarkCount,
      count_verified: bookmarkCount !== null,
    });
  } catch (err) {
    console.error("Bookmark toggle error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
