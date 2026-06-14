import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { vendorRowToVendor, productRowToProduct, vendorToPublicVendor } from "@/lib/utils/vendorMapper";
import { isUuid } from "@/utils/requestValidation";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "잘못된 업체 ID입니다." }, { status: 400 });
    }
    const supabase = await createClientFromRequest(req);

    // 업체 정보
    const { data: vendorRow, error } = await supabase
      .from("vendors")
      .select("*")
      .eq("id", id)
      .eq("status", "approved")
      .single();

    if (error || !vendorRow) {
      return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });
    }

    // 타임슬롯
    const { data: timeslots } = await supabase
      .from("vendor_timeslots")
      .select("*")
      .eq("vendor_id", id);

    // 상품
    const { data: productRows } = await supabase
      .from("vendor_products")
      .select("*")
      .eq("vendor_id", id)
      .eq("is_active", true)
      .order("sort_order");

    // 상품별 타임슬롯
    const productIds = (productRows ?? []).map((p) => p.id);
    const { data: productTimeslots } = productIds.length > 0
      ? await supabase.from("product_timeslots").select("*").in("product_id", productIds)
      : { data: [] };

    // 향후 7일간 예약 수 조회 (잔여 슬롯 계산용)
    const today = new Date();
    const nextWeekDates: { date: string; day: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      nextWeekDates.push({
        date: d.toISOString().split("T")[0],
        day: (d.getDay() + 6) % 7, // 0=월 ~ 6=일
      });
    }

    const dateStrings = nextWeekDates.map((d) => d.date);
    const { data: upcomingBookings } = await supabase
      .from("vendor_bookings")
      .select("booking_date, booking_time, product_id")
      .eq("vendor_id", id)
      .in("booking_date", dateStrings)
      .neq("status", "cancelled");

    // 요일/시간별 예약 수 집계
    const bookingCountMap = new Map<string, number>();
    for (const b of upcomingBookings ?? []) {
      const bDate = nextWeekDates.find((d) => d.date === b.booking_date);
      if (!bDate) continue;
      const hour = parseInt(b.booking_time.split(":")[0], 10);
      const globalKey = `${bDate.day}:${hour}`;
      bookingCountMap.set(globalKey, (bookingCountMap.get(globalKey) ?? 0) + 1);
      if (b.product_id) {
        const productKey = `${b.product_id}:${bDate.day}:${hour}`;
        bookingCountMap.set(productKey, (bookingCountMap.get(productKey) ?? 0) + 1);
      }
    }

    // 타임슬롯에 현재 예약 수 주입
    const enrichedTimeslots = (timeslots ?? []).map((s) => ({
      ...s,
      current_bookings: bookingCountMap.get(`${s.day}:${s.hour}`) ?? 0,
    }));

    const products = (productRows ?? []).map((row) => {
      const pts = (productTimeslots ?? []).filter((pt) => pt.product_id === row.id);
      const enrichedPts = pts.map((s) => ({
        ...s,
        current_bookings: bookingCountMap.get(`${row.id}:${s.day}:${s.hour}`) ?? 0,
      }));
      return productRowToProduct(row, enrichedPts as typeof pts);
    });

    // 리뷰
    const { data: reviews } = await supabase
      .from("vendor_reviews")
      .select("*")
      .eq("vendor_id", id)
      .eq("is_visible", true)
      .order("created_at", { ascending: false })
      .limit(10);

    const vendor = vendorToPublicVendor(vendorRowToVendor(vendorRow, enrichedTimeslots, products));

    // 조회수 기록
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("vendor_views").insert({
        vendor_id: id,
        viewer_id: user.id,
      });
    }

    // 찜 여부 확인
    let isFavorite = false;
    if (user) {
      const { data: fav } = await supabase
        .from("vendor_favorites")
        .select("id")
        .eq("vendor_id", id)
        .eq("user_id", user.id)
        .single();
      isFavorite = !!fav;
    }

    return NextResponse.json({
      vendor,
      reviews: reviews ?? [],
      isFavorite,
    });
  } catch (err) {
    console.error("Vendor detail error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
