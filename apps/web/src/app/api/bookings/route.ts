import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { recordDecision } from "@/lib/memory/record-decision";

export async function POST(req: Request) {
  try {
    const supabase = await createClientFromRequest(req);
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
        .eq("vendor_id", vendorId)
        .maybeSingle();
      if (product) {
        amount = product.discount_price ?? product.price;
      }
    }

    // Atomic booking via Postgres RPC — TOCTOU 방어.
    // 이전엔 capacity COUNT → INSERT 를 client 호출 2단계로 수행해 동시 호출 시
    // 둘 다 capacity 통과 후 둘 다 INSERT → max_bookings 초과. RPC 가 timeslot row
    // FOR UPDATE 락 + COUNT + INSERT 단일 트랜잭션 → 직렬화.
    // RPC는 service_role 전용(20260611150000) — couple_id는 위에서 본인 프로필로 검증됨.
    const admin = createAdminClient();
    const { data: bookingId, error: rpcError } = await admin.rpc("create_booking_atomic", {
      p_vendor_id: vendorId,
      p_couple_id: profile?.couple_id || null,
      p_booking_date: date,
      p_booking_time: time,
      p_product_id: productId || null,
      p_staff_id: staffId || null,
      p_booking_type: "consultation",
      p_bride_name: brideName || "",
      p_groom_name: groomName || "",
      p_contact_phone: contactPhone || "",
      p_amount: amount,
      p_memo: memo || "",
    });

    if (rpcError) {
      const msg = rpcError.message || "";
      if (msg.includes("slot_unavailable")) {
        return NextResponse.json({ error: "해당 시간은 예약이 불가능합니다." }, { status: 409 });
      }
      if (msg.includes("slot_full")) {
        return NextResponse.json({ error: "해당 시간은 예약이 마감되었습니다." }, { status: 409 });
      }
      if (msg.includes("invalid_product_vendor")) {
        return NextResponse.json({ error: "선택한 상품이 이 업체의 상품이 아닙니다." }, { status: 400 });
      }
      if (msg.includes("invalid_staff_vendor")) {
        return NextResponse.json({ error: "선택한 담당자가 이 업체 소속이 아닙니다." }, { status: 400 });
      }
      console.error("Booking create RPC error:", rpcError);
      return NextResponse.json({ error: "예약 생성에 실패했습니다." }, { status: 500 });
    }

    // RPC 는 UUID 만 반환. 응답에서 full row 가 필요하므로 다시 조회.
    const { data: booking, error: fetchError } = await supabase
      .from("vendor_bookings")
      .select("*")
      .eq("id", bookingId as unknown as string)
      .single();

    if (fetchError || !booking) {
      console.error("Booking fetch after RPC error:", fetchError);
      return NextResponse.json({ error: "예약 조회에 실패했습니다." }, { status: 500 });
    }

    // D2 Hook 2: decision_nodes에 'vendor booking = booked' 기록 (fire-and-forget)
    if (booking && profile?.couple_id) {
      void (async () => {
        try {
          const { data: vendor } = await supabase
            .from("vendors")
            .select("name, category")
            .eq("id", vendorId)
            .maybeSingle();
          const v = vendor as { name: string; category: string } | null;

          await recordDecision({
            coupleId: profile.couple_id!,
            userId: user.id,
            category: v?.category ?? "vendor",
            title: `예약: ${v?.name ?? "업체"}`,
            chosenValue: {
              vendor_id: vendorId,
              vendor_name: v?.name ?? null,
              booking_date: date,
              booking_time: time,
              amount,
            },
            decisionType: "booked",
            source: "vendor_booking",
            sourceRefId: (booking as { id: string }).id,
            metadata: { hook: "bookings", booking_type: "consultation" },
          });
        } catch (err) {
          console.error("[bookings recordDecision] 실패 (무시):", err);
        }
      })();
    }

    return NextResponse.json({ booking, message: "예약이 접수되었습니다." });
  } catch (err) {
    console.error("Booking create error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
