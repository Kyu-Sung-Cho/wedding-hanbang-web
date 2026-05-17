import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import type { ScheduleEvent } from "@/types/database.types";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // 예약 조회 → vendor 소유권 검증. cancel sync 위해 couple_id, amount 도 같이 가져옴.
    const { data: booking } = await supabase
      .from("vendor_bookings")
      .select("vendor_id, couple_id, amount, status")
      .eq("id", id)
      .single();

    if (!booking) {
      return NextResponse.json({ error: "예약을 찾을 수 없습니다." }, { status: 404 });
    }

    const { data: vendor } = await supabase
      .from("vendors")
      .select("id, category")
      .eq("id", booking.vendor_id)
      .eq("owner_id", user.id)
      .single();

    if (!vendor) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    const { status, memo } = await req.json();

    if (!["confirmed", "cancelled", "completed"].includes(status)) {
      return NextResponse.json({ error: "유효하지 않은 상태입니다." }, { status: 400 });
    }

    const updateData: Record<string, unknown> = { status };
    if (memo !== undefined) updateData.memo = memo;

    const { data, error } = await supabase
      .from("vendor_bookings")
      .update(updateData)
      .eq("id", id)
      .eq("vendor_id", vendor.id)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "예약 상태 변경에 실패했습니다." }, { status: 500 });
    }

    // 업체가 status='cancelled' 로 전환한 경우 — 사용자 wedding_journeys.progress 에서
    // create_booking 자동 등록한 event 제거 + spent 차감 (cancel_booking tool 과 동일).
    // chat path 가 아니라서 client merge 는 못 하지만, 다음 페이지 로드 시 일관됨.
    // admin client 로 customer 의 journey 갱신 (vendor RLS 로는 접근 불가).
    if (
      status === "cancelled" &&
      booking.status !== "cancelled" &&
      booking.couple_id
    ) {
      try {
        const admin = createAdminClient();
        const eventIdToRemove = `evt_booking_${id.slice(0, 8)}`;
        const cancelAmount = (booking.amount as number | undefined) ?? 0;
        const categoryKey = (vendor.category as string | null) ?? null;

        const { data: journeyRow } = await admin
          .from("wedding_journeys")
          .select("progress")
          .eq("couple_id", booking.couple_id)
          .single();
        const progress: Record<string, unknown> = (journeyRow?.progress as Record<string, unknown>) ?? {};
        const nextProgress: Record<string, unknown> = { ...progress };

        const events = (progress.__events as ScheduleEvent[] | undefined) ?? [];
        const filtered = events.filter((e) => e.id !== eventIdToRemove);
        let changed = false;
        if (filtered.length !== events.length) {
          nextProgress.__events = filtered;
          changed = true;
        }

        if (categoryKey && cancelAmount > 0) {
          const cat = (progress[categoryKey] as Record<string, unknown> | undefined) ?? {};
          const prevSpent = (cat.spent as number | undefined) ?? 0;
          nextProgress[categoryKey] = {
            ...cat,
            spent: Math.max(0, prevSpent - cancelAmount),
          };
          changed = true;
        }

        if (changed) {
          await admin
            .from("wedding_journeys")
            .update({ progress: nextProgress })
            .eq("couple_id", booking.couple_id);
        }
      } catch (syncErr) {
        // sync 실패해도 booking 상태 변경 자체는 성공 — non-fatal
        console.error("[vendor cancel] auto-revert (schedule+budget) failed:", syncErr);
      }
    }

    return NextResponse.json({ booking: data });
  } catch (err) {
    console.error("Booking status update error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
