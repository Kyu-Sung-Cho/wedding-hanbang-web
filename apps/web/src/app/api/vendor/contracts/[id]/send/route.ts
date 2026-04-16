// 계약서 고객에게 전송
import { NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { ContractRow, contractRowToModel } from "@/types/contract.types";

async function getVendor(supabase: ReturnType<typeof createClientFromRequest> extends Promise<infer R> ? R : never) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("owner_id", user.id)
    .single();
  return vendor;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(_req);
    const vendor = await getVendor(supabase);
    if (!vendor) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // 계약 확인
    const { data: existing } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", id)
      .eq("vendor_id", vendor.id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    }
    if (existing.status !== "draft") {
      return NextResponse.json({ error: "이미 전송된 계약입니다." }, { status: 400 });
    }

    // 계약 내용 검증
    const content = existing.content as { title: string; body: string }[];
    if (!content || content.length === 0) {
      return NextResponse.json({ error: "계약 내용이 비어있습니다." }, { status: 400 });
    }

    // 상태 업데이트: draft → sent
    const { data, error } = await supabase
      .from("contracts")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // 예약 상태도 업데이트
    await supabase
      .from("vendor_bookings")
      .update({ contract_status: "sent" })
      .eq("id", existing.booking_id);

    // TODO: 고객에게 알림 발송 (이메일/카카오톡)
    // 예: await sendContractNotification(existing.customer_id, vendor.name, id);

    return NextResponse.json({ contract: contractRowToModel(data as ContractRow) });
  } catch (err) {
    console.error("계약 전송 에러:", err);
    return NextResponse.json({ error: "계약 전송에 실패했습니다." }, { status: 500 });
  }
}
