// 결제 상세 조회
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PaymentRow, paymentRowToModel } from "@/types/contract.types";

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

    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("id", id)
      .eq("customer_id", user.id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "결제를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ payment: paymentRowToModel(data as PaymentRow) });
  } catch (err) {
    console.error("결제 조회 에러:", err);
    return NextResponse.json({ error: "결제 조회에 실패했습니다." }, { status: 500 });
  }
}
