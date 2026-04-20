import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { CohortEventType } from "@/types/community.types";

// 멤버 확인 + 없으면 자동 가입 (메시지 API와 동일 패턴)
async function ensureMember(
  supabase: Awaited<ReturnType<typeof createClientFromRequest>>,
  roomId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("cohort_members")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return true;
  const { error } = await supabase
    .from("cohort_members")
    .upsert({ room_id: roomId, user_id: userId, is_active: true }, { onConflict: "room_id,user_id" });
  return !error;
}

// GET: 최근 30개 타임라인 이벤트
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const member = await ensureMember(supabase, roomId, user.id);
    if (!member) {
      return NextResponse.json(
        { error: "이 동기방 멤버가 아닙니다." },
        { status: 403 }
      );
    }

    const { data, error } = await supabase
      .from("cohort_timeline_events")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("Timeline GET error:", error);
      return NextResponse.json(
        { error: "타임라인을 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    const events = data ?? [];

    // 유저 프로필 별도 조회 (FK 조인 문제 회피)
    const userIds = [...new Set(events.map((e) => e.user_id))];
    let userMap: Record<string, { user_id: string; nickname: string; avatar_url: string | null; rank: string }> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("community_profiles")
        .select("user_id, nickname, avatar_url, rank")
        .in("user_id", userIds);
      if (profiles) {
        userMap = Object.fromEntries(profiles.map((p) => [p.user_id, p]));
      }
    }

    const eventsWithUser = events.map((e) => ({
      ...e,
      user: userMap[e.user_id] ?? { user_id: e.user_id, nickname: "익명", avatar_url: null, rank: "sprout" },
    }));

    return NextResponse.json({ events: eventsWithUser });
  } catch (err) {
    console.error("Timeline GET error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// POST: 이벤트 생성
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const member = await ensureMember(supabase, roomId, user.id);
    if (!member) {
      return NextResponse.json(
        { error: "이 동기방 멤버가 아닙니다." },
        { status: 403 }
      );
    }

    const body = (await req.json()) as {
      event_type: CohortEventType;
      description?: string;
    };

    if (!body.event_type) {
      return NextResponse.json(
        { error: "이벤트 타입을 지정해주세요." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("cohort_timeline_events")
      .insert({
        room_id: roomId,
        user_id: user.id,
        event_type: body.event_type,
        description: body.description?.slice(0, 500) ?? null,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Timeline insert error:", error);
      return NextResponse.json(
        { error: "이벤트 등록에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ event: data }, { status: 201 });
  } catch (err) {
    console.error("Timeline POST error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
