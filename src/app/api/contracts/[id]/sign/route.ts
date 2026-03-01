// 고객 계약 서명
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ContractRow, contractRowToModel } from "@/types/contract.types";

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

    const body = await req.json();
    const { signedName, agreed } = body;

    if (!signedName || !agreed) {
      return NextResponse.json(
        { error: "서명 이름과 동의 여부는 필수입니다." },
        { status: 400 }
      );
    }

    // 계약 확인 (RLS가 couple_id 기반으로 접근 제어)
    const { data: existing } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    }

    if (existing.status !== "sent" && existing.status !== "viewed") {
      return NextResponse.json(
        { error: "서명할 수 없는 상태의 계약입니다." },
        { status: 400 }
      );
    }

    // 서명 처리
    const { data, error } = await supabase
      .from("contracts")
      .update({
        status: "signed",
        signed_at: new Date().toISOString(),
        signed_name: signedName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // 예약 상태 업데이트
    await supabase
      .from("vendor_bookings")
      .update({ contract_status: "signed" })
      .eq("id", existing.booking_id);

    return NextResponse.json({ contract: contractRowToModel(data as ContractRow) });
  } catch (err) {
    console.error("계약 서명 에러:", err);
    return NextResponse.json({ error: "계약 서명에 실패했습니다." }, { status: 500 });
  }
}
