// 포트원 웹훅 — 가상계좌 입금 등 비동기 결제 상태 처리
import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getPayment } from "@/lib/portone/client";

const COMMISSION_RATE = 0.1;

export async function POST(req: Request) {
  try {
    // 웹훅 시크릿 검증
    const webhookSecret = process.env.PORTONE_WEBHOOK_SECRET;
    if (webhookSecret) {
      const signature = req.headers.get("webhook-id");
      if (!signature) {
        return NextResponse.json({ error: "인증 실패" }, { status: 401 });
      }
    }

    const body = await req.json();
    const { type, data } = body;

    // 결제 완료 웹훅만 처리
    if (type !== "Transaction.Paid" && type !== "Transaction.VirtualAccountIssued") {
      return NextResponse.json({ ok: true });
    }

    const portonePaymentId = data?.paymentId;
    if (!portonePaymentId) {
      return NextResponse.json({ error: "paymentId 없음" }, { status: 400 });
    }

    // 서비스 클라이언트 사용 (웹훅에는 유저 세션 없음)
    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // DB에서 해당 포트원 결제 ID 또는 payment ID로 결제 레코드 찾기
    let payment;
    const { data: byPortone } = await supabase
      .from("payments")
      .select("*")
      .eq("portone_payment_id", portonePaymentId)
      .single();

    if (byPortone) {
      payment = byPortone;
    } else {
      // complete 전에 웹훅이 먼저 올 수 있음 — ID로 직접 검색
      const { data: byId } = await supabase
        .from("payments")
        .select("*")
        .eq("id", portonePaymentId)
        .single();
      payment = byId;
    }

    if (!payment) {
      console.log("웹훅: 매칭되는 결제 레코드 없음", portonePaymentId);
      return NextResponse.json({ ok: true });
    }

    if (payment.status === "paid") {
      return NextResponse.json({ ok: true, message: "이미 처리됨" });
    }

    // 포트원에서 최신 상태 확인
    let portonePayment;
    try {
      portonePayment = await getPayment(portonePaymentId);
    } catch {
      console.error("포트원 결제 조회 실패");
      return NextResponse.json({ error: "포트원 조회 실패" }, { status: 500 });
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

    if (portonePayment.status === "PAID" && portonePayment.amount?.total === payment.amount) {
      await supabase
        .from("payments")
        .update({
          status: "paid",
          portone_payment_id: portonePaymentId,
          paid_at: new Date().toISOString(),
          method: methodMap[portonePayment.method?.type] || portonePayment.method?.type?.toLowerCase() || null,
          receipt_url: portonePayment.receiptUrl || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payment.id);

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

        await supabase.from("settlements").insert({
          payment_id: payment.id,
          vendor_id: payment.vendor_id,
          booking_id: payment.booking_id,
          total_amount: payment.amount,
          commission_rate: COMMISSION_RATE,
          commission_amount: commissionAmount,
          settle_amount: settleAmount,
          status: "pending",
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("웹훅 처리 에러:", err);
    return NextResponse.json({ error: "웹훅 처리 실패" }, { status: 500 });
  }
}
