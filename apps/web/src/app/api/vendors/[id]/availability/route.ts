import { createAdminClient } from "@/lib/supabase/admin";
import {
  AvailabilityInputError,
  AvailabilityVendorNotFoundError,
  addCalendarDays,
  bookingCountAt,
  databaseWeekday,
  loadPublicBookingAvailability,
  parseAvailabilityRange,
  toPublicBookingSlots,
} from "@/lib/vendors/bookingAvailability";
import { isUuid } from "@/utils/requestValidation";
import { checkPublicBookingAvailabilityRateLimit } from "@/lib/vendors/publicAvailabilityRateLimit";
import { NextResponse } from "next/server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json(
        { error: "잘못된 업체 ID입니다.", code: "INVALID_VENDOR_ID" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const range = parseAvailabilityRange(new URL(request.url).searchParams);
    const limited = await checkPublicBookingAvailabilityRateLimit(request);
    if (limited) {
      limited.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
      return limited;
    }
    const admin = createAdminClient();
    const occupancy = await loadPublicBookingAvailability(admin, id, range);
    const { data: schedule, error: scheduleError } = await admin
      .from("vendor_timeslots")
      .select("day,hour,available,max_bookings")
      .eq("vendor_id", id);
    if (scheduleError || !schedule) {
      throw new Error("BOOKING_SCHEDULE_UNAVAILABLE");
    }

    const slots: Array<{ date: string; time: string; available: boolean }> = [];
    for (let date = range.from; date <= range.to; date = addCalendarDays(date, 1)) {
      const day = databaseWeekday(date);
      const daySlots = toPublicBookingSlots(
        schedule
          .filter((slot) => slot.day === day)
          .map((slot) => ({
            day: slot.day,
            hour: slot.hour,
            available: slot.available === true,
            max_bookings: slot.max_bookings,
            current_bookings: bookingCountAt(occupancy, {
              date,
              hour: slot.hour,
            }),
          })),
      );
      slots.push(...daySlots.map((slot) => ({
        date,
        time: `${String(slot.hour).padStart(2, "0")}:00`,
        available: slot.available,
      })));
    }

    return NextResponse.json(
      {
        ...range,
        timezone: "Asia/Seoul",
        slots,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof AvailabilityInputError) {
      return NextResponse.json(
        { error: "조회 날짜 범위를 확인해주세요.", code: "INVALID_AVAILABILITY_RANGE" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (error instanceof AvailabilityVendorNotFoundError) {
      return NextResponse.json(
        { error: "업체를 찾을 수 없습니다.", code: "AVAILABILITY_VENDOR_NOT_FOUND" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    console.error("[vendor-availability] availability lookup unavailable");
    return NextResponse.json(
      {
        error: "예약 가능 시간을 확인할 수 없습니다.",
        code: "BOOKING_AVAILABILITY_UNAVAILABLE",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
