import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { canReadCommunityPost } from "@/lib/community/publicPostRules";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

function getServiceClient() {
  return createAdminClient();
}

// 조회수 증가
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Rate limit: 10 views per post per IP per minute (prevent view count inflation)
    const rlResult = checkRateLimit(
      rateLimitKey(`community:view:${id}`, req),
      { maxRequests: 10, windowMs: 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: visiblePost, error: visibilityError } = await supabase
      .from("community_posts")
      .select("id, author_id, visibility, under_review")
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
      !canReadCommunityPost(visiblePost, { userId: user?.id ?? null })
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
