// 관리자 전체 정산 목록 조회
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SettlementRow, settlementRowToModel } from "@/types/contract.types";

export async function GET(req: Request) {
  try {
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

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    let query = supabase
      .from("settlements")
      .select("*")
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) throw error;

    const settlements = (data as SettlementRow[]).map(settlementRowToModel);

    // 업체 이름 조인
    const vendorIds = [...new Set(settlements.map((s) => s.vendorId))];
    if (vendorIds.length > 0) {
      const { data: vendors } = await supabase
        .from("vendors")
        .select("id, name")
        .in("id", vendorIds);

      const vendorMap = new Map(vendors?.map((v) => [v.id, v.name]) ?? []);
      settlements.forEach((s) => {
        s.vendorName = vendorMap.get(s.vendorId);
      });
    }

    return NextResponse.json({ settlements });
  } catch (err) {
    console.error("관리자 정산 조회 에러:", err);
    return NextResponse.json({ error: "정산 조회에 실패했습니다." }, { status: 500 });
  }
}
