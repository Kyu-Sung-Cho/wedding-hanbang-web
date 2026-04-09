import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 북마크 토글
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const serviceClient = getServiceClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // Rate limit: 30 bookmarks per minute per user
    const rlResult = checkRateLimit(
      rateLimitKey("community:bookmark", req, user.id),
      { maxRequests: 30, windowMs: 60 * 1000 }
    );
    if (rlResult) return rlResult;

    // 기존 북마크 확인
    const { data: existing } = await supabase
      .from("community_bookmarks")
      .select("id")
      .eq("user_id", user.id)
      .eq("post_id", id)
      .maybeSingle();

    let bookmarked: boolean;

    if (existing) {
      // 북마크 해제
      await serviceClient
        .from("community_bookmarks")
        .delete()
        .eq("user_id", user.id)
        .eq("post_id", id);

      // bookmark_count 감소
      await serviceClient.rpc("community_update_bookmark_count", {
        p_post_id: id,
        p_increment: -1,
      }).then(({ error: rpcError }) => {
        if (rpcError) {
          // RPC 없으면 직접 업데이트
          return serviceClient
            .from("community_posts")
            .select("bookmark_count")
            .eq("id", id)
            .single()
            .then(({ data }) => {
              return serviceClient
                .from("community_posts")
                .update({
                  bookmark_count: Math.max(0, (data?.bookmark_count ?? 1) - 1),
                })
                .eq("id", id);
            });
        }
      });

      bookmarked = false;
    } else {
      // 북마크 추가
      const { error: insertError } = await serviceClient
        .from("community_bookmarks")
        .insert({
          user_id: user.id,
          post_id: id,
        });

      if (insertError) {
        console.error("Bookmark insert error:", insertError);
        return NextResponse.json(
          { error: "북마크 처리에 실패했습니다." },
          { status: 500 }
        );
      }

      // bookmark_count 증가
      await serviceClient.rpc("community_update_bookmark_count", {
        p_post_id: id,
        p_increment: 1,
      }).then(({ error: rpcError }) => {
        if (rpcError) {
          return serviceClient
            .from("community_posts")
            .select("bookmark_count")
            .eq("id", id)
            .single()
            .then(({ data }) => {
              return serviceClient
                .from("community_posts")
                .update({
                  bookmark_count: (data?.bookmark_count ?? 0) + 1,
                })
                .eq("id", id);
            });
        }
      });

      bookmarked = true;
    }

    return NextResponse.json({ bookmarked });
  } catch (err) {
    console.error("Bookmark toggle error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
