// 결제 완료 처리 — 토스 confirm API + DB 업데이트
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { confirmPayment } from "@/lib/toss/client";
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
    const { paymentId, paymentKey, orderId, amount } = body;

    if (!paymentId || !paymentKey || !orderId || !amount) {
      return NextResponse.json(
        { error: "paymentId, paymentKey, orderId, amount는 필수입니다." },
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

    // 금액 검증
    if (Number(amount) !== payment.amount) {
      await supabase
        .from("payments")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          fail_reason: `금액 불일치: 예상 ${payment.amount} / 실제 ${amount}`,
        })
        .eq("id", paymentId);

      return NextResponse.json({ error: "결제 금액이 일치하지 않습니다." }, { status: 400 });
    }

    // 토스 결제 승인 API 호출
    let tossPayment;
    try {
      tossPayment = await confirmPayment(paymentKey, orderId, Number(amount));
    } catch {
      // 개발 모드에서만 검증 스킵 허용
      if (process.env.NODE_ENV === "development") {
        console.warn("토스 API 검증 스킵 (개발 모드)");
        tossPayment = {
          status: "DONE",
          totalAmount: payment.amount,
          method: "카드",
          transactionKey: "dev_tx_" + paymentId.slice(0, 8),
          receipt: { url: null },
        };
      } else {
        return NextResponse.json({ error: "결제 승인에 실패했습니다." }, { status: 500 });
      }
    }

    // 토스 결제 상태 확인
    if (tossPayment.status !== "DONE") {
      await supabase
        .from("payments")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          fail_reason: `결제 상태: ${tossPayment.status}`,
        })
        .eq("id", paymentId);

      return NextResponse.json({ error: "결제가 완료되지 않았습니다." }, { status: 400 });
    }

    // 결제 방식 매핑
    const methodMap: Record<string, string> = {
      "카드": "card",
      "가상계좌": "vbank",
      "계좌이체": "transfer",
      "휴대폰": "phone",
      "간편결제": "easypay",
    };

    // 결제 완료 처리
    const { data: updated, error } = await supabase
      .from("payments")
      .update({
        status: "paid",
        toss_payment_key: paymentKey,
        toss_transaction_key: tossPayment.transactionKey || null,
        order_id: orderId,
        method: methodMap[tossPayment.method] || tossPayment.method?.toLowerCase() || null,
        paid_at: new Date().toISOString(),
        receipt_url: tossPayment.receipt?.url || null,
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
