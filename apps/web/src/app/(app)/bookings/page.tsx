"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Calendar,
  Clock,
  AlertCircle,
} from "lucide-react";
import type { Booking } from "@/types/vendor.types";
import { isLocalDateOnlyBefore, parseLocalDateOnly } from "@hanbang/shared";

interface BookingWithExtra extends Booking {
  vendorName?: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "대기 중", color: "text-[#946a6a] bg-[#795252]/10" },
  confirmed: { label: "확인됨", color: "text-[#795252] bg-[#795252]/15" },
  contract_sent: { label: "계약서 발송", color: "text-[#795252] bg-[#795252]/10" },
  contract_signed: { label: "계약 완료", color: "text-[#2E7D5A] bg-[#2E7D5A]/10" },
  deposit_paid: { label: "예약금 결제", color: "text-[#2E7D5A] bg-[#2E7D5A]/10" },
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

function formatBookingDate(value: string): string {
  return parseLocalDateOnly(value)?.toLocaleDateString("ko-KR") ?? value;
}

export default function BookingsPage() {
  const [bookings, setBookings] = useState<BookingWithExtra[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/bookings/mine");
      const data = await response.json().catch(() => ({} as { error?: string; bookings?: BookingWithExtra[] }));
      if (!response.ok) throw new Error(data.error || "예약 요청 목록을 불러오지 못했습니다.");
      setBookings(Array.isArray(data.bookings) ? data.bookings : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "예약 요청 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  if (loading) {
    return (
      <div className="max-w-[700px] mx-auto flex items-center justify-center py-20" role="status" aria-live="polite">
        <div className="w-8 h-8 border-2 border-[#795252] border-t-transparent rounded-full animate-spin" aria-hidden="true" />
        <span className="sr-only">과거 요청 기록을 불러오는 중입니다.</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-[700px] mx-auto text-center py-20" role="alert">
        <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" aria-hidden="true" />
        <p className="text-base text-[#504444]">{error}</p>
        <button
          type="button"
          onClick={() => void loadBookings()}
          className="mt-4 min-h-11 rounded-full bg-[#36534E] px-5 text-sm font-semibold text-white"
        >
          다시 불러오기
        </button>
      </div>
    );
  }

  const isFinished = (booking: BookingWithExtra) =>
    booking.status === "completed"
    || booking.status === "service_completed"
    || booking.status === "settled"
    || booking.status === "cancelled";
  const upcoming = bookings.filter((booking) => !isFinished(booking) && !isLocalDateOnlyBefore(booking.bookingDate));
  const past = bookings.filter((booking) => isFinished(booking) || isLocalDateOnlyBefore(booking.bookingDate));

  return (
    <div className="mx-auto max-w-[860px]">
      <div className="mb-5 rounded-[18px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] animate-fade-in sm:p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">
          WEDDING HANBANG
        </p>
        <h1 className="mt-1 font-serif-kr text-[26px] font-medium leading-tight text-[#071629] sm:text-[30px]">과거 요청 내역</h1>
        <p className="mt-2 text-[13px] font-medium leading-[1.65] text-[#5d6879]">
          과거·예시 요청 기록을 조회하는 화면입니다. 신규 상담 요청은 현재 받지 않습니다.
          표시된 상태는 업체 전달·수락·계약·결제의 증빙이 아니므로 실제 진행 여부는 업체에 직접 확인해 주세요.
        </p>
      </div>

      {bookings.length === 0 ? (
        <div className="rounded-[18px] border border-[#eadfc9] bg-white/90 p-8 text-center shadow-[0_8px_24px_rgba(8,22,38,0.035)] animate-fade-in">
          <Calendar className="mx-auto mb-4 h-12 w-12 text-[#36534E]/45" />
          <p className="mb-2 font-serif-kr text-[22px] font-medium text-[#071629]">저장된 과거 요청이 없습니다</p>
          <p className="text-[13px] font-medium leading-[1.65] text-[#5d6879]">
            업체 연결 준비 중이라 새 요청은 전송되거나 저장되지 않습니다.
          </p>
        </div>
      ) : (
        <>
          {/* 진행 중 예약 */}
          {upcoming.length > 0 && (
            <div className="mb-8">
              <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#7a8290]">예정일이 남은 과거 기록</h2>
              <div className="space-y-3">
                {upcoming.map((booking) => {
                  const statusConfig = STATUS_LABELS[booking.status];

                  return (
                    <div key={booking.id} className="animate-fade-in">
                      <div className="block rounded-[18px] border border-[#eadfc9] bg-white/90 px-5 py-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)]">
                        <div className="flex items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <h3 className="font-serif-kr text-[18px] font-medium leading-snug text-[#071629] truncate">
                                {booking.vendorName}
                              </h3>
                              <span className={`px-2.5 py-0.5 rounded-full text-sm font-medium ${statusConfig?.color ?? ""}`}>
                                {statusConfig?.label ?? booking.status}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-[13px] font-medium text-[#5d6879]">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-4 h-4" />
                                {formatBookingDate(booking.bookingDate)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                {booking.bookingTime}
                              </span>
                              {booking.productName && <span>{booking.productName}</span>}
                              {booking.amount > 0 && <span>{formatPrice(booking.amount)}</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 지난 예약 */}
          {past.length > 0 && (
            <div>
              <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#7a8290]">지난 기록</h2>
              <div className="space-y-2">
                {past.map((booking) => {
                  const statusConfig = STATUS_LABELS[booking.status];
                  return (
                    <div
                      key={booking.id}
                      className="flex items-center gap-4 rounded-[16px] border border-[#eadfc9]/70 bg-white/80 px-5 py-4"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-semibold text-[#071629] truncate">
                            {booking.vendorName}
                          </span>
                          <span className={`px-2.5 py-0.5 rounded-full text-sm font-medium ${statusConfig?.color ?? ""}`}>
                            {statusConfig?.label ?? booking.status}
                          </span>
                        </div>
                        <span className="text-sm text-[#B5ADA3]">
                          {formatBookingDate(booking.bookingDate)}
                        </span>
                      </div>
                    </div>
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
