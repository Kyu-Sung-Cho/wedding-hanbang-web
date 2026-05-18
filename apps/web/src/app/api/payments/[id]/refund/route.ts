// 결제 환불 처리 (토스페이먼츠)
import { NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelPayment } from "@/lib/toss/client";
import { PaymentRow, paymentRowToModel } from "@/types/contract.types";
import type { ScheduleEvent } from "@/types/database.types";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const admin = createAdminClient();

    const body = await req.json();
    const { reason, amount } = body;

    // 결제 조회 (본인 결제만 환불 가능)
    const { data: payment } = await supabase
      .from("payments")
      .select("*")
      .eq("id", id)
      .eq("customer_id", user.id)
      .single();

    if (!payment) {
      return NextResponse.json({ error: "결제를 찾을 수 없습니다." }, { status: 404 });
    }

    if (payment.status !== "paid") {
      return NextResponse.json({ error: "결제된 건만 환불할 수 있습니다." }, { status: 400 });
    }

    // 환불 금액 계산 (취소 정책 기반)
    const { data: contract } = await supabase
      .from("contracts")
      .select("cancellation_policy, booking_id")
      .eq("id", payment.contract_id)
      .single();

    let refundAmount = amount;
    if (!refundAmount && contract?.cancellation_policy) {
      // 예약일 기준 취소 정책 적용
      const { data: booking } = await supabase
        .from("vendor_bookings")
        .select("booking_date")
        .eq("id", contract.booking_id)
        .single();

      if (booking) {
        const daysUntil = Math.ceil(
          (new Date(booking.booking_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        const policy = (contract.cancellation_policy as { daysBefore: number; refundPercent: number }[])
          .sort((a, b) => b.daysBefore - a.daysBefore)
          .find((p) => daysUntil >= p.daysBefore);

        refundAmount = policy
          ? Math.round(payment.amount * (policy.refundPercent / 100))
          : 0;
      }
    }

    if (!refundAmount || refundAmount <= 0) {
      return NextResponse.json(
        { error: "취소 정책에 따라 환불이 불가합니다." },
        { status: 400 }
      );
    }

    // 토스 환불 요청
    if (payment.toss_payment_key) {
      try {
        await cancelPayment(
          payment.toss_payment_key,
          reason || "고객 요청 환불",
          refundAmount < payment.amount ? refundAmount : undefined
        );
      } catch (err) {
        console.error("토스 환불 실패:", err);
        if (process.env.NODE_ENV !== "development") {
          return NextResponse.json({ error: "환불 처리에 실패했습니다." }, { status: 500 });
        }
      }
    }

    // DB 업데이트
    const { data: updated, error } = await admin
      .from("payments")
      .update({
        status: "refunded",
        refunded_at: new Date().toISOString(),
        refund_amount: refundAmount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // 계약 취소 처리
    await admin
      .from("contracts")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason || "고객 요청 환불",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.contract_id);

    // 예약 상태 업데이트 — sync 용으로 결과(amount, vendor_id, couple_id) 함께 받음
    const { data: bookingForSync } = await admin
      .from("vendor_bookings")
      .update({ status: "cancelled", payment_status: "refunded" })
      .eq("id", payment.booking_id)
      .select("id, couple_id, amount, vendor_id")
      .single();

    // 예약 취소에 따른 일정·예산 역동기화 — chat path executeCancelBooking,
    // vendor portal PATCH 와 동일 패턴. 사용자가 환불 버튼으로 취소했을 때
    // 대시보드 '다가오는 일정'과 예산 spent 에서도 자동 정리. (이슈: 취소된
    // booking이 progress.__events에 남아 AI 컨텍스트와 대시보드에 계속 노출됨)
    if (bookingForSync?.couple_id) {
      try {
        const { data: vendorRow } = await admin
          .from("vendors")
          .select("category")
          .eq("id", bookingForSync.vendor_id)
          .single();
        const categoryKey = (vendorRow?.category as string | null) ?? null;
        const eventIdToRemove = `evt_booking_${bookingForSync.id.slice(0, 8)}`;
        const cancelAmount = (bookingForSync.amount as number | undefined) ?? 0;

        const { data: journeyRow } = await admin
          .from("wedding_journeys")
          .select("progress")
          .eq("couple_id", bookingForSync.couple_id)
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
            .eq("couple_id", bookingForSync.couple_id);
        }
      } catch (syncErr) {
        // sync 실패해도 환불 자체는 이미 성공 — non-fatal
        console.error("[refund] auto-revert (schedule+budget) failed:", syncErr);
      }
    }

    return NextResponse.json({
      payment: paymentRowToModel(updated as PaymentRow),
      refundAmount,
      message: "환불이 처리되었습니다.",
    });
  } catch (err) {
    console.error("환불 처리 에러:", err);
    return NextResponse.json({ error: "환불 처리에 실패했습니다." }, { status: 500 });
  }
}
