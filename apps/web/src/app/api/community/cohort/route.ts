import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import { cohortRoomName, monthToQuarter, quarterToMonth } from "@/utils/quarter";

function getServiceClient() {
  return createAdminClient();
}

async function refreshMemberCount(
  supabase: ReturnType<typeof getServiceClient>,
  roomId: string
) {
  const { count } = await supabase
    .from("cohort_members")
    .select("id", { count: "exact", head: true })
    .eq("room_id", roomId)
    .eq("is_active", true);

  await supabase
    .from("cohort_rooms")
    .update({ member_count: count ?? 0 })
    .eq("id", roomId);
}

export async function GET(request: Request) {
  try {
    const authClient = await createClientFromRequest(request);
    const {
      data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ room: null }, { status: 200 });
    }

    const supabase = getServiceClient();

    const { data: memberships } = await supabase
      .from("cohort_members")
      .select("room_id, joined_at")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("joined_at", { ascending: false });

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({ room: null }, { status: 200 });
    }

    const roomIds = [...new Set(memberships.map((m) => m.room_id as string))];
    const { data: rooms } = await supabase
      .from("cohort_rooms")
      .select("*")
      .in("id", roomIds)
      .eq("is_active", true);

    if (!rooms || rooms.length === 0) {
      return NextResponse.json({ room: null }, { status: 200 });
    }

    const { data: profile } = await supabase
      .from("community_profiles")
      .select("wedding_year, wedding_month")
      .eq("user_id", user.id)
      .maybeSingle();

    const desiredMonth = profile?.wedding_month
      ? quarterToMonth(monthToQuarter(profile.wedding_month as number))
      : null;

    const selectedRoom =
      profile?.wedding_year && desiredMonth
        ? rooms.find(
            (room) =>
              room.year === profile.wedding_year && room.month === desiredMonth
          ) ?? rooms[0]
        : rooms[0];

    const staleRoomIds = roomIds.filter((id) => id !== selectedRoom.id);
    if (staleRoomIds.length > 0) {
      await supabase
        .from("cohort_members")
        .update({ is_active: false })
        .eq("user_id", user.id)
        .in("room_id", staleRoomIds);

      await Promise.all(staleRoomIds.map((roomId) => refreshMemberCount(supabase, roomId)));
    }

    const normalizedRoom = {
      ...selectedRoom,
      name: cohortRoomName(
        selectedRoom.year as number,
        selectedRoom.month as number,
        selectedRoom.room_number as number
      ),
    };

    const { data: memberRows } = await supabase
      .from("cohort_members")
      .select("id, user_id, joined_at")
      .eq("room_id", selectedRoom.id)
      .eq("is_active", true)
      .order("joined_at", { ascending: false })
      .limit(8);

    const memberUserIds = (memberRows ?? []).map((m) => m.user_id as string);
    let memberProfiles: Record<
      string,
      { user_id: string; nickname: string; avatar_url: string | null; rank: string }
    > = {};

    if (memberUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from("community_profiles")
        .select("user_id, nickname, avatar_url, rank")
        .in("user_id", memberUserIds);

      if (profiles) {
        memberProfiles = Object.fromEntries(
          profiles.map((profileRow) => [profileRow.user_id as string, profileRow])
        );
      }
    }

    const members = (memberRows ?? []).map((member) => ({
      ...member,
      profile: memberProfiles[member.user_id as string] ?? null,
    }));

    const { data: lastMsg } = await supabase
      .from("cohort_messages")
      .select("id, content, created_at, author_id")
      .eq("room_id", selectedRoom.id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      room: normalizedRoom,
      recentMembers: members,
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

export async function POST(req: NextRequest) {
  try {
    const authClient = await createClientFromRequest(req);
    const {
      data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const writeAccess = await checkCommunityWriteAccess(authClient, user.id);
    if (!writeAccess.allowed) {
      return NextResponse.json(
        { error: writeAccess.message, code: writeAccess.code },
        { status: writeAccess.status }
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
        { error: "올바른 결혼 시기를 입력해주세요." },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();
    const quarter = monthToQuarter(month);
    const normalizedMonth = quarterToMonth(quarter);

    const { data: staleMemberships } = await supabase
      .from("cohort_members")
      .select("room_id")
      .eq("user_id", user.id)
      .eq("is_active", true);

    await supabase
      .from("cohort_members")
      .update({ is_active: false })
      .eq("user_id", user.id)
      .eq("is_active", true);

    const { data: availableRoom } = await supabase
      .from("cohort_rooms")
      .select("*")
      .eq("year", year)
      .eq("month", normalizedMonth)
      .eq("is_active", true)
      .lt("member_count", 30)
      .order("room_number", { ascending: true })
      .limit(1)
      .maybeSingle();

    let room = availableRoom;

    if (!room) {
      const { data: existingRooms } = await supabase
        .from("cohort_rooms")
        .select("room_number")
        .eq("year", year)
        .eq("month", normalizedMonth)
        .order("room_number", { ascending: false })
        .limit(1);

      const roomNumber = ((existingRooms?.[0]?.room_number as number | undefined) ?? 0) + 1;
      const { data: newRoom, error: createError } = await supabase
        .from("cohort_rooms")
        .insert({
          year,
          month: normalizedMonth,
          room_number: roomNumber,
          name: cohortRoomName(year, normalizedMonth, roomNumber),
          is_active: true,
          member_count: 0,
          message_count: 0,
        })
        .select("*")
        .single();

      if (createError || !newRoom) {
        console.error("Create cohort room error:", createError);
        return NextResponse.json(
          { error: "동기방 생성에 실패했습니다." },
          { status: 500 }
        );
      }
      room = newRoom;
    } else if (room.name !== cohortRoomName(year, normalizedMonth, room.room_number as number)) {
      await supabase
        .from("cohort_rooms")
        .update({ name: cohortRoomName(year, normalizedMonth, room.room_number as number) })
        .eq("id", room.id);
    }

    const { error: memberError } = await supabase
      .from("cohort_members")
      .upsert(
        { room_id: room.id, user_id: user.id, is_active: true },
        { onConflict: "room_id,user_id" }
      );

    if (memberError) {
      console.error("Cohort member upsert error:", memberError);
      return NextResponse.json(
        { error: "동기방 입장에 실패했습니다." },
        { status: 500 }
      );
    }

    await supabase
      .from("community_profiles")
      .update({ wedding_year: year, wedding_month: normalizedMonth })
      .eq("user_id", user.id);

    const affectedRoomIds = [
      ...new Set([
        room.id as string,
        ...((staleMemberships ?? []).map((m) => m.room_id as string)),
      ]),
    ];
    await Promise.all(affectedRoomIds.map((roomId) => refreshMemberCount(supabase, roomId)));

    return NextResponse.json({
      room_id: room.id,
      year,
      quarter,
      month: normalizedMonth,
    });
  } catch (err) {
    console.error("Cohort POST error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
