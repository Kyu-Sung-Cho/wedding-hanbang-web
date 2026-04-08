"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Calendar,
  FileText,
  CreditCard,
  ChevronRight,
  Clock,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import type { Booking } from "@/types/vendor.types";

const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

interface BookingWithExtra extends Booking {
  vendorName?: string;
  contract?: {
    id: string;
    status: string;
    contractAmount: number;
    depositAmount: number;
  } | null;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "대기 중", color: "text-gold bg-gold/10" },
  confirmed: { label: "확인됨", color: "text-blue-600 bg-blue-500/10" },
  draft: { label: "계약 작성 중", color: "text-taupe-500 bg-taupe-400/10" },
  sent: { label: "계약서 도착", color: "text-purple-600 bg-purple-500/10" },
  viewed: { label: "계약서 확인", color: "text-purple-600 bg-purple-500/10" },
  signed: { label: "계약 완료", color: "text-[#2E7D5A] bg-[#2E7D5A]/10" },
  deposit_paid: { label: "결제 완료", color: "text-[#2E7D5A] bg-[#2E7D5A]/10" },
  in_service: { label: "서비스 진행 중", color: "text-blue-600 bg-blue-500/10" },
  service_completed: { label: "서비스 완료", color: "text-[#2E7D5A] bg-[#2E7D5A]/10" },
  settled: { label: "정산 완료", color: "text-taupe-500 bg-taupe-400/10" },
  completed: { label: "완료", color: "text-taupe-500 bg-taupe-400/10" },
  cancelled: { label: "취소", color: "text-red-500 bg-red-500/10" },
};

function formatPrice(price: number): string {
  if (price >= 10000) return `${(price / 10000).toFixed(0)}만원`;
  return `${price.toLocaleString()}원`;
}

export default function BookingsPage() {
  const [bookings, setBookings] = useState<BookingWithExtra[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/bookings/mine")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setBookings(data.bookings ?? []);
        }
      })
      .catch(() => setError("예약 목록을 불러오는데 실패했습니다."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-[875px] mx-auto flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-[875px] mx-auto text-center py-20">
        <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <p className="text-[23px] text-taupe-500">{error}</p>
      </div>
    );
  }

  const upcoming = bookings.filter(
    (b) => b.status !== "cancelled" && b.status !== "completed" && new Date(b.bookingDate) >= new Date()
  );
  const past = bookings.filter(
    (b) => b.status === "completed" || b.status === "cancelled" || new Date(b.bookingDate) < new Date()
  );

  return (
    <div className="max-w-[875px] mx-auto">
      <motion.div {...fadeIn} transition={{ duration: 0.5 }}>
        <h1 className="font-serif-kr text-[35px] text-noir-800 mb-1">내 예약</h1>
        <p className="text-[23px] text-taupe-500 font-light mb-6">
          예약 현황과 계약 상태를 확인하세요
        </p>
      </motion.div>

      {bookings.length === 0 ? (
        <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.1 }} className="bg-white rounded-2xl border border-black/[0.04] p-12 text-center">
          <Calendar className="w-12 h-12 text-taupe-400/40 mx-auto mb-4" />
          <p className="text-[38px] text-taupe-500 mb-2">아직 예약이 없습니다</p>
          <p className="text-[25px] text-taupe-400 font-light mb-6">
            업체를 둘러보고 첫 예약을 잡아보세요
          </p>
          <Link
            href="/vendors"
            className="inline-flex items-center gap-2 px-5 py-3 bg-noir-800 text-white rounded-xl text-[25px] font-medium hover:bg-noir-soft transition-colors"
          >
            업체 둘러보기
          </Link>
        </motion.div>
      ) : (
        <>
          {/* 진행 중 예약 */}
          {upcoming.length > 0 && (
            <div className="mb-8">
              <h2 className="text-[23px] font-medium text-noir-800 mb-3">진행 중</h2>
              <div className="space-y-3">
                {upcoming.map((booking, i) => {
                  const statusConfig = STATUS_LABELS[booking.contractStatus ?? booking.status] ?? STATUS_LABELS[booking.status];
                  const needsAction = booking.contract?.status === "sent" || booking.contract?.status === "viewed";

                  return (
                    <motion.div key={booking.id} {...fadeIn} transition={{ duration: 0.4, delay: i * 0.05 }}>
                      <Link
                        href={`/bookings/${booking.id}`}
                        className="block bg-white rounded-2xl border border-black/[0.04] px-5 py-4 hover:border-rose-500/30 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-[38px] font-medium text-noir-800 truncate">
                                {booking.vendorName}
                              </h3>
                              <span className={`px-2 py-0.5 rounded-full text-[25px] font-medium ${statusConfig?.color ?? ""}`}>
                                {statusConfig?.label ?? booking.status}
                              </span>
                              {needsAction && (
                                <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-rose-500/10 text-[25px] text-rose-500 font-medium animate-pulse">
                                  <AlertCircle className="w-2.5 h-2.5" />
                                  서명 필요
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[38px] text-taupe-400">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {new Date(booking.bookingDate).toLocaleDateString("ko-KR")}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {booking.bookingTime}
                              </span>
                              {booking.productName && <span>{booking.productName}</span>}
                              {booking.amount > 0 && <span>{formatPrice(booking.amount)}</span>}
                            </div>

                            {/* 진행 바 */}
                            <div className="flex items-center gap-1.5 mt-2">
                              {[
                                { label: "예약", done: true, icon: Calendar },
                                { label: "계약", done: !!booking.contract, icon: FileText },
                                { label: "서명", done: booking.contract?.status === "signed", icon: CheckCircle },
                                { label: "결제", done: booking.paymentStatus === "deposit_paid", icon: CreditCard },
                              ].map((step, idx) => (
                                <div key={idx} className="flex items-center gap-1">
                                  {idx > 0 && (
                                    <div className={`w-4 h-px ${step.done ? "bg-[#2E7D5A]" : "bg-taupe-400/20"}`} />
                                  )}
                                  <div
                                    className={`w-5 h-5 rounded-full flex items-center justify-center ${
                                      step.done ? "bg-[#2E7D5A]/10" : "bg-taupe-400/10"
                                    }`}
                                  >
                                    <step.icon
                                      className={`w-2.5 h-2.5 ${step.done ? "text-[#2E7D5A]" : "text-taupe-400"}`}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-taupe-400 flex-shrink-0" />
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 지난 예약 */}
          {past.length > 0 && (
            <div>
              <h2 className="text-[23px] font-medium text-taupe-500 mb-3">지난 예약</h2>
              <div className="space-y-2">
                {past.map((booking) => {
                  const statusConfig = STATUS_LABELS[booking.status];
                  return (
                    <Link
                      key={booking.id}
                      href={`/bookings/${booking.id}`}
                      className="flex items-center gap-4 bg-white/60 rounded-xl border border-black/[0.03] px-4 py-3 hover:bg-white transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[23px] text-taupe-500 truncate">
                            {booking.vendorName}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[25px] font-medium ${statusConfig?.color ?? ""}`}>
                            {statusConfig?.label ?? booking.status}
                          </span>
                        </div>
                        <span className="text-[38px] text-taupe-400">
                          {new Date(booking.bookingDate).toLocaleDateString("ko-KR")}
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-taupe-400/40" />
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
