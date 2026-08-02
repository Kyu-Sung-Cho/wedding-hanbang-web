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
import { checkPublicBookingAvailabilityRateLimit } from "@/lib/vendors/publicAvailabilityRateLimit";
import { checkPublicVendorCatalogRateLimit } from "@/lib/vendors/publicCatalogRateLimit";
import {
  bookingCountAt,
  buildKstDateWindow,
  loadPublicBookingAvailability,
  toPublicBookingSlots,
  type BookingOccupancyCount,
  type PublicBookingSlot,
} from "@/lib/vendors/bookingAvailability";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_NO_STORE_HEADERS });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return privateJson({ error: "잘못된 업체 ID입니다." }, 400);
    }
    const catalogLimited = await checkPublicVendorCatalogRateLimit(req);
    if (catalogLimited) {
      for (const [name, value] of Object.entries(PRIVATE_NO_STORE_HEADERS)) {
        catalogLimited.headers.set(name, value);
      }
      return catalogLimited;
    }
    const limited = await checkPublicBookingAvailabilityRateLimit(req);
    if (limited) {
      for (const [name, value] of Object.entries(PRIVATE_NO_STORE_HEADERS)) {
        limited.headers.set(name, value);
      }
      return limited;
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
      return privateJson({ error: "업체를 찾을 수 없습니다." }, 404);
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
      return privateJson(
        {
          error: "예약 가능 시간을 확인할 수 없습니다.",
          code: "BOOKING_AVAILABILITY_UNAVAILABLE",
        },
        503,
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

    const publicProductSlots = new Map<string, PublicBookingSlot[]>();
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
      publicProductSlots.set(row.id, toPublicBookingSlots(enrichedPts));
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

    const internalVendor = vendorToPublicVendor(
      vendorRowToVendor(vendorRow, enrichedTimeslots, products),
    );
    const vendor = {
      ...internalVendor,
      timeSlots: toPublicBookingSlots(enrichedTimeslots),
      products: internalVendor.products.map((product) => ({
        ...product,
        timeSlots: publicProductSlots.get(product.id) ?? [],
      })),
      isVerified: Boolean(vendorRow.is_verified),
    };

    // GET은 캐시·프리패치·이미지 요청으로도 호출될 수 있으므로 상태를 바꾸지 않는다.
    // 인증은 찜 여부를 응답하기 위해서만 확인한다.
    const { data: { user } } = await userClient.auth.getUser();

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

    return privateJson({
      vendor,
      reviews: reviews ?? [],
      isFavorite,
    });
  } catch (err) {
    console.error("Vendor detail error", safeErrorDiagnostic(err));
    return privateJson({ error: "서버 오류가 발생했습니다." }, 500);
  }
}
