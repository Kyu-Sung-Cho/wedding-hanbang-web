import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const { data: vendor } = await supabase
      .from("vendors")
      .select("id")
      .eq("owner_id", user.id)
      .single();
    if (!vendor) return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });

    const { data: staff } = await supabase
      .from("vendor_staff")
      .select("*")
      .eq("vendor_id", vendor.id)
      .order("sort_order");

    // 각 스태프의 타임슬롯
    const staffIds = (staff ?? []).map((s) => s.id);
    const { data: timeslots } = staffIds.length > 0
      ? await supabase.from("staff_timeslots").select("*").in("staff_id", staffIds)
      : { data: [] };

    const result = (staff ?? []).map((s) => ({
      ...s,
      timeslots: (timeslots ?? []).filter((t) => t.staff_id === s.id),
    }));

    return NextResponse.json({ staff: result });
  } catch (err) {
    console.error("Staff GET error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const { data: vendor } = await supabase
      .from("vendors")
      .select("id")
      .eq("owner_id", user.id)
      .single();
    if (!vendor) return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });

    const body = await req.json();
    const { name, role, description, timeslots } = body;

    if (!name) {
      return NextResponse.json({ error: "스태프 이름은 필수입니다." }, { status: 400 });
    }

    // 스태프 생성
    const { data: newStaff, error } = await supabase
      .from("vendor_staff")
      .insert({
        vendor_id: vendor.id,
        name,
        role: role || null,
        description: description || null,
        is_active: true,
        sort_order: 0,
      })
      .select()
      .single();

    if (error) throw error;

    // 타임슬롯 생성
    if (timeslots && timeslots.length > 0) {
      const slotInserts = timeslots.map((s: { day: number; hour: number; maxBookings?: number }) => ({
        staff_id: newStaff.id,
        day: s.day,
        hour: s.hour,
        available: true,
        max_bookings: s.maxBookings ?? 1,
      }));

      await supabase.from("staff_timeslots").insert(slotInserts);
    }

    return NextResponse.json({ staff: newStaff });
  } catch (err) {
    console.error("Staff POST error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const body = await req.json();
    const { id, name, role, description, isActive, timeslots } = body;

    if (!id) return NextResponse.json({ error: "스태프 ID가 필요합니다." }, { status: 400 });

    // 소유 업체 확인
    const { data: staff } = await supabase
      .from("vendor_staff")
      .select("vendor_id")
      .eq("id", id)
      .single();
    if (!staff) return NextResponse.json({ error: "스태프를 찾을 수 없습니다." }, { status: 404 });

    const { data: vendor } = await supabase
      .from("vendors")
      .select("id")
      .eq("id", staff.vendor_id)
      .eq("owner_id", user.id)
      .single();
    if (!vendor) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

    // 업데이트
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (role !== undefined) updates.role = role;
    if (description !== undefined) updates.description = description;
    if (isActive !== undefined) updates.is_active = isActive;

    const { error } = await supabase
      .from("vendor_staff")
      .update(updates)
      .eq("id", id);
    if (error) throw error;

    // 타임슬롯 교체
    if (timeslots !== undefined) {
      await supabase.from("staff_timeslots").delete().eq("staff_id", id);
      if (timeslots.length > 0) {
        const slotInserts = timeslots.map((s: { day: number; hour: number; maxBookings?: number }) => ({
          staff_id: id,
          day: s.day,
          hour: s.hour,
          available: true,
          max_bookings: s.maxBookings ?? 1,
        }));
        await supabase.from("staff_timeslots").insert(slotInserts);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Staff PUT error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "스태프 ID가 필요합니다." }, { status: 400 });

    // 소유 확인
    const { data: staff } = await supabase
      .from("vendor_staff")
      .select("vendor_id")
      .eq("id", id)
      .single();
    if (!staff) return NextResponse.json({ error: "스태프를 찾을 수 없습니다." }, { status: 404 });

    const { data: vendor } = await supabase
      .from("vendors")
      .select("id")
      .eq("id", staff.vendor_id)
      .eq("owner_id", user.id)
      .single();
    if (!vendor) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

    await supabase.from("vendor_staff").delete().eq("id", id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Staff DELETE error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
