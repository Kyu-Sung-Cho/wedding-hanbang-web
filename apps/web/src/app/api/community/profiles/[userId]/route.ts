import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

function getServiceClient() {
  return createAdminClient();
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const roomId = new URL(req.url).searchParams.get("room_id");

    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    if (!roomId) {
      return NextResponse.json({ error: "동기방 정보가 필요합니다." }, { status: 400 });
    }

    const serviceClient = getServiceClient();

    const { data: memberships } = await serviceClient
      .from("cohort_members")
      .select("user_id")
      .eq("room_id", roomId)
      .eq("is_active", true)
      .in("user_id", [user.id, userId]);

    const memberIds = new Set((memberships ?? []).map((m) => m.user_id as string));
    if (!memberIds.has(user.id) || !memberIds.has(userId)) {
      return NextResponse.json(
        { error: "같은 동기방 멤버만 볼 수 있습니다." },
        { status: 403 }
      );
    }

    const { data: profile, error: profileError } = await serviceClient
      .from("community_profiles")
      .select(
        "user_id, nickname, avatar_url, rank, wedding_year, wedding_month, wedding_completed, post_count, comment_count, total_upvotes_received, created_at"
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("[community/profile public] profile error:", profileError);
      return NextResponse.json({ error: "프로필을 불러오지 못했습니다." }, { status: 500 });
    }

    if (!profile) {
      return NextResponse.json({ error: "프로필을 찾을 수 없습니다." }, { status: 404 });
    }

    const { data: posts } = await serviceClient
      .from("community_posts")
      .select("id, title, category, created_at, upvote_count, comment_count")
      .eq("author_id", userId)
      .eq("visibility", "public")
      .eq("under_review", false)
      .order("created_at", { ascending: false })
      .limit(10);

    return NextResponse.json({
      profile,
      posts: posts ?? [],
    });
  } catch (err) {
    console.error("[community/profile public] unexpected:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
