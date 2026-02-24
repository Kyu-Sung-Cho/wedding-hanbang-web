import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // 업체 확인
    const { data: vendor } = await supabase
      .from("vendors")
      .select("id")
      .eq("id", id)
      .eq("status", "approved")
      .single();

    if (!vendor) {
      return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });
    }

    // 활성 스태프만 조회
    const { data: staff } = await supabase
      .from("vendor_staff")
      .select("id, name, role, description")
      .eq("vendor_id", id)
      .eq("is_active", true)
      .order("sort_order");

    // 스태프별 타임슬롯
    const staffIds = (staff ?? []).map((s) => s.id);
    const { data: timeslots } = staffIds.length > 0
      ? await supabase
          .from("staff_timeslots")
          .select("staff_id, day, hour, max_bookings")
          .in("staff_id", staffIds)
          .eq("available", true)
      : { data: [] };

    // 향후 7일 예약 수 조회
    const today = new Date();
    const dateStrings: string[] = [];
    const dayToDate = new Map<number, string>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      dateStrings.push(dateStr);
      const day = (d.getDay() + 6) % 7;
      if (!dayToDate.has(day)) dayToDate.set(day, dateStr);
    }

    const { data: bookings } = await supabase
      .from("vendor_bookings")
      .select("booking_date, booking_time, staff_id")
      .eq("vendor_id", id)
      .in("booking_date", dateStrings)
      .neq("status", "cancelled")
      .not("staff_id", "is", null);

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
