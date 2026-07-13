import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/utils/requestValidation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const roomId = new URL(req.url).searchParams.get("room_id");

    if (!isUuid(userId) || !isUuid(roomId)) {
      return NextResponse.json({ error: "잘못된 프로필 요청입니다." }, { status: 400 });
    }

    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:profile-card:read", req, user.id),
      { maxRequests: 60, windowMs: 60 * 1000 },
      user.id
    );
    if (limited) return limited;

    const serviceClient = getServiceClient();

    const { data: memberships, error: membershipError } = await serviceClient
      .from("cohort_members")
      .select("user_id")
      .eq("room_id", roomId)
      .eq("is_active", true)
      .in("user_id", [user.id, userId]);

    if (membershipError) {
      console.error("[community/profile public] membership error:", membershipError);
      return NextResponse.json({ error: "동기방 멤버를 확인하지 못했습니다." }, { status: 500 });
    }

    const memberIds = new Set((memberships ?? []).map((m) => m.user_id as string));
    if (!memberIds.has(user.id) || !memberIds.has(userId)) {
      return NextResponse.json(
        { error: "같은 동기방 멤버만 볼 수 있습니다." },
        { status: 403 }
      );
    }

    const { data: profile, error: profileError } = await serviceClient
      .from("community_profiles")
      .select("user_id, nickname, avatar_url, badge, rank")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("[community/profile public] profile error:", profileError);
      return NextResponse.json({ error: "프로필을 불러오지 못했습니다." }, { status: 500 });
    }

    if (!profile) {
      return NextResponse.json({ error: "프로필을 찾을 수 없습니다." }, { status: 404 });
    }

    const { data: posts, error: postsError } = await serviceClient
      .from("community_posts")
      .select("id, title, category, created_at, upvote_count, comment_count")
      .eq("author_id", userId)
      .eq("visibility", "public")
      .eq("under_review", false)
      .order("created_at", { ascending: false })
      .limit(10);

    if (postsError) {
      console.error("[community/profile public] posts error:", postsError);
      return NextResponse.json({ error: "공개 글을 불러오지 못했습니다." }, { status: 500 });
    }

    return NextResponse.json({
      profile,
      posts: posts ?? [],
    });
  } catch (err) {
    console.error("[community/profile public] unexpected:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
