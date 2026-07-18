import { createAdminClient } from "@/lib/supabase/admin";
import {
  bookingCountAt,
  buildKstDateWindow,
  loadPublicBookingAvailability,
  type BookingOccupancyCount,
} from "@/lib/vendors/bookingAvailability";
import { isUuid } from "@/utils/requestValidation";
import { NextResponse } from "next/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "잘못된 업체 ID입니다." }, { status: 400 });
    }
    const admin = createAdminClient();

    // 업체 확인
    const { data: vendor } = await admin
      .from("vendors")
      .select("id")
      .eq("id", id)
      .eq("status", "approved")
      .single();

    if (!vendor) {
      return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });
    }

    // 활성 스태프만 조회
    const { data: staff } = await admin
      .from("vendor_staff")
      .select("id, name, role, description")
      .eq("vendor_id", id)
      .eq("is_active", true)
      .order("sort_order");

    // 스태프별 타임슬롯
    const staffIds = (staff ?? []).map((s) => s.id);
    const { data: timeslots } = staffIds.length > 0
      ? await admin
          .from("staff_timeslots")
          .select("staff_id, day, hour, max_bookings")
          .in("staff_id", staffIds)
          .eq("available", true)
      : { data: [] };

    const nextWeekDates = buildKstDateWindow(new Date(), 7);
    let occupancy: BookingOccupancyCount[];
    try {
      occupancy = await loadPublicBookingAvailability(admin, id, {
        from: nextWeekDates[0].date,
        to: nextWeekDates[nextWeekDates.length - 1].date,
      });
    } catch {
      console.error("[vendor-staff] booking availability unavailable");
      return NextResponse.json(
        {
          error: "예약 가능 시간을 확인할 수 없습니다.",
          code: "BOOKING_AVAILABILITY_UNAVAILABLE",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const dateForDay = new Map(nextWeekDates.map(({ date, day }) => [day, date]));

    const result = (staff ?? []).map((s) => {
      const slots = (timeslots ?? [])
        .filter((t) => t.staff_id === s.id)
        .map((t) => ({
          day: t.day,
          hour: t.hour,
          maxBookings: t.max_bookings,
          currentBookings: dateForDay.has(t.day)
            ? bookingCountAt(occupancy, {
                date: dateForDay.get(t.day)!,
                hour: t.hour,
                staffId: s.id,
              })
            : t.max_bookings,
        }));

      return {
        id: s.id,
        name: s.name,
        role: s.role,
        description: s.description,
        timeSlots: slots,
      };
    });

    return NextResponse.json({ staff: result });
  } catch (err) {
    console.error("Vendor staff GET error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
