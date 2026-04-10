import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// POST: 결혼 연/월 업데이트 + 동기방 자동 배정
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

    // 프로필 업데이트 (존재하지 않으면 upsert)
    const { error: profileErr } = await supabase
      .from("community_profiles")
      .update({ wedding_year: year, wedding_month: month })
      .eq("user_id", user.id);

    if (profileErr) {
      console.error("Profile update error:", profileErr);
    }

    // 동기방 배정
    const { data: roomId, error: rpcErr } = await supabase.rpc(
      "community_assign_cohort",
      {
        p_user_id: user.id,
        p_year: year,
        p_month: month,
      }
    );

    if (rpcErr) {
      console.error("assign_cohort RPC error:", rpcErr);
      return NextResponse.json(
        { error: "동기방 배정에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ room_id: roomId });
  } catch (err) {
    console.error("wedding-date POST error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
