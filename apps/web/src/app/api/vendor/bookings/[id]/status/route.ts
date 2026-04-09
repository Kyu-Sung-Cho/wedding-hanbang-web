// 업체: 예약 상태 전환 API
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 허용되는 상태 전환
const VALID_TRANSITIONS: Record<string, string[]> = {
  deposit_paid: ["in_service"],
  in_service: ["service_completed"],
  service_completed: ["completed"],
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // 업체 확인
    const { data: vendor } = await supabase
      .from("vendors")
      .select("id")
      .eq("owner_id", user.id)
      .single();

    if (!vendor) {
      return NextResponse.json({ error: "업체 정보를 찾을 수 없습니다." }, { status: 404 });
    }

    const body = await req.json();
    const { status } = body;

    if (!status) {
      return NextResponse.json({ error: "변경할 상태를 지정해주세요." }, { status: 400 });
    }

    // 예약 확인
    const { data: booking } = await supabase
      .from("vendor_bookings")
      .select("id, status, vendor_id")
      .eq("id", id)
      .eq("vendor_id", vendor.id)
      .single();

    if (!booking) {
      return NextResponse.json({ error: "예약을 찾을 수 없습니다." }, { status: 404 });
    }

    // 상태 전환 검증
    const allowedNext = VALID_TRANSITIONS[booking.status];
    if (!allowedNext || !allowedNext.includes(status)) {
      return NextResponse.json(
        { error: `현재 상태(${booking.status})에서 ${status}로 변경할 수 없습니다.` },
        { status: 400 }
      );
    }

    // 상태 업데이트
    const { error } = await supabase
      .from("vendor_bookings")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({
      message: "예약 상태가 변경되었습니다.",
      status,
    });
  } catch (err) {
    console.error("예약 상태 변경 에러:", err);
    return NextResponse.json({ error: "상태 변경에 실패했습니다." }, { status: 500 });
  }
}
