import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

function getServiceClient() {
  return createAdminClient();
}

async function refreshBookmarkCount(
  serviceClient: ReturnType<typeof getServiceClient>,
  postId: string
) {
  await serviceClient.rpc("community_update_bookmark_count", {
    p_post_id: postId,
  });

  const { data } = await serviceClient
    .from("community_posts")
    .select("bookmark_count")
    .eq("id", postId)
    .single();

  return Math.max(0, data?.bookmark_count ?? 0);
}

// 북마크 토글
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const rlResult = checkRateLimit(
      rateLimitKey("community:bookmark", req, user.id),
      { maxRequests: 30, windowMs: 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const { data: existing } = await supabase
      .from("community_bookmarks")
      .select("id")
      .eq("user_id", user.id)
      .eq("post_id", id)
      .maybeSingle();

    let bookmarked: boolean;

    if (existing) {
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

      bookmarked = false;
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

      bookmarked = true;
    }

    const bookmarkCount = await refreshBookmarkCount(serviceClient, id);

    return NextResponse.json({
      bookmarked,
      bookmark_count: bookmarkCount,
    });
  } catch (err) {
    console.error("Bookmark toggle error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
