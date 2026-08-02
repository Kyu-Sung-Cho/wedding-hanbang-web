import { createAdminClient } from "@/lib/supabase/admin";
import {
  bookingCountAt,
  buildKstDateWindow,
  loadPublicBookingAvailability,
  toPublicBookingSlots,
  type BookingOccupancyCount,
} from "@/lib/vendors/bookingAvailability";
import { isUuid } from "@/utils/requestValidation";
import { checkPublicBookingAvailabilityRateLimit } from "@/lib/vendors/publicAvailabilityRateLimit";
import { NextResponse } from "next/server";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { CURRENT_VENDOR_STAFF_PUBLICATION_CONSENT_VERSION } from "@/lib/vendors/staffPublicationConsent";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function publicJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return publicJson({ error: "잘못된 업체 ID입니다." }, 400);
    }
    const limited = await checkPublicBookingAvailabilityRateLimit(req);
    if (limited) {
      limited.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
      return limited;
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
      return publicJson({ error: "업체를 찾을 수 없습니다." }, 404);
    }

    // 활성 스태프만 조회
    const { data: staff } = await admin
      .from("vendor_staff")
      .select("id, name, role, description")
      .eq("vendor_id", id)
      .eq("is_active", true)
      .not("public_profile_consent_at", "is", null)
      .eq(
        "public_profile_consent_version",
        CURRENT_VENDOR_STAFF_PUBLICATION_CONSENT_VERSION,
      )
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
      return publicJson(
        {
          error: "예약 가능 시간을 확인할 수 없습니다.",
          code: "BOOKING_AVAILABILITY_UNAVAILABLE",
        },
        503,
      );
    }
    const dateForDay = new Map(nextWeekDates.map(({ date, day }) => [day, date]));

    const result = (staff ?? []).map((s) => {
      const internalSlots = (timeslots ?? [])
        .filter((t) => t.staff_id === s.id)
        .map((t) => ({
          day: t.day,
          hour: t.hour,
          available: true,
          max_bookings: t.max_bookings,
          current_bookings: dateForDay.has(t.day)
            ? bookingCountAt(occupancy, {
                date: dateForDay.get(t.day)!,
                hour: t.hour,
                staffId: s.id,
              })
            : t.max_bookings,
        }));
      const slots = toPublicBookingSlots(internalSlots);

      return {
        id: s.id,
        name: s.name,
        role: s.role,
        description: s.description,
        timeSlots: slots,
      };
    });

    return publicJson({ staff: result });
  } catch (err) {
    console.error("Vendor staff GET error", safeErrorDiagnostic(err));
    return publicJson({ error: "서버 오류" }, 500);
  }
}
