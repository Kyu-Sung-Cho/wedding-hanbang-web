import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import type { CohortEventType } from "@/types/community.types";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

async function ensureActiveMember(
  supabase: Awaited<ReturnType<typeof createClientFromRequest>>,
  roomId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("cohort_members")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  return !!data;
}

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
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const member = await ensureActiveMember(supabase, roomId, user.id);
    if (!member) {
      return NextResponse.json(
        { error: "해당 동기방의 활성 멤버만 이용할 수 있습니다." },
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
      console.error("Events GET error:", error);
      return NextResponse.json(
        { error: "이벤트를 불러오지 못했습니다." },
        { status: 500 }
      );
    }

    const events = data ?? [];
    const userIds = [...new Set(events.map((event) => event.user_id as string))];
    let userMap: Record<
      string,
      { user_id: string; nickname: string; avatar_url: string | null; rank: string }
    > = {};

    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("community_profiles")
        .select("user_id, nickname, avatar_url, rank")
        .in("user_id", userIds);

      if (profiles) {
        userMap = Object.fromEntries(
          profiles.map((profile) => [profile.user_id as string, profile])
        );
      }
    }

    const eventsWithUser = events.map((event) => ({
      ...event,
      user: userMap[event.user_id as string] ?? {
        user_id: event.user_id,
        nickname: "익명",
        avatar_url: null,
        rank: "sprout",
      },
    }));

    return NextResponse.json({ events: eventsWithUser });
  } catch (err) {
    console.error("Events GET error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const { id: roomId } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const writeAccess = await checkCommunityWriteAccess(supabase, user.id);
    if (!writeAccess.allowed) {
      return NextResponse.json(
        { error: writeAccess.message, code: writeAccess.code },
        { status: writeAccess.status }
      );
    }

    const member = await ensureActiveMember(supabase, roomId, user.id);
    if (!member) {
      return NextResponse.json(
        { error: "해당 동기방의 활성 멤버만 이용할 수 있습니다." },
        { status: 403 }
      );
    }

    const body = (await req.json()) as {
      event_type: CohortEventType;
      description?: string;
    };

    if (!body.event_type) {
      return NextResponse.json(
        { error: "이벤트 유형을 선택해주세요." },
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
      console.error("Event insert error:", error);
      return NextResponse.json(
        { error: "이벤트 등록에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ event: data }, { status: 201 });
  } catch (err) {
    console.error("Event POST error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
