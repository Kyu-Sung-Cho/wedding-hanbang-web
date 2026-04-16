import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { bookingRowToBooking } from "@/lib/utils/vendorMapper";

// 수동 예약 등록
export async function POST(req: Request) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { data: vendor } = await supabase
      .from("vendors")
      .select("id")
      .eq("owner_id", user.id)
      .single();

    if (!vendor) {
      return NextResponse.json({ error: "등록된 업체가 없습니다." }, { status: 404 });
    }

    const body = await req.json();
    const { bookingDate, bookingTime, productId, brideName, groomName, contactPhone, amount, memo } = body;

    if (!bookingDate || !bookingTime) {
      return NextResponse.json({ error: "예약 날짜와 시간은 필수입니다." }, { status: 400 });
    }

    const { data: row, error } = await supabase
      .from("vendor_bookings")
      .insert({
        vendor_id: vendor.id,
        couple_id: null,
        product_id: productId || null,
        booking_date: bookingDate,
        booking_time: bookingTime,
        booking_type: "manual",
        bride_name: brideName || null,
        groom_name: groomName || null,
        contact_phone: contactPhone || null,
        status: "confirmed",
        amount: amount || 0,
        is_paid: false,
        memo: memo || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Create booking error:", error);
      return NextResponse.json({ error: "예약 등록에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ booking: bookingRowToBooking(row) });
  } catch (err) {
    console.error("Vendor create booking error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { data: vendor } = await supabase
      .from("vendors")
      .select("id")
      .eq("owner_id", user.id)
      .single();

    if (!vendor) {
      return NextResponse.json({ error: "등록된 업체가 없습니다." }, { status: 404 });
    }

    const { data: bookingRows } = await supabase
      .from("vendor_bookings")
      .select("*")
      .eq("vendor_id", vendor.id)
      .order("booking_date", { ascending: false });

    const bookings = (bookingRows ?? []).map(bookingRowToBooking);

    return NextResponse.json({ bookings });
  } catch (err) {
    console.error("Vendor bookings error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
