// 결제 사전등록 — 금액 검증 + DB에 pending 레코드 생성 + orderId 발급
import { NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { PaymentRow } from "@/types/contract.types";

export async function POST(req: Request) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const { contractId, paymentType } = body;
    const normalizedPaymentType = paymentType === "balance" ? "balance" : "deposit";

    if (!contractId) {
      return NextResponse.json({ error: "계약 ID는 필수입니다." }, { status: 400 });
    }

    // 계약 확인
    const { data: contract } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", contractId)
      .single();

    if (!contract) {
      return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    }

    if (contract.status !== "signed") {
      return NextResponse.json({ error: "서명된 계약만 결제할 수 있습니다." }, { status: 400 });
    }

    // 이미 결제된 건인지 확인
    const { data: existingPayment } = await supabase
      .from("payments")
      .select("id, status, order_id, amount")
      .eq("contract_id", contractId)
      .eq("payment_type", normalizedPaymentType)
      .in("status", ["pending", "paid"])
      .maybeSingle();

    if (existingPayment?.status === "paid") {
      return NextResponse.json({ error: "이미 결제가 완료되었습니다." }, { status: 400 });
    }

    // 기존 pending 결제가 있으면 재사용
    if (existingPayment?.status === "pending") {
      return NextResponse.json({
        paymentId: existingPayment.id,
        orderId: existingPayment.order_id,
        amount: existingPayment.amount,
        clientKey: process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY,
      });
    }

    const amount =
      normalizedPaymentType === "deposit"
        ? contract.deposit_amount
        : contract.contract_amount - contract.deposit_amount;

    // 결제 레코드 생성
    const { data: payment, error } = await supabase
      .from("payments")
      .insert({
        contract_id: contractId,
        booking_id: contract.booking_id,
        customer_id: user.id,
        vendor_id: contract.vendor_id,
        payment_type: normalizedPaymentType,
        amount,
        status: "pending",
        order_id: `wedding_${crypto.randomUUID().slice(0, 8)}`,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      paymentId: payment.id,
      orderId: (payment as PaymentRow).order_id,
      amount: (payment as PaymentRow).amount,
      clientKey: process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY,
    });
  } catch (err) {
    console.error("결제 사전등록 에러:", err);
    return NextResponse.json({ error: "결제 준비에 실패했습니다." }, { status: 500 });
  }
}
