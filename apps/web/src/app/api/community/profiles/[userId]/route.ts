import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { isUuid } from "@/utils/requestValidation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { getInternalUserIdForCommunityPublicId } from "@/lib/community/publicIdentity";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
};

function getServiceClient() {
  return createAdminClient();
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: publicUserId } = await params;
    const roomId = new URL(req.url).searchParams.get("room_id");

    if (!isUuid(publicUserId) || (roomId !== null && !isUuid(roomId))) {
      return NextResponse.json(
        { error: "올바른 사용자 또는 동기방 ID가 아닙니다." },
        { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:profile:member-read", req, user.id),
      { maxRequests: 60, windowMs: 60 * 1000 },
    );
    if (limited) return limited;

    if (!roomId) {
      return NextResponse.json({ error: "동기방 정보가 필요합니다." }, { status: 400 });
    }

    const serviceClient = getServiceClient();
    const targetUserId = await getInternalUserIdForCommunityPublicId(
      serviceClient,
      publicUserId,
    );
    if (!targetUserId) {
      return NextResponse.json({ error: "?꾨줈?꾩쓣 李얠쓣 ???놁뒿?덈떎." }, { status: 404 });
    }

    const { data: memberships } = await serviceClient
      .from("cohort_members")
      .select("user_id")
      .eq("room_id", roomId)
      .eq("is_active", true)
      .in("user_id", [user.id, targetUserId]);

    const memberIds = new Set((memberships ?? []).map((m) => m.user_id as string));
    if (!memberIds.has(user.id) || !memberIds.has(targetUserId)) {
      return NextResponse.json(
        { error: "같은 동기방 멤버만 볼 수 있습니다." },
        { status: 403 }
      );
    }

    const { data: profile, error: profileError } = await serviceClient
      .from("community_profiles")
      .select(
        "user_id:community_public_id, nickname, avatar_url, rank, wedding_year, wedding_month, wedding_completed, post_count, comment_count, total_upvotes_received, created_at"
      )
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (profileError) {
      console.error(
        "[community/profile public] profile error",
        safeErrorDiagnostic(profileError),
      );
      return NextResponse.json({ error: "프로필을 불러오지 못했습니다." }, { status: 500 });
    }

    if (!profile) {
      return NextResponse.json({ error: "프로필을 찾을 수 없습니다." }, { status: 404 });
    }

    const { data: posts } = await serviceClient
      .from("community_posts")
      .select("id, title, category, created_at, upvote_count, comment_count")
      .eq("author_id", targetUserId)
      .eq("visibility", "public")
      .eq("under_review", false)
      .order("created_at", { ascending: false })
      .limit(10);

    return NextResponse.json(
      {
        profile,
        posts: posts ?? [],
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error(
      "[community/profile public] unexpected",
      safeErrorDiagnostic(err),
    );
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
