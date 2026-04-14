import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // Rate limit: 10 bookings per hour per user
    const rlResult = checkRateLimit(
      rateLimitKey("booking:create", req, user.id),
      { maxRequests: 10, windowMs: 60 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const body = await req.json();
    const { vendorId, productId, staffId, date, time, brideName, groomName, contactPhone, memo } = body;

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
    const dayOfWeek = (bookingDate.getDay() + 6) % 7; // 0=월 ~ 6=일
    const bookingHour = parseInt(time.split(":")[0], 10);

    // 용량 검증: 타임슬롯의 max_bookings 체크
    const slotTable = productId ? "product_timeslots" : "vendor_timeslots";
    const slotFk = productId ? "product_id" : "vendor_id";
    const slotFkValue = productId || vendorId;

    const { data: slot } = await supabase
      .from(slotTable)
      .select("max_bookings, available")
      .eq(slotFk, slotFkValue)
      .eq("day", dayOfWeek)
      .eq("hour", bookingHour)
      .single();

    if (slot && !slot.available) {
      return NextResponse.json({ error: "해당 시간은 예약이 불가능합니다." }, { status: 409 });
    }

    const maxBookings = slot?.max_bookings ?? 1;

    // 해당 날짜/시간의 기존 예약 수 확인 (취소 제외)
    const { count: existingCount } = await supabase
      .from("vendor_bookings")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId)
      .eq("booking_date", date)
      .eq("booking_time", time)
      .neq("status", "cancelled");

    if ((existingCount ?? 0) >= maxBookings) {
      return NextResponse.json(
        { error: "해당 시간은 예약이 마감되었습니다." },
        { status: 409 }
      );
    }

    const { data: booking, error } = await supabase
      .from("vendor_bookings")
      .insert({
        vendor_id: vendorId,
        product_id: productId || null,
        staff_id: staffId || null,
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
