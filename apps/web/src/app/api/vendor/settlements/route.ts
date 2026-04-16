// 업체 정산 내역 조회
import { NextRequest, NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { SettlementRow, settlementRowToModel } from "@/types/contract.types";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { data: vendor } = await supabase
      .from("vendors")
      .select("id, name")
      .eq("owner_id", user.id)
      .single();

    if (!vendor) {
      return NextResponse.json({ error: "등록된 업체가 없습니다." }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("settlements")
      .select("*")
      .eq("vendor_id", vendor.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const settlements = (data as SettlementRow[]).map((row) => ({
      ...settlementRowToModel(row),
      vendorName: vendor.name,
    }));

    // 통계 계산
    const totalSettled = settlements
      .filter((s) => s.status === "completed")
      .reduce((sum, s) => sum + s.settleAmount, 0);
    const pendingAmount = settlements
      .filter((s) => s.status === "pending" || s.status === "processing")
      .reduce((sum, s) => sum + s.settleAmount, 0);
    const totalCommission = settlements
      .filter((s) => s.status === "completed")
      .reduce((sum, s) => sum + s.commissionAmount, 0);

    return NextResponse.json({
      settlements,
      stats: { totalSettled, pendingAmount, totalCommission },
    });
  } catch (err) {
    console.error("정산 조회 에러:", err);
    return NextResponse.json({ error: "정산 조회에 실패했습니다." }, { status: 500 });
  }
}
