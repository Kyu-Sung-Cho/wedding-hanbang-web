import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // 예약 조회 → vendor 소유권 검증
    const { data: booking } = await supabase
      .from("vendor_bookings")
      .select("vendor_id")
      .eq("id", id)
      .single();

    if (!booking) {
      return NextResponse.json({ error: "예약을 찾을 수 없습니다." }, { status: 404 });
    }

    const { data: vendor } = await supabase
      .from("vendors")
      .select("id")
      .eq("id", booking.vendor_id)
      .eq("owner_id", user.id)
      .single();

    if (!vendor) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    const { status, memo } = await req.json();

    if (!["confirmed", "cancelled", "completed"].includes(status)) {
      return NextResponse.json({ error: "유효하지 않은 상태입니다." }, { status: 400 });
    }

    const updateData: Record<string, unknown> = { status };
    if (memo !== undefined) updateData.memo = memo;

    const { data, error } = await supabase
      .from("vendor_bookings")
      .update(updateData)
      .eq("id", id)
      .eq("vendor_id", vendor.id)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "예약 상태 변경에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ booking: data });
  } catch (err) {
    console.error("Booking status update error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
