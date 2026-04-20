"use client";

import { useState, useEffect } from "react";
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
  pending: { label: "대기 중", color: "text-[#946a6a] bg-[#795252]/10" },
  confirmed: { label: "확인됨", color: "text-[#795252] bg-[#795252]/15" },
  draft: { label: "계약 작성 중", color: "text-[#504444] bg-[#F6F3F2]" },
  sent: { label: "계약서 도착", color: "text-[#795252] bg-[#795252]/10" },
  viewed: { label: "계약서 확인", color: "text-[#795252] bg-[#795252]/10" },
  signed: { label: "계약 완료", color: "text-white bg-[#795252]" },
  deposit_paid: { label: "결제 완료", color: "text-white bg-[#795252]" },
  in_service: { label: "서비스 진행 중", color: "text-[#795252] bg-[#795252]/15" },
  service_completed: { label: "서비스 완료", color: "text-white bg-[#795252]" },
  settled: { label: "정산 완료", color: "text-[#504444] bg-[#F6F3F2]" },
  completed: { label: "완료", color: "text-[#504444] bg-[#F6F3F2]" },
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
      <div className="max-w-[700px] mx-auto flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#795252] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-[700px] mx-auto text-center py-20">
        <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <p className="text-base text-[#504444]">{error}</p>
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
    <div className="max-w-[700px] mx-auto">
      <div className="animate-fade-in mb-6">
        <h1 className="font-serif-kr text-4xl font-light text-[#1A1A1F] tracking-tight mb-2">내 예약</h1>
        <p className="text-base text-[#B5ADA3] font-light">
          예약 현황과 계약 상태를 확인하세요
        </p>
      </div>

      {bookings.length === 0 ? (
        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-12 text-center animate-fade-in">
          <Calendar className="w-14 h-14 text-[#B5ADA3] mx-auto mb-4" />
          <p className="text-lg text-[#504444] mb-2">아직 예약이 없습니다</p>
          <p className="text-base text-[#B5ADA3] font-light mb-6">
            업체를 둘러보고 첫 예약을 잡아보세요
          </p>
          <Link
            href="/vendors"
            className="inline-flex items-center gap-2 px-6 py-3.5 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-xl text-base font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)] transition-all"
          >
            업체 둘러보기
          </Link>
        </div>
      ) : (
        <>
          {/* 진행 중 예약 */}
          {upcoming.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-medium text-[#B5ADA3] uppercase tracking-[0.12em] mb-3">진행 중</h2>
              <div className="space-y-3">
                {upcoming.map((booking) => {
                  const statusConfig = STATUS_LABELS[booking.contractStatus ?? booking.status] ?? STATUS_LABELS[booking.status];
                  const needsAction = booking.contract?.status === "sent" || booking.contract?.status === "viewed";

                  return (
                    <div key={booking.id} className="animate-fade-in">
                      <Link
                        href={`/bookings/${booking.id}`}
                        className="block bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] px-6 py-5 hover:shadow-[0_12px_40px_rgb(0,0,0,0.06)] transition-shadow"
                      >
                        <div className="flex items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <h3 className="font-serif-kr text-xl font-light text-[#1A1A1F] truncate">
                                {booking.vendorName}
                              </h3>
                              <span className={`px-2.5 py-0.5 rounded-full text-sm font-medium ${statusConfig?.color ?? ""}`}>
                                {statusConfig?.label ?? booking.status}
                              </span>
                              {needsAction && (
                                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#795252]/10 text-sm text-[#795252] font-medium animate-pulse">
                                  <AlertCircle className="w-4 h-4" />
                                  서명 필요
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-base text-[#B5ADA3]">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-4 h-4" />
                                {new Date(booking.bookingDate).toLocaleDateString("ko-KR")}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                {booking.bookingTime}
                              </span>
                              {booking.productName && <span>{booking.productName}</span>}
                              {booking.amount > 0 && <span>{formatPrice(booking.amount)}</span>}
                            </div>

                            {/* 진행 바 */}
                            <div className="flex items-center gap-1.5 mt-2.5">
                              {[
                                { label: "예약", done: true, icon: Calendar },
                                { label: "계약", done: !!booking.contract, icon: FileText },
                                { label: "서명", done: booking.contract?.status === "signed", icon: CheckCircle },
                                { label: "결제", done: booking.paymentStatus === "deposit_paid", icon: CreditCard },
                              ].map((step, idx) => (
                                <div key={idx} className="flex items-center gap-1">
                                  {idx > 0 && (
                                    <div className={`w-5 h-px ${step.done ? "bg-[#795252]" : "bg-[#B5ADA3]/20"}`} />
                                  )}
                                  <div
                                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                      step.done ? "bg-[#795252]/15" : "bg-[#F6F3F2]"
                                    }`}
                                  >
                                    <step.icon
                                      className={`w-4 h-4 ${step.done ? "text-[#795252]" : "text-[#B5ADA3]"}`}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-[#B5ADA3] flex-shrink-0" />
                        </div>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 지난 예약 */}
          {past.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-[#B5ADA3] uppercase tracking-[0.12em] mb-3">지난 예약</h2>
              <div className="space-y-2">
                {past.map((booking) => {
                  const statusConfig = STATUS_LABELS[booking.status];
                  return (
                    <Link
                      key={booking.id}
                      href={`/bookings/${booking.id}`}
                      className="flex items-center gap-4 bg-white/70 rounded-xl px-5 py-4 hover:bg-white hover:shadow-[0_4px_14px_0_rgba(0,0,0,0.03)] transition-all"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-base text-[#504444] truncate">
                            {booking.vendorName}
                          </span>
                          <span className={`px-2.5 py-0.5 rounded-full text-sm font-medium ${statusConfig?.color ?? ""}`}>
                            {statusConfig?.label ?? booking.status}
                          </span>
                        </div>
                        <span className="text-sm text-[#B5ADA3]">
                          {new Date(booking.bookingDate).toLocaleDateString("ko-KR")}
                        </span>
                      </div>
                      <ChevronRight className="w-5 h-5 text-[#B5ADA3]/50" />
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
