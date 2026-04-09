// 고객용 계약서 조회
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ContractRow, contractRowToModel } from "@/types/contract.types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // RLS가 couple_id 기반으로 접근을 제어
    const { data, error } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    }

    // viewed 상태 업데이트 (sent → viewed)
    if (data.status === "sent") {
      await supabase
        .from("contracts")
        .update({
          status: "viewed",
          viewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      data.status = "viewed";
      data.viewed_at = new Date().toISOString();
    }

    const contract = contractRowToModel(data as ContractRow);

    // 업체 정보 조인
    const { data: vendor } = await supabase
      .from("vendors")
      .select("name")
      .eq("id", contract.vendorId)
      .single();

    contract.vendorName = vendor?.name;

    // 예약 정보 조인
    const { data: booking } = await supabase
      .from("vendor_bookings")
      .select("booking_date, product_id")
      .eq("id", contract.bookingId)
      .single();

    if (booking) {
      contract.bookingDate = booking.booking_date;
      if (booking.product_id) {
        const { data: product } = await supabase
          .from("vendor_products")
          .select("name")
          .eq("id", booking.product_id)
          .single();
        contract.productName = product?.name;
      }
    }

    return NextResponse.json({ contract });
  } catch (err) {
    console.error("계약 조회 에러:", err);
    return NextResponse.json({ error: "계약 조회에 실패했습니다." }, { status: 500 });
  }
}
