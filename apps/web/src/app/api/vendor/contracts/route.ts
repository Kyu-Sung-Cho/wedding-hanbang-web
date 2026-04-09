// 업체 계약 목록 조회 + 계약 생성
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ContractRow, contractRowToModel } from "@/types/contract.types";

async function getVendor(supabase: ReturnType<typeof createClient> extends Promise<infer R> ? R : never) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, category")
    .eq("owner_id", user.id)
    .single();
  return vendor;
}

// GET: 업체의 모든 계약 조회
export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const vendor = await getVendor(supabase);
    if (!vendor) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    let query = supabase
      .from("contracts")
      .select("*")
      .eq("vendor_id", vendor.id)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) throw error;

    const contracts = (data as ContractRow[]).map(contractRowToModel);

    // 예약 정보 조인 (별도 쿼리)
    const bookingIds = [...new Set(contracts.map((c) => c.bookingId))];
    if (bookingIds.length > 0) {
      const { data: bookings } = await supabase
        .from("vendor_bookings")
        .select("id, booking_date, bride_name, groom_name, product_id")
        .in("id", bookingIds);

      const productIds = bookings?.map((b) => b.product_id).filter(Boolean) ?? [];
      const { data: products } = productIds.length > 0
        ? await supabase.from("vendor_products").select("id, name").in("id", productIds)
        : { data: [] };

      const bookingMap = new Map(bookings?.map((b) => [b.id, b]) ?? []);
      const productMap = new Map(products?.map((p) => [p.id, p]) ?? []);

      contracts.forEach((c) => {
        const booking = bookingMap.get(c.bookingId);
        if (booking) {
          c.bookingDate = booking.booking_date;
          const product = productMap.get(booking.product_id);
          c.productName = product?.name;
          c.vendorName = `${booking.bride_name ?? ""} & ${booking.groom_name ?? ""}`.trim();
        }
      });
    }

    return NextResponse.json({ contracts });
  } catch (err) {
    console.error("계약 목록 조회 에러:", err);
    return NextResponse.json({ error: "계약 목록 조회에 실패했습니다." }, { status: 500 });
  }
}

// POST: 새 계약 생성 (예약 기반)
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const vendor = await getVendor(supabase);
    if (!vendor) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const { bookingId, templateId, content, contractAmount, depositRate, cancellationPolicy } = body;

    if (!bookingId || !contractAmount) {
      return NextResponse.json({ error: "예약 ID와 계약 금액은 필수입니다." }, { status: 400 });
    }

    // 예약 확인
    const { data: booking, error: bookingError } = await supabase
      .from("vendor_bookings")
      .select("id, couple_id, vendor_id, status, amount")
      .eq("id", bookingId)
      .eq("vendor_id", vendor.id)
      .single();

    if (bookingError || !booking) {
      return NextResponse.json({ error: "해당 예약을 찾을 수 없습니다." }, { status: 404 });
    }

    // 기존 계약 확인
    const { data: existingContract } = await supabase
      .from("contracts")
      .select("id")
      .eq("booking_id", bookingId)
      .not("status", "eq", "cancelled")
      .single();

    if (existingContract) {
      return NextResponse.json({ error: "이 예약에 이미 활성 계약이 있습니다." }, { status: 400 });
    }

    const rate = depositRate ?? 0.3;
    const depositAmount = Math.round(contractAmount * rate);

    // 템플릿에서 내용 불러오기 (templateId가 있는 경우)
    let contractContent = content;
    let contractCancellationPolicy = cancellationPolicy;

    if (templateId && !content) {
      const { data: template } = await supabase
        .from("vendor_contract_templates")
        .select("content, cancellation_policy, deposit_rate")
        .eq("id", templateId)
        .eq("vendor_id", vendor.id)
        .single();

      if (template) {
        contractContent = template.content;
        contractCancellationPolicy = template.cancellation_policy;
      }
    }

    const { data, error } = await supabase
      .from("contracts")
      .insert({
        booking_id: bookingId,
        vendor_id: vendor.id,
        customer_id: booking.couple_id,
        template_id: templateId || null,
        content: contractContent || [],
        contract_amount: contractAmount,
        deposit_amount: depositAmount,
        deposit_rate: rate,
        cancellation_policy: contractCancellationPolicy || [],
        status: "draft",
      })
      .select()
      .single();

    if (error) throw error;

    // 예약 상태 업데이트
    await supabase
      .from("vendor_bookings")
      .update({ contract_status: "draft" })
      .eq("id", bookingId);

    return NextResponse.json({ contract: contractRowToModel(data as ContractRow) });
  } catch (err) {
    console.error("계약 생성 에러:", err);
    return NextResponse.json({ error: "계약 생성에 실패했습니다." }, { status: 500 });
  }
}
