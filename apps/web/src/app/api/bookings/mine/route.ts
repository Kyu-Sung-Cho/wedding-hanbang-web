import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { bookingRowToBooking } from "@/lib/utils/vendorMapper";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      if (hasSignedDemoSessionFromCookieHeader(req.headers.get("cookie"))) {
        return NextResponse.json({ bookings: [] });
      }
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // 프로필에서 couple_id 가져오기
    const { data: profile } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile?.couple_id) {
      return NextResponse.json({ bookings: [] });
    }

    const { data: bookingRows } = await supabase
      .from("vendor_bookings")
      .select("*")
      .eq("couple_id", profile.couple_id)
      .order("booking_date", { ascending: false });

    // 업체명 가져오기
    const vendorIds = [...new Set((bookingRows ?? []).map((b) => b.vendor_id))];
    const { data: vendors } = vendorIds.length > 0
      ? await supabase.from("vendors").select("id, name").in("id", vendorIds)
      : { data: [] };

    const vendorMap = Object.fromEntries((vendors ?? []).map((v) => [v.id, v.name]));

    // 계약 정보 조인
    const bookingIds = (bookingRows ?? []).map((b) => b.id);
    const { data: contracts } = bookingIds.length > 0
      ? await supabase
          .from("contracts")
          .select("id, booking_id, status, contract_amount, deposit_amount")
          .in("booking_id", bookingIds)
          .not("status", "eq", "cancelled")
      : { data: [] };

    const contractMap = new Map((contracts ?? []).map((c) => [c.booking_id, c]));

    // 결제 정보 조인
    const { data: payments } = bookingIds.length > 0
      ? await supabase
          .from("payments")
          .select("id, booking_id, status, amount, payment_type")
          .in("booking_id", bookingIds)
          .eq("payment_type", "deposit")
          .eq("status", "paid")
      : { data: [] };

    const paymentMap = new Map((payments ?? []).map((p) => [p.booking_id, p]));

    const bookings = (bookingRows ?? []).map((row) => {
      const contract = contractMap.get(row.id);
      const payment = paymentMap.get(row.id);
      return {
        ...bookingRowToBooking(row),
        vendorName: vendorMap[row.vendor_id] ?? "",
        contract: contract ? {
          id: contract.id,
          status: contract.status,
          contractAmount: contract.contract_amount,
          depositAmount: contract.deposit_amount,
        } : null,
        payment: payment ? {
          id: payment.id,
          amount: payment.amount,
        } : null,
      };
    });

    return NextResponse.json({ bookings });
  } catch (err) {
    console.error("My bookings error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
