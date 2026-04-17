import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST: 결혼 연/월 업데이트 + 동기방 자동 배정 (RPC 없이 직접 처리)
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

    const serviceClient = getServiceClient();

    // 프로필 업데이트
    await serviceClient
      .from("community_profiles")
      .update({ wedding_year: year, wedding_month: month })
      .eq("user_id", user.id);

    // 분기 계산 (1→Q1, 4→Q2, 7→Q3, 10→Q4)
    const quarter = Math.ceil(month / 3);
    const quarterStartMonth = (quarter - 1) * 3 + 1;
    const roomName = `${year}년 ${quarter}분기 동기방`;

    // 이미 다른 동기방 멤버인지 확인 → 있으면 비활성화
    await serviceClient
      .from("cohort_members")
      .update({ is_active: false })
      .eq("user_id", user.id)
      .eq("is_active", true);

    // 해당 분기 방 찾기
    let { data: room } = await serviceClient
      .from("cohort_rooms")
      .select("id")
      .eq("year", year)
      .eq("month", quarterStartMonth)
      .eq("is_active", true)
      .maybeSingle();

    // 없으면 방 만들기
    if (!room) {
      const { data: newRoom, error: createErr } = await serviceClient
        .from("cohort_rooms")
        .insert({
          year,
          month: quarterStartMonth,
          room_number: 1,
          name: roomName,
          is_active: true,
          member_count: 0,
          message_count: 0,
        })
        .select("id")
        .single();

      if (createErr) {
        console.error("Create room error:", createErr);
        return NextResponse.json(
          { error: "동기방 생성에 실패했습니다." },
          { status: 500 }
        );
      }
      room = newRoom;
    }

    // 멤버 등록 (upsert)
    const { error: memberErr } = await serviceClient
      .from("cohort_members")
      .upsert(
        { room_id: room!.id, user_id: user.id, is_active: true },
        { onConflict: "room_id,user_id" }
      );

    if (memberErr) {
      console.error("Member upsert error:", memberErr);
      return NextResponse.json(
        { error: "동기방 입장에 실패했습니다." },
        { status: 500 }
      );
    }

    // member_count 업데이트
    const { count } = await serviceClient
      .from("cohort_members")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room!.id)
      .eq("is_active", true);

    await serviceClient
      .from("cohort_rooms")
      .update({ member_count: count ?? 1 })
      .eq("id", room!.id);

    return NextResponse.json({ room_id: room!.id });
  } catch (err) {
    console.error("wedding-date POST error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
