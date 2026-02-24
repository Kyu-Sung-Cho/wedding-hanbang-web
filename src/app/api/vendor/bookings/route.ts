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
