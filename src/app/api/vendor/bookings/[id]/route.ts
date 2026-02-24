import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
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
