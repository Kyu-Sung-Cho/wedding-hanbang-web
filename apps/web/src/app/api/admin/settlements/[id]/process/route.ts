// 관리자 정산 실행
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SettlementRow, settlementRowToModel } from "@/types/contract.types";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // 관리자 확인
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!profile?.is_admin) {
      return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    }

    const body = await req.json();
    const { memo } = body;

    // 정산 확인
    const { data: settlement } = await supabase
      .from("settlements")
      .select("*")
      .eq("id", id)
      .single();

    if (!settlement) {
      return NextResponse.json({ error: "정산을 찾을 수 없습니다." }, { status: 404 });
    }

    if (settlement.status !== "pending" && settlement.status !== "processing") {
      return NextResponse.json({ error: "처리할 수 없는 상태입니다." }, { status: 400 });
    }

    // 업체 계좌 정보 확인
    const { data: vendor } = await supabase
      .from("vendors")
      .select("bank_name, account_number, account_holder")
      .eq("id", settlement.vendor_id)
      .single();

    // 정산 실행 (상태 업데이트)
    const { data: updated, error } = await supabase
      .from("settlements")
      .update({
        status: "completed",
        settled_at: new Date().toISOString(),
        bank_name: vendor?.bank_name || null,
        account_number: vendor?.account_number || null,
        account_holder: vendor?.account_holder || null,
        memo: memo || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // 예약 상태 업데이트
    await supabase
      .from("vendor_bookings")
      .update({ status: "settled" })
      .eq("id", settlement.booking_id);

    return NextResponse.json({
      settlement: settlementRowToModel(updated as SettlementRow),
      message: "정산이 완료되었습니다.",
    });
  } catch (err) {
    console.error("정산 실행 에러:", err);
    return NextResponse.json({ error: "정산 처리에 실패했습니다." }, { status: 500 });
  }
}
