import { NextResponse } from "next/server";
import {
  databaseWeekdayIndex,
  differenceInDateOnlyDays,
  parseLocalDateOnly,
} from "@hanbang/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { ymdInKst } from "@/lib/utils/kstDate";
import { cleanOptionalIsoDate, isUuid } from "@/utils/requestValidation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

type ScheduleMode = "vendor" | "product" | "staff";

interface SlotRow {
  hour: number;
  max_bookings: number | null;
}

interface BookingTimeRow {
  booking_time: string;
}

function hourFromBookingTime(value: string): number | null {
  const hour = Number(value.split(":", 1)[0]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await checkRateLimitPersistent(rateLimitKey("vendor:availability", request), {
    maxRequests: 60,
    windowMs: 60 * 1000,
  });
  if (limited) return limited;

  try {
    const { id: vendorId } = await params;
    const url = new URL(request.url);
    const date = cleanOptionalIsoDate(url.searchParams.get("date"));
    const productId = url.searchParams.get("productId");
    const staffId = url.searchParams.get("staffId");

    if (!isUuid(vendorId) || !date || date === undefined) {
      return NextResponse.json({ error: "업체와 날짜 형식이 올바르지 않습니다." }, { status: 400 });
    }
    if (productId && !isUuid(productId)) {
      return NextResponse.json({ error: "상품 형식이 올바르지 않습니다." }, { status: 400 });
    }
    if (staffId && !isUuid(staffId)) {
      return NextResponse.json({ error: "담당자 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const today = ymdInKst();
    const daysFromToday = differenceInDateOnlyDays(date, today);
    if (daysFromToday === null || daysFromToday < 0 || daysFromToday > 31) {
      return NextResponse.json(
        { error: "오늘부터 31일 안의 날짜를 선택해주세요." },
        { status: 400 }
      );
    }

    const parsedDate = parseLocalDateOnly(date);
    if (!parsedDate) {
      return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: vendor, error: vendorError } = await admin
      .from("vendors")
      .select("id")
      .eq("id", vendorId)
      .eq("status", "approved")
      .maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor) {
      return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });
    }

    if (productId) {
      const { data: product, error } = await admin
        .from("vendor_products")
        .select("id")
        .eq("id", productId)
        .eq("vendor_id", vendorId)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      if (!product) {
        return NextResponse.json({ error: "선택한 상품을 이용할 수 없습니다." }, { status: 400 });
      }
    }

    if (staffId) {
      const { data: staff, error } = await admin
        .from("vendor_staff")
        .select("id")
        .eq("id", staffId)
        .eq("vendor_id", vendorId)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      if (!staff) {
        return NextResponse.json({ error: "선택한 담당자를 이용할 수 없습니다." }, { status: 400 });
      }
    }

    let mode: ScheduleMode = "vendor";
    if (staffId) {
      const { data, error } = await admin
        .from("staff_timeslots")
        .select("id")
        .eq("staff_id", staffId)
        .eq("available", true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) mode = "staff";
    }
    if (mode === "vendor" && productId) {
      const { data, error } = await admin
        .from("product_timeslots")
        .select("id")
        .eq("product_id", productId)
        .eq("available", true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) mode = "product";
    }

    const weekday = databaseWeekdayIndex(parsedDate);
    let slotQuery;
    if (mode === "staff") {
      slotQuery = admin
        .from("staff_timeslots")
        .select("hour, max_bookings", { count: "exact" })
        .eq("staff_id", staffId!)
        .eq("day", weekday)
        .eq("available", true);
    } else if (mode === "product") {
      slotQuery = admin
        .from("product_timeslots")
        .select("hour, max_bookings", { count: "exact" })
        .eq("product_id", productId!)
        .eq("day", weekday)
        .eq("available", true);
    } else {
      slotQuery = admin
        .from("vendor_timeslots")
        .select("hour, max_bookings", { count: "exact" })
        .eq("vendor_id", vendorId)
        .eq("day", weekday)
        .eq("available", true);
    }

    const { data: slotData, error: slotError, count: slotCount } = await slotQuery.order("hour");
    if (slotError) throw slotError;
    const slots = (slotData ?? []) as SlotRow[];
    if (slotCount === null || slotCount !== slots.length) {
      throw new Error("availability_slot_rows_truncated");
    }
    if (slots.length === 0) {
      return NextResponse.json({ date, mode, availableHours: [], slots: [] });
    }

    let bookingQuery = admin
      .from("vendor_bookings")
      .select("booking_time", { count: "exact" })
      .eq("vendor_id", vendorId)
      .eq("booking_date", date)
      .neq("status", "cancelled");
    if (mode === "staff") bookingQuery = bookingQuery.eq("staff_id", staffId!);
    if (mode === "product") bookingQuery = bookingQuery.eq("product_id", productId!);

    const { data: bookingData, error: bookingError, count: bookingCount } = await bookingQuery;
    if (bookingError) throw bookingError;
    if (bookingCount === null || bookingCount !== (bookingData ?? []).length) {
      throw new Error("availability_booking_rows_truncated");
    }

    const bookedByHour = new Map<number, number>();
    for (const row of (bookingData ?? []) as BookingTimeRow[]) {
      const hour = hourFromBookingTime(row.booking_time);
      if (hour === null) continue;
      bookedByHour.set(hour, (bookedByHour.get(hour) ?? 0) + 1);
    }

    const availability = slots.map((slot) => {
      // Booking RPC treats zero/negative capacity as unavailable. Keep the
      // preview contract identical so submission cannot contradict the UI.
      const capacity = slot.max_bookings ?? 1;
      const booked = bookedByHour.get(slot.hour) ?? 0;
      return {
        hour: slot.hour,
        remaining: capacity > 0 ? Math.max(0, capacity - booked) : 0,
      };
    });

    return NextResponse.json({
      date,
      mode,
      availableHours: availability.filter((slot) => slot.remaining > 0).map((slot) => slot.hour),
      slots: availability,
    });
  } catch (error) {
    console.error("Vendor availability GET error:", error);
    return NextResponse.json(
      { error: "등록된 운영시간을 확인하지 못했습니다." },
      { status: 500 }
    );
  }
}
