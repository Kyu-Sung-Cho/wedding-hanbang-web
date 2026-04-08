"use client";

import { useState, useEffect, use, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar,
  Clock,
  FileText,
  CheckCircle,
  CreditCard,
  ArrowLeft,
  AlertCircle,
  Shield,
  ChevronDown,
  ChevronUp,
  Check,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import type { Contract, ContractClause, CancellationPolicyItem } from "@/types/contract.types";

const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

const STATUS_LABELS: Record<string, string> = {
  pending: "대기 중",
  confirmed: "확인됨",
  draft: "계약 작성 중",
  sent: "계약서 도착",
  viewed: "계약서 확인",
  signed: "계약 완료",
  deposit_paid: "결제 완료",
  in_service: "서비스 진행 중",
  service_completed: "서비스 완료",
  settled: "정산 완료",
  completed: "완료",
  cancelled: "취소",
};

function formatPrice(price: number): string {
  if (price >= 10000) return `${(price / 10000).toFixed(price % 10000 === 0 ? 0 : 1)}만원`;
  return `${price.toLocaleString()}원`;
}

interface BookingDetail {
  id: string;
  bookingDate: string;
  bookingTime: string;
  status: string;
  contractStatus?: string;
  paymentStatus?: string;
  amount: number;
  brideName: string;
  groomName: string;
  productName?: string;
  vendorName?: string;
  vendorCategory?: string;
  memo: string;
}

export default function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedClauses, setExpandedClauses] = useState(true);
  const [expandedPolicy, setExpandedPolicy] = useState(false);

  // 서명 관련
  const [signName, setSignName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signSuccess, setSignSuccess] = useState(false);

  // 결제 관련
  const [paying, setPaying] = useState(false);
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // 환불/취소 관련
  const [refunding, setRefunding] = useState(false);
  const [refunded, setRefunded] = useState(false);

  // 토스 결제 성공 리다이렉트 처리
  const handleTossCallback = useCallback(async () => {
    const paymentKey = searchParams.get("paymentKey");
    const tossOrderId = searchParams.get("orderId");
    const tossAmount = searchParams.get("amount");
    const tossPaymentId = searchParams.get("tossPaymentId");

    if (!paymentKey || !tossOrderId || !tossAmount || !tossPaymentId) return;

    setConfirming(true);
    try {
      const res = await fetch("/api/payments/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId: tossPaymentId,
          paymentKey,
          orderId: tossOrderId,
          amount: Number(tossAmount),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPaymentComplete(true);
      } else {
        alert(data.error || "결제 확인에 실패했습니다.");
      }
    } catch {
      alert("결제 확인 중 오류가 발생했습니다.");
    } finally {
      setConfirming(false);
      // URL에서 결제 파라미터 제거
      router.replace(`/bookings/${id}`);
    }
  }, [searchParams, id, router]);

  // 결제 실패 리다이렉트 처리
  useEffect(() => {
    const failMessage = searchParams.get("message");
    if (searchParams.get("payment_fail") === "true" && failMessage) {
      alert(`결제 실패: ${failMessage}`);
      router.replace(`/bookings/${id}`);
    }
  }, [searchParams, id, router]);

  useEffect(() => {
    handleTossCallback();
  }, [handleTossCallback]);

  useEffect(() => {
    async function load() {
      try {
        const bookingRes = await fetch("/api/bookings/mine");
        const bookingData = await bookingRes.json();
        const found = (bookingData.bookings ?? []).find(
          (b: BookingDetail & { contract?: { id: string }; payment?: { id: string } }) => b.id === id
        );
        if (found) {
          setBooking(found);
          if (found.paymentStatus === "deposit_paid") {
            setPaymentComplete(true);
          }
          if (found.payment?.id) {
            setPaymentId(found.payment.id);
          }
          if (found.contract?.id) {
            const contractRes = await fetch(`/api/contracts/${found.contract.id}`);
            const contractData = await contractRes.json();
            if (contractData.contract) {
              setContract(contractData.contract);
            }
          }
        }
      } catch {
        console.error("데이터 로드 실패");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const handleSign = async () => {
    if (!contract || !signName.trim() || !agreed) return;
    setSigning(true);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedName: signName.trim(), agreed: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setContract(data.contract);
        setSignSuccess(true);
      } else {
        alert(data.error || "서명에 실패했습니다.");
      }
    } catch {
      alert("서명 처리 중 오류가 발생했습니다.");
    } finally {
      setSigning(false);
    }
  };

  const handlePayment = async () => {
    if (!contract) return;
    setPaying(true);
    try {
      // 1. 결제 사전등록 (orderId 발급)
      const prepareRes = await fetch("/api/payments/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractId: contract.id,
          paymentType: "deposit",
        }),
      });
      const prepareData = await prepareRes.json();
      if (!prepareRes.ok) {
        alert(prepareData.error || "결제 준비에 실패했습니다.");
        return;
      }

      // 2. 토스 SDK 로드 + 결제 요청 (리다이렉트)
      const clientKey = prepareData.clientKey;
      if (!clientKey) {
        alert("결제 설정이 완료되지 않았습니다. 관리자에게 문의하세요.");
        return;
      }

      const tossPayments = await loadTossPayments(clientKey);
      const payment = tossPayments.payment({ customerKey: `customer_${contract.customerId}` });

      const currentUrl = `${window.location.origin}/bookings/${id}`;
      await payment.requestPayment({
        method: "CARD",
        amount: { currency: "KRW", value: prepareData.amount },
        orderId: prepareData.orderId,
        orderName: `${contract.vendorName ?? "웨딩한방"} 계약금`,
        successUrl: `${currentUrl}?tossPaymentId=${prepareData.paymentId}`,
        failUrl: `${currentUrl}?payment_fail=true`,
      });
    } catch {
      alert("결제 중 오류가 발생했습니다.");
    } finally {
      setPaying(false);
    }
  };

  const handleRefund = async () => {
    if (!paymentId) return;
    if (!confirm("정말 계약금 환불을 요청하시겠습니까? 취소 정책에 따라 환불 금액이 달라질 수 있습니다.")) return;
    setRefunding(true);
    try {
      const res = await fetch(`/api/payments/${paymentId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "고객 요청 취소" }),
      });
      const data = await res.json();
      if (res.ok) {
        setRefunded(true);
        setPaymentComplete(false);
      } else {
        alert(data.error || "환불 처리에 실패했습니다.");
      }
    } catch {
      alert("환불 처리 중 오류가 발생했습니다.");
    } finally {
      setRefunding(false);
    }
  };

  if (loading || confirming) {
    return (
      <div className="max-w-[875px] mx-auto flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          {confirming && <p className="text-[25px] text-taupe-500">결제 확인 중...</p>}
        </div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="max-w-[875px] mx-auto text-center py-20">
        <p className="text-[38px] text-taupe-500">예약을 찾을 수 없습니다</p>
        <Link href="/bookings" className="text-[25px] text-rose-500 mt-4 inline-block">
          예약 목록으로 돌아가기
        </Link>
      </div>
    );
  }

  const isSigned = contract?.status === "signed";
  const canSign = contract && (contract.status === "sent" || contract.status === "viewed");
  const displayStatus = STATUS_LABELS[booking.contractStatus ?? booking.status] ?? booking.status;

  return (
    <div className="max-w-[875px] mx-auto pb-10">
      {/* 뒤로가기 */}
      <motion.div {...fadeIn} transition={{ duration: 0.3 }}>
        <Link
          href="/bookings"
          className="inline-flex items-center gap-1.5 text-[25px] text-taupe-500 hover:text-noir-800 transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          내 예약
        </Link>
      </motion.div>

      {/* 예약 정보 카드 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5 }}
        className="bg-white rounded-2xl border border-black/[0.04] p-6 mb-4"
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="font-serif-kr text-[25px] text-noir-800">{booking.vendorName}</h1>
            {booking.productName && (
              <p className="text-[23px] text-taupe-500 mt-0.5">{booking.productName}</p>
            )}
          </div>
          <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-600 text-[38px] font-medium">
            {displayStatus}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 text-[25px] text-charcoal">
            <Calendar className="w-4 h-4 text-taupe-400" />
            {new Date(booking.bookingDate).toLocaleDateString("ko-KR", {
              year: "numeric",
              month: "long",
              day: "numeric",
              weekday: "short",
            })}
          </div>
          <div className="flex items-center gap-2 text-[25px] text-charcoal">
            <Clock className="w-4 h-4 text-taupe-400" />
            {booking.bookingTime}
          </div>
          {booking.amount > 0 && (
            <div className="flex items-center gap-2 text-[25px] text-charcoal">
              <CreditCard className="w-4 h-4 text-taupe-400" />
              {formatPrice(booking.amount)}
            </div>
          )}
        </div>
      </motion.div>

      {/* 진행 상태 스텝 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="bg-white rounded-2xl border border-black/[0.04] p-6 mb-4"
      >
        <h2 className="text-[23px] font-medium text-noir-800 mb-4">진행 현황</h2>
        <div className="flex items-center justify-between">
          {[
            { label: "예약 확인", done: true },
            { label: "계약서 확인", done: !!contract },
            { label: "계약 서명", done: isSigned || signSuccess },
            { label: "계약금 결제", done: paymentComplete || booking.paymentStatus === "deposit_paid" },
          ].map((step, idx) => (
            <div key={idx} className="flex items-center gap-2 flex-1">
              {idx > 0 && (
                <div
                  className={`flex-1 h-px ${step.done ? "bg-[#2E7D5A]" : "bg-taupe-400/20"}`}
                />
              )}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    step.done
                      ? "bg-[#2E7D5A] text-white"
                      : "bg-taupe-400/10 text-taupe-400"
                  }`}
                >
                  {step.done ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <span className="text-[38px] font-medium">{idx + 1}</span>
                  )}
                </div>
                <span
                  className={`text-[23px] whitespace-nowrap ${
                    step.done ? "text-[#2E7D5A] font-medium" : "text-taupe-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* 계약서 없음 */}
      {!contract && (
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-white rounded-2xl border border-black/[0.04] p-8 text-center"
        >
          <FileText className="w-10 h-10 text-taupe-400/40 mx-auto mb-3" />
          <p className="text-[23px] text-taupe-500 mb-1">아직 계약서가 도착하지 않았습니다</p>
          <p className="text-[38px] text-taupe-400 font-light">
            업체에서 계약서를 전송하면 여기에 표시됩니다
          </p>
        </motion.div>
      )}

      {/* 계약서 내용 */}
      {contract && (
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden mb-4"
        >
          {/* 계약 헤더 */}
          <div className="p-6 border-b border-black/[0.03]">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-5 h-5 text-rose-500" />
              <h2 className="text-[21px] font-medium text-noir-800">계약서</h2>
              {isSigned && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#2E7D5A]/10 text-[23px] text-[#2E7D5A] font-medium">
                  <CheckCircle className="w-3 h-3" />
                  서명 완료
                </span>
              )}
            </div>
            <p className="text-[25px] text-taupe-500">
              {contract.vendorName} — {contract.productName}
            </p>
          </div>

          {/* 금액 정보 */}
          <div className="px-6 py-4 bg-ivory-50/50 border-b border-black/[0.03]">
            <div className="flex justify-between text-[23px] mb-2">
              <span className="text-taupe-500">총 계약 금액</span>
              <span className="font-medium text-noir-800">
                {formatPrice(contract.contractAmount)}
              </span>
            </div>
            <div className="flex justify-between text-[23px]">
              <span className="text-taupe-500">
                계약금 ({Math.round(contract.depositRate * 100)}%)
              </span>
              <span className="font-medium text-rose-500">
                {formatPrice(contract.depositAmount)}
              </span>
            </div>
          </div>

          {/* 조항 */}
          <div className="px-6 py-4">
            <button
              onClick={() => setExpandedClauses(!expandedClauses)}
              className="flex items-center justify-between w-full text-left mb-3"
            >
              <span className="text-[25px] font-medium text-noir-800">
                계약 조항 ({contract.content.length}개)
              </span>
              {expandedClauses ? (
                <ChevronUp className="w-4 h-4 text-taupe-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-taupe-400" />
              )}
            </button>
            <AnimatePresence>
              {expandedClauses && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="space-y-3 overflow-hidden"
                >
                  {(contract.content as ContractClause[]).map((clause, idx) => (
                    <div
                      key={idx}
                      className="bg-ivory-50/80 rounded-lg px-4 py-3 border border-black/[0.03]"
                    >
                      <p className="text-[38px] text-rose-500 font-medium mb-1">
                        제{idx + 1}조 {clause.title}
                      </p>
                      <p className="text-[25px] text-charcoal leading-relaxed whitespace-pre-wrap">
                        {clause.body}
                      </p>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 취소 정책 */}
          {contract.cancellationPolicy.length > 0 && (
            <div className="px-6 py-4 border-t border-black/[0.03]">
              <button
                onClick={() => setExpandedPolicy(!expandedPolicy)}
                className="flex items-center justify-between w-full text-left mb-3"
              >
                <span className="text-[25px] font-medium text-noir-800">취소/환불 정책</span>
                {expandedPolicy ? (
                  <ChevronUp className="w-4 h-4 text-taupe-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-taupe-400" />
                )}
              </button>
              <AnimatePresence>
                {expandedPolicy && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="space-y-2 overflow-hidden"
                  >
                    {(contract.cancellationPolicy as CancellationPolicyItem[]).map((p, idx) => (
                      <div
                        key={idx}
                        className={`flex items-center justify-between px-4 py-2.5 rounded-lg ${
                          p.refundPercent >= 80
                            ? "bg-[#2E7D5A]/5"
                            : p.refundPercent >= 50
                              ? "bg-gold/5"
                              : p.refundPercent > 0
                                ? "bg-orange-500/5"
                                : "bg-red-500/5"
                        }`}
                      >
                        <span className="text-[25px] text-charcoal">
                          서비스 {p.daysBefore}일 전
                        </span>
                        <span
                          className={`text-[25px] font-medium ${
                            p.refundPercent >= 80
                              ? "text-[#2E7D5A]"
                              : p.refundPercent >= 50
                                ? "text-gold"
                                : p.refundPercent > 0
                                  ? "text-orange-600"
                                  : "text-red-500"
                          }`}
                        >
                          {p.refundPercent}% 환불
                        </span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* 서명 섹션 */}
          {canSign && !signSuccess && (
            <div className="px-6 py-6 border-t border-black/[0.03] bg-gradient-to-b from-ivory-50/50 to-white">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-5 h-5 text-rose-500" />
                <h3 className="text-[38px] font-medium text-noir-800">계약 서명</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[38px] font-medium text-noir-800 mb-1.5">
                    서명자 이름 (본인 확인)
                  </label>
                  <input
                    type="text"
                    value={signName}
                    onChange={(e) => setSignName(e.target.value)}
                    placeholder="본인 이름을 입력하세요"
                    className="w-full px-4 py-3 border border-platinum rounded-xl text-[23px] outline-none focus:border-rose-500 transition-colors"
                  />
                </div>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="w-5 h-5 accent-rose-500 rounded mt-0.5"
                  />
                  <span className="text-[25px] text-charcoal leading-relaxed">
                    상기 계약 내용과 취소/환불 정책을 모두 확인하였으며, 이에 동의합니다.
                    계약 서명 후 취소 시 취소 정책에 따라 환불이 진행됩니다.
                  </span>
                </label>

                <button
                  onClick={handleSign}
                  disabled={signing || !signName.trim() || !agreed}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-rose-500 to-gold text-white text-[38px] font-medium hover:shadow-[0_4px_20px_rgba(196,150,126,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {signing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      서명 처리 중...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      계약서에 서명하기
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* 서명 완료 */}
          {(isSigned || signSuccess) && (
            <div className="px-6 py-6 border-t border-black/[0.03] bg-[#2E7D5A]/5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-[#2E7D5A] flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-[38px] font-medium text-[#2E7D5A]">계약 서명 완료</p>
                  <p className="text-[38px] text-taupe-500">
                    {contract?.signedName}님이{" "}
                    {contract?.signedAt
                      ? new Date(contract.signedAt).toLocaleDateString("ko-KR")
                      : ""}
                    에 서명
                  </p>
                </div>
              </div>

              {/* 결제 버튼 (서명 완료 후) */}
              {!paymentComplete ? (
                <div className="mt-4 p-4 bg-white rounded-xl border border-[#2E7D5A]/20">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[25px] text-taupe-500">계약금 결제</span>
                    <span className="text-[38px] font-medium text-rose-500">
                      {formatPrice(contract?.depositAmount ?? 0)}
                    </span>
                  </div>
                  <button
                    disabled={paying}
                    className="w-full py-3.5 rounded-xl bg-noir-800 text-white text-[23px] font-medium hover:bg-noir-soft transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    onClick={handlePayment}
                  >
                    {paying ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        결제 처리 중...
                      </>
                    ) : (
                      <>
                        <CreditCard className="w-4 h-4" />
                        계약금 결제하기
                      </>
                    )}
                  </button>
                  <p className="text-[23px] text-taupe-400 text-center mt-2">
                    카드 / 계좌이체 / 간편결제 (토스페이먼츠)
                  </p>
                </div>
              ) : refunded ? (
                <div className="mt-4 p-4 bg-red-500/10 rounded-xl border border-red-500/20 text-center">
                  <XCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                  <p className="text-[38px] font-medium text-red-500">환불 처리 완료</p>
                  <p className="text-[38px] text-taupe-500 mt-1">
                    환불이 요청되었습니다. 처리까지 1~3 영업일이 소요될 수 있습니다.
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="p-4 bg-[#2E7D5A]/10 rounded-xl border border-[#2E7D5A]/20 text-center">
                    <CheckCircle className="w-8 h-8 text-[#2E7D5A] mx-auto mb-2" />
                    <p className="text-[38px] font-medium text-[#2E7D5A]">계약금 결제 완료</p>
                    <p className="text-[38px] text-taupe-500 mt-1">
                      {formatPrice(contract?.depositAmount ?? 0)} 결제가 완료되었습니다
                    </p>
                  </div>
                  {paymentId && booking.status !== "service_completed" && booking.status !== "completed" && booking.status !== "settled" && (
                    <button
                      onClick={handleRefund}
                      disabled={refunding}
                      className="w-full py-3 rounded-xl border border-red-200 text-red-500 text-[25px] font-medium hover:bg-red-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {refunding ? (
                        <>
                          <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                          환불 처리 중...
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4" />
                          계약금 환불 요청
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}

      {/* 주의사항 */}
      {canSign && (
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="bg-gold/5 border border-gold/20 rounded-xl px-5 py-4 flex items-start gap-3"
        >
          <AlertCircle className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
          <div className="text-[38px] text-charcoal leading-relaxed">
            <p className="font-medium mb-1">서명 전 확인사항</p>
            <ul className="list-disc list-inside text-taupe-500 space-y-0.5">
              <li>계약 조항과 취소/환불 정책을 반드시 확인해주세요</li>
              <li>서명 후에는 취소 정책에 따라 환불이 진행됩니다</li>
              <li>문의사항은 업체에 직접 메시지를 보내주세요</li>
            </ul>
          </div>
        </motion.div>
      )}
    </div>
  );
}
