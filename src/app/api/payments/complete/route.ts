// 결제 완료 처리 — 포트원 검증 + DB 업데이트
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPayment } from "@/lib/portone/client";
import { PaymentRow, paymentRowToModel } from "@/types/contract.types";

const COMMISSION_RATE = 0.1; // 기본 수수료율 10%

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const { paymentId, portonePaymentId } = body;

    if (!paymentId || !portonePaymentId) {
      return NextResponse.json(
        { error: "결제 ID와 포트원 결제 ID는 필수입니다." },
        { status: 400 }
      );
    }

    // DB에서 결제 레코드 조회
    const { data: payment } = await supabase
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .eq("customer_id", user.id)
      .single();

    if (!payment) {
      return NextResponse.json({ error: "결제를 찾을 수 없습니다." }, { status: 404 });
    }

    if (payment.status === "paid") {
      return NextResponse.json({ error: "이미 결제가 완료되었습니다." }, { status: 400 });
    }

    // 포트원 API로 결제 검증
    let portonePayment;
    try {
      portonePayment = await getPayment(portonePaymentId);
    } catch {
      // 개발 모드에서만 결제 검증 스킵 허용
      if (process.env.NODE_ENV === "development") {
        console.warn("포트원 API 검증 스킵 (개발 모드)");
        portonePayment = {
          status: "PAID",
          amount: { total: payment.amount },
          method: { type: "CARD" },
        };
      } else {
        return NextResponse.json({ error: "결제 검증에 실패했습니다." }, { status: 500 });
      }
    }

    // 금액 검증
    if (portonePayment.status !== "PAID") {
      await supabase
        .from("payments")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          fail_reason: `결제 상태: ${portonePayment.status}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", paymentId);

      return NextResponse.json({ error: "결제가 완료되지 않았습니다." }, { status: 400 });
    }

    if (portonePayment.amount?.total !== payment.amount) {
      await supabase
        .from("payments")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          fail_reason: `금액 불일치: 예상 ${payment.amount} / 실제 ${portonePayment.amount?.total}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", paymentId);

      return NextResponse.json({ error: "결제 금액이 일치하지 않습니다." }, { status: 400 });
    }

    // 결제 방식 매핑
    const methodMap: Record<string, string> = {
      CARD: "card",
      NAVERPAY: "naverpay",
      KAKAOPAY: "kakaopay",
      TOSSPAY: "tosspay",
      TRANSFER: "transfer",
      VIRTUAL_ACCOUNT: "vbank",
    };

    // 결제 완료 처리
    const { data: updated, error } = await supabase
      .from("payments")
      .update({
        status: "paid",
        portone_payment_id: portonePaymentId,
        portone_tx_id: portonePayment.txId || null,
        method: methodMap[portonePayment.method?.type] || portonePayment.method?.type || null,
        paid_at: new Date().toISOString(),
        receipt_url: portonePayment.receiptUrl || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId)
      .select()
      .single();

    if (error) throw error;

    // 예약 상태 업데이트
    if (payment.payment_type === "deposit") {
      await supabase
        .from("vendor_bookings")
        .update({ payment_status: "deposit_paid", status: "deposit_paid" })
        .eq("id", payment.booking_id);
    }

    // 정산 레코드 자동 생성
    const commissionAmount = Math.round(payment.amount * COMMISSION_RATE);
    const settleAmount = payment.amount - commissionAmount;

    await supabase.from("settlements").insert({
      payment_id: paymentId,
      vendor_id: payment.vendor_id,
      booking_id: payment.booking_id,
      total_amount: payment.amount,
      commission_rate: COMMISSION_RATE,
      commission_amount: commissionAmount,
      settle_amount: settleAmount,
      status: "pending",
    });

    return NextResponse.json({
      payment: paymentRowToModel(updated as PaymentRow),
      message: "결제가 완료되었습니다.",
    });
  } catch (err) {
    console.error("결제 완료 처리 에러:", err);
    return NextResponse.json({ error: "결제 처리에 실패했습니다." }, { status: 500 });
  }
}
