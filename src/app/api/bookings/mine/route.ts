import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { bookingRowToBooking } from "@/lib/utils/vendorMapper";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
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

    const bookings = (bookingRows ?? []).map((row) => {
      const contract = contractMap.get(row.id);
      return {
        ...bookingRowToBooking(row),
        vendorName: vendorMap[row.vendor_id] ?? "",
        contract: contract ? {
          id: contract.id,
          status: contract.status,
          contractAmount: contract.contract_amount,
          depositAmount: contract.deposit_amount,
        } : null,
      };
    });

    return NextResponse.json({ bookings });
  } catch (err) {
    console.error("My bookings error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
