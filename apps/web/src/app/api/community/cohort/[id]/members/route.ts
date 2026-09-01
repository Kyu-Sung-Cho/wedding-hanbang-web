import { NextRequest, NextResponse } from "next/server";
import { log } from "@/utils/log";

import { createClientFromRequest } from "@/lib/supabase/server";
import { isUuid } from "@/utils/requestValidation";

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
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: roomId } = await params;
    if (!isUuid(roomId)) {
      return json({ error: "올바르지 않은 동기방 ID입니다." }, { status: 400 });
    }

    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("cohort_members")
      .select("id")
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (membershipError) {
      return json(
        { error: "동기방 접근 권한을 확인하지 못했어요." },
        { status: 503 },
      );
    }
    if (!membership) {
      return json(
        { error: "해당 동기방의 활성 멤버만 멤버 목록을 볼 수 있어요." },
        { status: 403 },
      );
    }

    const { data: memberRows, error: membersError } = await supabase
      .from("cohort_members")
      .select("user_id, joined_at")
      .eq("room_id", roomId)
      .eq("is_active", true)
      .order("joined_at", { ascending: true })
      .limit(200);

    if (membersError) {
      return json(
        { error: "동기방 멤버를 불러오지 못했어요." },
        { status: 503 },
      );
    }

    const userIds = (memberRows ?? [])
      .map((member) => member.user_id as string)
      .filter(isUuid);
    const { data: profileRows, error: profilesError } = userIds.length > 0
      ? await supabase
          .from("community_public_profiles")
          .select("user_id, nickname, rank")
          .in("user_id", userIds)
      : { data: [], error: null };

    if (profilesError) {
      return json(
        { error: "동기방 멤버를 불러오지 못했어요." },
        { status: 503 },
      );
    }

    const profileByUserId = new Map(
      (profileRows ?? []).map((profile) => [profile.user_id as string, profile]),
    );
    const members = userIds.flatMap((userId) => {
      const profile = profileByUserId.get(userId);
      if (!profile) return [];
      return [{
        user_id: userId,
        profile: {
          nickname: (profile.nickname as string | null) || "익명",
          rank: (profile.rank as string | null) || "sprout",
        },
      }];
    });

    return json({ members });
  } catch (error) {
    log.error("api/community/cohort/[id]/members", error);
    console.error("Cohort members GET error:", error);
    return json(
      { error: "동기방 멤버를 불러오지 못했어요." },
      { status: 503 },
    );
  }
}
