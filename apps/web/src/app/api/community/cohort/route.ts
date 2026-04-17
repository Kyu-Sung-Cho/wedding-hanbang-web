import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// GET: 현재 유저의 동기방 + 최근 멤버 프리뷰
export async function GET(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ room: null }, { status: 200 });
    }

    // 내 멤버십 찾기
    const { data: membership } = await supabase
      .from("cohort_members")
      .select("room_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ room: null }, { status: 200 });
    }

    const { data: room, error: roomErr } = await supabase
      .from("cohort_rooms")
      .select("*")
      .eq("id", membership.room_id)
      .single();

    if (roomErr || !room) {
      return NextResponse.json({ room: null }, { status: 200 });
    }

    // 최근 멤버 프리뷰 (최대 8명)
    const { data: memberRows } = await supabase
      .from("cohort_members")
      .select("id, user_id, joined_at")
      .eq("room_id", room.id)
      .order("joined_at", { ascending: false })
      .limit(8);

    // 멤버 프로필 별도 조회
    const memberUserIds = (memberRows ?? []).map((m) => m.user_id);
    let memberProfiles: Record<string, { user_id: string; nickname: string; avatar_url: string | null; rank: string }> = {};
    if (memberUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from("community_profiles")
        .select("user_id, nickname, avatar_url, rank")
        .in("user_id", memberUserIds);
      if (profiles) {
        memberProfiles = Object.fromEntries(profiles.map((p) => [p.user_id, p]));
      }
    }
    const members = (memberRows ?? []).map((m) => ({
      ...m,
      profile: memberProfiles[m.user_id] ?? null,
    }));

    // 최근 메시지 프리뷰 1건
    const { data: lastMsg } = await supabase
      .from("cohort_messages")
      .select("id, content, created_at, author_id")
      .eq("room_id", room.id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      room,
      recentMembers: members ?? [],
      lastMessage: lastMsg?.content ?? null,
    });
  } catch (err) {
    console.error("Cohort GET error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// POST: 동기방 배정
export async function POST(req: NextRequest) {
  try {
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

    const body = (await req.json()) as { year: number; month: number };
    const { year, month } = body;

    if (
      !year ||
      !month ||
      month < 1 ||
      month > 12 ||
      year < 2020 ||
      year > 2100
    ) {
      return NextResponse.json(
        { error: "올바른 연/월을 입력해주세요." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("community_assign_cohort", {
      p_user_id: user.id,
      p_year: year,
      p_month: month,
    });

    if (error) {
      console.error("assign_cohort RPC error:", error);
      return NextResponse.json(
        { error: "동기방 배정에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ room_id: data });
  } catch (err) {
    console.error("Cohort POST error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
