import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

function getServiceClient() {
  return createAdminClient();
}

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, Cookie",
};

function json(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    ...init,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
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
      return json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    if (!roomId) {
      return json({ error: "동기방 정보가 필요합니다." }, { status: 400 });
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
      return json(
        { error: "같은 동기방 멤버만 볼 수 있습니다." },
        { status: 403 }
      );
    }

    const { data: viewerCanSee, error: blockCheckError } =
      await serviceClient.rpc("community_viewer_can_see" as never, {
        p_viewer_user_id: user.id,
        p_other_user_id: userId,
      } as never);
    if (blockCheckError || typeof viewerCanSee !== "boolean") {
      console.error("[community/profile public] block check failed", {
        category: "viewer_control_unavailable",
        code: blockCheckError?.code ?? "invalid_result",
      });
      return json(
        { error: "프로필 접근 권한을 확인하지 못했습니다." },
        { status: 503 },
      );
    }
    if (!viewerCanSee) {
      return json({ error: "프로필을 찾을 수 없습니다." }, { status: 404 });
    }

    const { data: profile, error: profileError } = await serviceClient
      .from("community_public_profiles")
      .select("user_id, nickname, avatar_url, badge, rank")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("[community/profile public] profile error:", profileError);
      return json({ error: "프로필을 불러오지 못했습니다." }, { status: 500 });
    }

    if (!profile) {
      return json({ error: "프로필을 찾을 수 없습니다." }, { status: 404 });
    }

    const { data: posts } = await serviceClient
      .from("community_posts")
      .select("id, title, category, created_at, upvote_count, comment_count")
      .eq("author_id", userId)
      .eq("visibility", "public")
      .eq("under_review", false)
      .order("created_at", { ascending: false })
      .limit(10);

    return json({
      profile,
      posts: posts ?? [],
    });
  } catch (err) {
    console.error("[community/profile public] unexpected:", err);
    return json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
