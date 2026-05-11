// 토스페이먼츠 웹훅 — 가상계좌 입금 등 비동기 결제 상태 처리
import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getPayment } from "@/lib/toss/client";

const COMMISSION_RATE = 0.1;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { eventType, data } = body;

    // 결제 상태 변경 이벤트만 처리
    if (eventType !== "PAYMENT_STATUS_CHANGED") {
      return NextResponse.json({ ok: true });
    }

    const paymentKey = data?.paymentKey;
    const orderId = data?.orderId;
    if (!paymentKey) {
      return NextResponse.json({ error: "paymentKey 없음" }, { status: 400 });
    }

    // 서비스 클라이언트 사용 (웹훅에는 유저 세션 없음)
    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // DB에서 결제 레코드 찾기
    let payment;
    const { data: byKey } = await supabase
      .from("payments")
      .select("*")
      .eq("toss_payment_key", paymentKey)
      .single();

    if (byKey) {
      payment = byKey;
    } else if (orderId) {
      const { data: byOrder } = await supabase
        .from("payments")
        .select("*")
        .eq("order_id", orderId)
        .single();
      payment = byOrder;
    }

    if (!payment) {
      console.log("웹훅: 매칭되는 결제 레코드 없음", paymentKey);
      return NextResponse.json({ ok: true });
    }

    if (orderId && payment.order_id && orderId !== payment.order_id) {
      console.error("웹훅: orderId 불일치", { eventOrderId: orderId, paymentOrderId: payment.order_id });
      return NextResponse.json({ error: "orderId 불일치" }, { status: 400 });
    }

    if (payment.status === "paid") {
      return NextResponse.json({ ok: true, message: "이미 처리됨" });
    }

    // 토스에서 최신 상태 확인
    let tossPayment;
    try {
      tossPayment = await getPayment(paymentKey);
    } catch {
      console.error("토스 결제 조회 실패");
      return NextResponse.json({ error: "토스 조회 실패" }, { status: 500 });
    }

    // 결제 방식 매핑
    const methodMap: Record<string, string> = {
      "카드": "card",
      "가상계좌": "vbank",
      "계좌이체": "transfer",
      "휴대폰": "phone",
      "간편결제": "easypay",
    };

    if (tossPayment.orderId && payment.order_id && tossPayment.orderId !== payment.order_id) {
      console.error("웹훅: Toss orderId 불일치", { tossOrderId: tossPayment.orderId, paymentOrderId: payment.order_id });
      return NextResponse.json({ error: "Toss orderId 불일치" }, { status: 400 });
    }

    if (tossPayment.status === "DONE" && Number(tossPayment.totalAmount) === payment.amount) {
      await supabase
        .from("payments")
        .update({
          status: "paid",
          toss_payment_key: paymentKey,
          toss_transaction_key: tossPayment.transactionKey || null,
          order_id: payment.order_id,
          paid_at: new Date().toISOString(),
          method: methodMap[tossPayment.method] || tossPayment.method?.toLowerCase() || null,
          receipt_url: tossPayment.receipt?.url || null,
        })
        .eq("id", payment.id)
        .eq("status", "pending");

      // 예약 상태 업데이트
      if (payment.payment_type === "deposit") {
        await supabase
          .from("vendor_bookings")
          .update({ payment_status: "deposit_paid", status: "deposit_paid" })
          .eq("id", payment.booking_id);
      }

      // 정산 레코드 자동 생성 (중복 방지)
      const { data: existingSettlement } = await supabase
        .from("settlements")
        .select("id")
        .eq("payment_id", payment.id)
        .single();

      if (!existingSettlement) {
        const commissionAmount = Math.round(payment.amount * COMMISSION_RATE);
        const settleAmount = payment.amount - commissionAmount;

        await supabase.from("settlements").upsert({
          payment_id: payment.id,
          vendor_id: payment.vendor_id,
          booking_id: payment.booking_id,
          total_amount: payment.amount,
          commission_rate: COMMISSION_RATE,
          commission_amount: commissionAmount,
          settle_amount: settleAmount,
          status: "pending",
        }, {
          onConflict: "payment_id",
          ignoreDuplicates: true,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("웹훅 처리 에러:", err);
    return NextResponse.json({ error: "웹훅 처리 실패" }, { status: 500 });
  }
}
