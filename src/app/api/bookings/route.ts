import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const { vendorId, productId, date, time, brideName, groomName, contactPhone, memo } = body;

    if (!vendorId || !date || !time) {
      return NextResponse.json({ error: "업체, 날짜, 시간은 필수입니다." }, { status: 400 });
    }

    // 프로필에서 couple_id 가져오기
    const { data: profile } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    // 상품 금액 조회
    let amount = 0;
    if (productId) {
      const { data: product } = await supabase
        .from("vendor_products")
        .select("price, discount_price")
        .eq("id", productId)
        .single();
      if (product) {
        amount = product.discount_price ?? product.price;
      }
    }

    const bookingDate = new Date(date);
    const dayOfWeek = bookingDate.getDay();

    const { data: booking, error } = await supabase
      .from("vendor_bookings")
      .insert({
        vendor_id: vendorId,
        product_id: productId || null,
        couple_id: profile?.couple_id || null,
        booking_date: date,
        booking_time: time,
        booking_type: "consultation",
        bride_name: brideName || "",
        groom_name: groomName || "",
        contact_phone: contactPhone || "",
        status: "pending",
        amount,
        is_paid: false,
        memo: memo || "",
      })
      .select()
      .single();

    if (error) {
      console.error("Booking create error:", error);
      return NextResponse.json({ error: "예약 생성에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ booking, message: "예약이 접수되었습니다." });
  } catch (err) {
    console.error("Booking create error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
