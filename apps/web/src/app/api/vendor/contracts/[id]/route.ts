// 업체 계약 상세 조회 + 수정
import { NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { ContractRow, contractRowToModel } from "@/types/contract.types";

async function getVendor(supabase: ReturnType<typeof createClientFromRequest> extends Promise<infer R> ? R : never) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id")
    .eq("owner_id", user.id)
    .single();
  return vendor;
}

// GET: 계약 상세 조회
export async function GET(
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

    const { data, error } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", id)
      .eq("vendor_id", vendor.id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    }

    const contract = contractRowToModel(data as ContractRow);

    // 예약 정보 조인
    const { data: booking } = await supabase
      .from("vendor_bookings")
      .select("id, booking_date, bride_name, groom_name, product_id, contact_phone")
      .eq("id", contract.bookingId)
      .single();

    if (booking) {
      contract.bookingDate = booking.booking_date;
      contract.vendorName = `${booking.bride_name ?? ""} & ${booking.groom_name ?? ""}`.trim();
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
    console.error("계약 상세 조회 에러:", err);
    return NextResponse.json({ error: "계약 조회에 실패했습니다." }, { status: 500 });
  }
}

// PUT: 계약 내용 수정 (draft 상태일 때만)
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(req);
    const vendor = await getVendor(supabase);
    if (!vendor) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // 현재 상태 확인
    const { data: existing } = await supabase
      .from("contracts")
      .select("status")
      .eq("id", id)
      .eq("vendor_id", vendor.id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    }
    if (existing.status !== "draft") {
      return NextResponse.json({ error: "전송된 계약은 수정할 수 없습니다." }, { status: 400 });
    }

    const body = await req.json();
    const { content, contractAmount, depositRate, cancellationPolicy } = body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (content) updates.content = content;
    if (contractAmount) {
      updates.contract_amount = contractAmount;
      updates.deposit_amount = Math.round(contractAmount * (depositRate ?? 0.3));
    }
    if (depositRate !== undefined) {
      updates.deposit_rate = depositRate;
      if (contractAmount) {
        updates.deposit_amount = Math.round(contractAmount * depositRate);
      }
    }
    if (cancellationPolicy) updates.cancellation_policy = cancellationPolicy;

    const { data, error } = await supabase
      .from("contracts")
      .update(updates)
      .eq("id", id)
      .eq("vendor_id", vendor.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ contract: contractRowToModel(data as ContractRow) });
  } catch (err) {
    console.error("계약 수정 에러:", err);
    return NextResponse.json({ error: "계약 수정에 실패했습니다." }, { status: 500 });
  }
}
