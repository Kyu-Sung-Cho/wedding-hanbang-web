// 결제 환불 처리 (토스페이먼츠)
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cancelPayment } from "@/lib/toss/client";
import { PaymentRow, paymentRowToModel } from "@/types/contract.types";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

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
    const { data: updated, error } = await supabase
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
    await supabase
      .from("contracts")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason || "고객 요청 환불",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.contract_id);

    // 예약 상태 업데이트
    await supabase
      .from("vendor_bookings")
      .update({ status: "cancelled", payment_status: "refunded" })
      .eq("id", payment.booking_id);

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
