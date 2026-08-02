import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import {
  adminPaginationMetadata,
  checkAdminReadRateLimit,
  parseAdminPagination,
} from "@/lib/admin/adminReadBoundary";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

const BOOKING_STATUSES = ["pending", "confirmed", "completed", "cancelled"] as const;
type BookingStatus = (typeof BOOKING_STATUSES)[number];

function normalizeBookingStatus(value: string | null): BookingStatus {
  return BOOKING_STATUSES.find((status) => status === value) ?? "pending";
}

export async function GET(request: Request) {
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await checkAdminReadRateLimit(request, userId, "bookings");
  if (limited) return limited;

  const pagination = parseAdminPagination(request, { defaultLimit: 100, maxLimit: 200 });
  if (!pagination) {
    return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });
  }

  try {
    const admin = getServiceClient();
    const { data: bookings, error: bookingsError, count } = await admin
      .from("vendor_bookings")
      .select(
        "id,vendor_id,product_id,couple_id,bride_name,groom_name,contact_phone,booking_date,booking_time,status,amount,is_paid,memo,created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(pagination.offset, pagination.offset + pagination.limit - 1);

    if (bookingsError) {
      console.error("Admin bookings query failed", safeErrorDiagnostic(bookingsError));
      return NextResponse.json({ error: "예약 목록을 불러오지 못했습니다." }, { status: 500 });
    }

    const statusCounts = await Promise.all(BOOKING_STATUSES.map((status) => admin
      .from("vendor_bookings")
      .select("id", { count: "exact", head: true })
      .eq("status", status)));
    const statsError = statusCounts.find((result) => result.error)?.error;
    if (statsError) {
      console.error("Admin booking stats query failed", safeErrorDiagnostic(statsError));
      return NextResponse.json({ error: "예약 통계를 불러오지 못했습니다." }, { status: 500 });
    }

    const rows = bookings ?? [];
    const vendorIds = [...new Set(rows.map((booking) => booking.vendor_id).filter(Boolean))];
    const productIds = [...new Set(rows.map((booking) => booking.product_id).filter((id): id is string => Boolean(id)))];

    const [vendorsResult, productsResult] = await Promise.all([
      vendorIds.length > 0
        ? admin.from("vendors").select("id,name,category").in("id", vendorIds)
        : Promise.resolve({ data: [], error: null }),
      productIds.length > 0
        ? admin.from("vendor_products").select("id,name").in("id", productIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (vendorsResult.error || productsResult.error) {
      console.error(
        "Admin booking relationship query failed",
        safeErrorDiagnostic(vendorsResult.error ?? productsResult.error),
      );
      return NextResponse.json({ error: "예약 관계 정보를 불러오지 못했습니다." }, { status: 500 });
    }

    const vendorMap = new Map((vendorsResult.data ?? []).map((vendor) => [vendor.id, vendor]));
    const productMap = new Map((productsResult.data ?? []).map((product) => [product.id, product]));
    const result = rows.map((booking) => {
      const vendor = vendorMap.get(booking.vendor_id);
      const product = booking.product_id ? productMap.get(booking.product_id) : null;
      return {
        id: booking.id,
        vendorId: booking.vendor_id,
        vendorName: vendor?.name ?? "-",
        vendorCategory: vendor?.category ?? "-",
        productName: product?.name ?? null,
        coupleId: booking.couple_id,
        brideName: booking.bride_name,
        groomName: booking.groom_name,
        contactPhone: booking.contact_phone,
        bookingDate: booking.booking_date,
        bookingTime: booking.booking_time,
        status: normalizeBookingStatus(booking.status),
        amount: booking.amount,
        isPaid: booking.is_paid,
        memo: booking.memo,
        createdAt: booking.created_at,
      };
    });

    const stats = BOOKING_STATUSES.reduce<Record<BookingStatus, number>>(
      (accumulator, status, index) => {
        accumulator[status] = statusCounts[index]?.count ?? 0;
        return accumulator;
      },
      { pending: 0, confirmed: 0, completed: 0, cancelled: 0 },
    );
    const total = count ?? 0;

    return NextResponse.json({
      bookings: result,
      stats: { total, ...stats },
      pagination: adminPaginationMetadata(pagination, result.length, total),
    });
  } catch (error) {
    console.error("Admin bookings error", safeErrorDiagnostic(error));
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
