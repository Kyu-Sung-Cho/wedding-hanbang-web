import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 웨딩 여정 업데이트 (예산, 날짜, progress)
export async function PATCH(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const admin = getAdminClient();

    // 프로필에서 couple_id 가져오기
    const { data: profile } = await admin
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile?.couple_id) {
      return NextResponse.json({ error: "커플 정보가 없습니다." }, { status: 404 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.wedding_date !== undefined) updates.wedding_date = body.wedding_date;
    if (body.total_budget !== undefined) updates.total_budget = body.total_budget;
    if (body.venue !== undefined) updates.venue = body.venue;
    if (body.progress !== undefined) updates.progress = body.progress;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "수정할 항목이 없습니다." }, { status: 400 });
    }

    const { data: journey, error } = await admin
      .from("wedding_journeys")
      .update(updates)
      .eq("couple_id", profile.couple_id)
      .select()
      .single();

    if (error) {
      console.error("여정 업데이트 에러:", error);
      return NextResponse.json({ error: "업데이트에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ journey });
  } catch (err) {
    console.error("Journey API 에러:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
