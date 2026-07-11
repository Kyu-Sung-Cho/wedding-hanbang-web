import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { isUuid } from "@/utils/requestValidation";
import { databaseWeekdayIndex, parseLocalDateOnly } from "@hanbang/shared";
import { addDaysUtc, kstMidnightFromYmd, ymdInKst } from "@/lib/utils/kstDate";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = await checkRateLimitPersistent(rateLimitKey("vendor:staff", req), {
    maxRequests: 60,
    windowMs: 60 * 1000,
  });
  if (limited) return limited;

  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "잘못된 업체 ID입니다." }, { status: 400 });
    }
    const admin = createAdminClient();

    // 업체 확인
    const { data: vendor, error: vendorError } = await admin
      .from("vendors")
      .select("id")
      .eq("id", id)
      .eq("status", "approved")
      .maybeSingle();

    if (vendorError) throw vendorError;

    if (!vendor) {
      return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });
    }

    // 활성 스태프만 조회
    const { data: staff, error: staffError } = await admin
      .from("vendor_staff")
      .select("id, name, role, description")
      .eq("vendor_id", id)
      .eq("is_active", true)
      .order("sort_order");
    if (staffError) throw staffError;

    // 스태프별 타임슬롯
    const staffIds = (staff ?? []).map((s) => s.id);
    const { data: timeslots, error: timeslotsError, count: timeslotsCount } = staffIds.length > 0
      ? await admin
          .from("staff_timeslots")
          .select("staff_id, day, hour, max_bookings", { count: "exact" })
          .in("staff_id", staffIds)
          .eq("available", true)
      : { data: [], error: null, count: 0 };
    if (timeslotsError) throw timeslotsError;
    if (timeslotsCount === null || timeslotsCount !== (timeslots ?? []).length) {
      throw new Error("staff_timeslot_rows_truncated");
    }

    // 향후 7일 예약 수 조회
    const today = kstMidnightFromYmd(ymdInKst());
    const dateStrings: string[] = [];
    const dayToDate = new Map<number, string>();
    for (let i = 0; i < 7; i++) {
      const d = addDaysUtc(today, i);
      const dateStr = ymdInKst(d);
      dateStrings.push(dateStr);
      const parsedDate = parseLocalDateOnly(dateStr);
      if (!parsedDate) continue;
      const day = databaseWeekdayIndex(parsedDate);
      if (!dayToDate.has(day)) dayToDate.set(day, dateStr);
    }

    const { data: bookings, error: bookingsError, count: bookingsCount } = await admin
      .from("vendor_bookings")
      .select("booking_date, booking_time, staff_id", { count: "exact" })
      .eq("vendor_id", id)
      .in("booking_date", dateStrings)
      .neq("status", "cancelled")
      .not("staff_id", "is", null);
    if (bookingsError) throw bookingsError;
    if (bookingsCount === null || bookingsCount !== (bookings ?? []).length) {
      throw new Error("staff_booking_rows_truncated");
    }

    const bookingCountMap = new Map<string, number>();
    for (const b of bookings ?? []) {
      if (!b.staff_id) continue;
      const bDay = Array.from(dayToDate.entries()).find(([, date]) => date === b.booking_date)?.[0];
      if (bDay === undefined) continue;
      const hour = parseInt(b.booking_time.split(":")[0], 10);
      const key = `${b.staff_id}:${bDay}:${hour}`;
      bookingCountMap.set(key, (bookingCountMap.get(key) ?? 0) + 1);
    }

    const result = (staff ?? []).map((s) => {
      const slots = (timeslots ?? [])
        .filter((t) => t.staff_id === s.id)
        .map((t) => ({
          day: t.day,
          hour: t.hour,
          maxBookings: t.max_bookings,
          currentBookings: bookingCountMap.get(`${s.id}:${t.day}:${t.hour}`) ?? 0,
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
