import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { cohortRoomName, monthToQuarter, quarterToMonth } from "@/utils/quarter";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
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

export async function POST(req: NextRequest) {
  try {
    const authClient = await createClientFromRequest(req);
    const {
      data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
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

    await supabase
      .from("community_profiles")
      .update({ wedding_year: year, wedding_month: normalizedMonth })
      .eq("user_id", user.id);

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
      const { data: newRoom, error: createErr } = await supabase
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

      if (createErr || !newRoom) {
        console.error("Create room error:", createErr);
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

    const { error: memberErr } = await supabase
      .from("cohort_members")
      .upsert(
        { room_id: room.id, user_id: user.id, is_active: true },
        { onConflict: "room_id,user_id" }
      );

    if (memberErr) {
      console.error("Member upsert error:", memberErr);
      return NextResponse.json(
        { error: "동기방 입장에 실패했습니다." },
        { status: 500 }
      );
    }

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
    console.error("wedding-date POST error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
