import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { vendorRowToVendor, productRowToProduct, vendorToPublicVendor } from "@/lib/utils/vendorMapper";
import {
  PUBLIC_PRODUCT_TIMESLOT_COLUMNS,
  PUBLIC_VENDOR_COLUMNS,
  PUBLIC_VENDOR_PRODUCT_COLUMNS,
  PUBLIC_VENDOR_REVIEW_COLUMNS,
  PUBLIC_VENDOR_TIMESLOT_COLUMNS,
} from "@/lib/vendors/publicFields";
import { isUuid } from "@/utils/requestValidation";
import {
  bookingCountAt,
  buildKstDateWindow,
  loadPublicBookingAvailability,
  type BookingOccupancyCount,
} from "@/lib/vendors/bookingAvailability";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "잘못된 업체 ID입니다." }, { status: 400 });
    }
    const admin = createAdminClient();
    const userClient = await createClientFromRequest(req);

    // 업체 정보
    const { data: vendorRow, error } = await admin
      .from("vendors")
      .select(PUBLIC_VENDOR_COLUMNS)
      .eq("id", id)
      .eq("status", "approved")
      .single();

    if (error || !vendorRow) {
      return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });
    }

    // 타임슬롯
    const { data: timeslots } = await admin
      .from("vendor_timeslots")
      .select(PUBLIC_VENDOR_TIMESLOT_COLUMNS)
      .eq("vendor_id", id);

    // 상품
    const { data: productRows } = await admin
      .from("vendor_products")
      .select(PUBLIC_VENDOR_PRODUCT_COLUMNS)
      .eq("vendor_id", id)
      .eq("is_active", true)
      .order("sort_order");

    // 상품별 타임슬롯
    const productIds = (productRows ?? []).map((p) => p.id);
    const { data: productTimeslots } = productIds.length > 0
      ? await admin.from("product_timeslots").select(PUBLIC_PRODUCT_TIMESLOT_COLUMNS).in("product_id", productIds)
      : { data: [] };

    // 향후 7일간 예약 수는 서비스 권한 경계에서 모든 고객을 포함해 집계한다.
    // 원시 예약 행과 고객/예약 ID는 이 API 응답으로 전달하지 않는다.
    const nextWeekDates = buildKstDateWindow(new Date(), 7);
    let occupancy: BookingOccupancyCount[];
    try {
      occupancy = await loadPublicBookingAvailability(admin, id, {
        from: nextWeekDates[0].date,
        to: nextWeekDates[nextWeekDates.length - 1].date,
      });
    } catch {
      console.error("[vendor-detail] booking availability unavailable");
      return NextResponse.json(
        {
          error: "예약 가능 시간을 확인할 수 없습니다.",
          code: "BOOKING_AVAILABILITY_UNAVAILABLE",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const dateForDay = new Map(nextWeekDates.map(({ date, day }) => [day, date]));

    // 타임슬롯에 현재 예약 수 주입
    const enrichedTimeslots = (timeslots ?? []).map((s) => ({
      ...s,
      current_bookings: dateForDay.has(s.day)
        ? bookingCountAt(occupancy, { date: dateForDay.get(s.day)!, hour: s.hour })
        : s.max_bookings,
    }));

    const products = (productRows ?? []).map((row) => {
      const pts = (productTimeslots ?? []).filter((pt) => pt.product_id === row.id);
      const enrichedPts = pts.map((s) => ({
        ...s,
        current_bookings: dateForDay.has(s.day)
          ? bookingCountAt(occupancy, {
              date: dateForDay.get(s.day)!,
              hour: s.hour,
              productId: row.id,
            })
          : s.max_bookings,
      }));
      return productRowToProduct(row, enrichedPts as typeof pts);
    });

    // 리뷰
    const { data: reviews } = await admin
      .from("vendor_reviews")
      .select(PUBLIC_VENDOR_REVIEW_COLUMNS)
      .eq("vendor_id", id)
      .eq("is_visible", true)
      .order("created_at", { ascending: false })
      .limit(10);

    const vendor = {
      ...vendorToPublicVendor(vendorRowToVendor(vendorRow, enrichedTimeslots, products)),
      isVerified: Boolean(vendorRow.is_verified),
    };

    // 조회수 기록
    const { data: { user } } = await userClient.auth.getUser();
    if (user) {
      await userClient.from("vendor_views").insert({
        vendor_id: id,
        viewer_id: user.id,
      });
    }

    // 찜 여부 확인
    let isFavorite = false;
    if (user) {
      const { data: fav } = await userClient
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
