import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      if (hasSignedDemoSessionFromCookieHeader(req.headers.get("cookie"))) {
        return NextResponse.json({ bookings: [] });
      }
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // 프로필에서 couple_id 가져오기
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("My bookings profile error:", profileError.message);
      return NextResponse.json(
        { error: "커플 연결 상태를 확인하지 못했습니다." },
        { status: 503 },
      );
    }

    if (!profile?.couple_id) {
      return NextResponse.json({ bookings: [] });
    }

    const { data: bookingRows, error: bookingsError } = await supabase
      .from("vendor_bookings")
      // 과거 목록 UI에 필요 없는 이름·전화번호·메모는 서버로도 읽지 않는다.
      .select("id, vendor_id, couple_id, product_id, booking_date, booking_time, booking_type, status, contract_status, payment_status, amount, is_paid, created_at, updated_at")
      .eq("couple_id", profile.couple_id)
      .order("booking_date", { ascending: false });
    if (bookingsError) {
      console.error("My bookings list error:", bookingsError.message);
      return NextResponse.json(
        { error: "과거 요청 기록을 불러오지 못했습니다." },
        { status: 503 },
      );
    }

    // 목록 표시용 공개 이름만 별도 조회한다.
    const vendorIds = [...new Set((bookingRows ?? []).map((b) => b.vendor_id))];
    const productIds = [...new Set(
      (bookingRows ?? []).flatMap((booking) => booking.product_id ? [booking.product_id] : [])
    )];
    const { data: vendors, error: vendorsError } = vendorIds.length > 0
      ? await supabase.from("vendors").select("id, name").in("id", vendorIds)
      : { data: [], error: null };
    const { data: products, error: productsError } = productIds.length > 0
      ? await supabase.from("vendor_products").select("id, name, duration_minutes").in("id", productIds)
      : { data: [], error: null };
    if (vendorsError || productsError) {
      console.error(
        "My bookings catalog error:",
        vendorsError?.message ?? productsError?.message ?? "unknown",
      );
      return NextResponse.json(
        { error: "과거 요청의 업체 정보를 불러오지 못했습니다." },
        { status: 503 },
      );
    }

    const vendorMap = Object.fromEntries((vendors ?? []).map((v) => [v.id, v.name]));
    const productMap = new Map((products ?? []).map((product) => [product.id, product]));

    // contracts/payments 조인은 제거됨 — 결제층 삭제(Week 1 수술)로 두 테이블 모두
    // 0행이고 소비처(bookings 페이지·BudgetContent)도 해당 필드를 읽지 않는다 (감사 2.2).
    const bookings = (bookingRows ?? []).map((row) => {
      const product = row.product_id ? productMap.get(row.product_id) : null;
      return {
        id: row.id,
        vendorId: row.vendor_id,
        coupleId: row.couple_id,
        productId: row.product_id,
        bookingDate: row.booking_date,
        bookingTime: row.booking_time,
        bookingType: row.booking_type ?? "",
        brideName: "",
        groomName: "",
        contactPhone: "",
        status: row.status,
        contractStatus: row.contract_status ?? null,
        paymentStatus: row.payment_status ?? null,
        amount: row.amount ?? 0,
        isPaid: row.is_paid ?? false,
        memo: "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        productName: product?.name ?? "",
        productDuration: product?.duration_minutes ?? undefined,
        vendorName: vendorMap[row.vendor_id] ?? "",
      };
    });

    return NextResponse.json({ bookings });
  } catch (err) {
    console.error("My bookings error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
