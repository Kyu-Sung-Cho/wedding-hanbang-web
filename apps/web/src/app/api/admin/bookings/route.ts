import { NextResponse } from "next/server";
import { log } from "@/utils/log";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";

export async function GET(request: Request) {
  const { authorized } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  }

  try {
    const admin = getServiceClient();

    // 모든 예약 조회 (최근 순)
    const { data: bookings, error: bookingsErr } = await admin
      .from("vendor_bookings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (bookingsErr) {
      return NextResponse.json({ error: bookingsErr.message }, { status: 500 });
    }

    // 업체 이름 매핑
    const vendorIds = [...new Set((bookings ?? []).map((b) => b.vendor_id).filter(Boolean))];
    const { data: vendors } = vendorIds.length > 0
      ? await admin.from("vendors").select("id, name, category").in("id", vendorIds)
      : { data: [] };
    const vendorMap = new Map((vendors ?? []).map((v) => [v.id, v]));

    // 상품 이름 매핑
    const productIds = [...new Set((bookings ?? []).map((b) => b.product_id).filter(Boolean))];
    const { data: products } = productIds.length > 0
      ? await admin.from("vendor_products").select("id, name").in("id", productIds)
      : { data: [] };
    const productMap = new Map((products ?? []).map((p) => [p.id, p]));

    const result = (bookings ?? []).map((b) => {
      const vendor = vendorMap.get(b.vendor_id);
      const product = b.product_id ? productMap.get(b.product_id) : null;
      return {
        id: b.id,
        vendorId: b.vendor_id,
        vendorName: vendor?.name ?? "-",
        vendorCategory: vendor?.category ?? "-",
        productName: product?.name ?? null,
        coupleId: b.couple_id,
        brideName: b.bride_name,
        groomName: b.groom_name,
        contactPhone: b.contact_phone,
        bookingDate: b.booking_date,
        bookingTime: b.booking_time,
        status: b.status,
        amount: b.amount,
        isPaid: b.is_paid,
        memo: b.memo,
        createdAt: b.created_at,
      };
    });

    // 통계
    const total = result.length;
    const pending = result.filter((b) => b.status === "pending").length;
    const confirmed = result.filter((b) => b.status === "confirmed").length;
    const completed = result.filter((b) => b.status === "completed").length;
    const cancelled = result.filter((b) => b.status === "cancelled").length;

    return NextResponse.json({
      bookings: result,
      stats: { total, pending, confirmed, completed, cancelled },
    });
  } catch (err) {
    log.error("api/admin/bookings", err);
    console.error("Admin bookings error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
