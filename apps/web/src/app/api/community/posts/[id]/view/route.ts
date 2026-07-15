import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { canReadCommunityPost } from "@/lib/community/publicPostRules";
import { getCommunityActorIdForUser } from "@/lib/community/actorIdentity";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 조회수 증가
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError) {
      return NextResponse.json(
        { error: "로그인 상태를 확인하지 못했습니다." },
        { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } },
      );
    }

    // Authenticated views are lifecycle-bound to the user. Anonymous views stay IP-bound.
    const rlResult = await checkRateLimitPersistent(
      rateLimitKey(`community:view:${id}`, req, user?.id),
      { maxRequests: 10, windowMs: 60 * 1000 },
      user?.id,
    );
    if (rlResult) return rlResult;

    const viewerActorId = await getCommunityActorIdForUser(user?.id);
    const { data: visiblePost, error: visibilityError } = await supabase
      .from("community_posts")
      .select("id, author_id:author_public_id, visibility, under_review")
      .eq("id", id)
      .maybeSingle();

    if (visibilityError) {
      console.error("View visibility check error:", visibilityError);
      return NextResponse.json(
        { error: "게시글 접근 확인에 실패했습니다." },
        { status: 500 }
      );
    }

    if (
      !visiblePost ||
      !canReadCommunityPost(visiblePost, {
        actorId: viewerActorId,
        isAuthenticated: Boolean(user),
      })
    ) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // RPC로 원자적 조회수 증가
    const { error } = await getServiceClient().rpc("community_increment_view", {
      p_post_id: id,
    });

    if (error) {
      console.error("Increment view RPC error:", error);
      return NextResponse.json(
        { error: "조회수 업데이트에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Increment view error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
