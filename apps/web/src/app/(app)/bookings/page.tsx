"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Calendar,
  Clock,
  AlertCircle,
} from "lucide-react";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { FEATURE_SUMMARY_CLASS, SUMMARY_LABEL_CLASS } from "@/components/ui/featureSummaryStyles";
import {
  classifyBookingDate,
  formatBookingDate,
  scheduleSeoulDateRollover,
} from "@/lib/bookings/dateClassification";
import type { Booking } from "@/types/vendor.types";

interface BookingWithExtra extends Booking {
  vendorName?: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "요청 기록됨", color: "text-[var(--hb-accent-hover)] bg-[rgba(54,83,78,0.10)]" },
  confirmed: { label: "확정 상태 기록(근거 미확인)", color: "text-[var(--hb-accent-hover)] bg-[rgba(54,83,78,0.10)]" },
  in_service: { label: "진행 기록", color: "text-[var(--hb-accent-hover)] bg-[rgba(54,83,78,0.10)]" },
  service_completed: { label: "진행 완료 기록", color: "text-white bg-[var(--hb-primary)]" },
  completed: { label: "기록 완료", color: "text-[var(--hb-text-body)] bg-[var(--hb-surface-hover)]" },
  cancelled: { label: "내부 취소 표시", color: "text-danger-700 bg-red-500/10" },
};

function formatPrice(price: number): string {
  if (price >= 10000) return `${(price / 10000).toFixed(0)}만원`;
  return `${price.toLocaleString()}원`;
}

export default function BookingsPage() {
  const [bookings, setBookings] = useState<BookingWithExtra[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [classificationTime, setClassificationTime] = useState(() => new Date());

  useEffect(() => {
    let active = true;
    fetch("/api/bookings/mine")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "예약 요청 기록을 불러오지 못했어요. 다시 시도해 주세요.");
        return data;
      })
      .then((data) => {
        if (!active) return;
        if (data.error) {
          setError(data.error);
        } else {
          setBookings(data.bookings ?? []);
        }
      })
      .catch((failure) => {
        if (active) setError(failure instanceof Error ? failure.message : "예약 요청 기록을 불러오지 못했어요.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadVersion]);

  useEffect(() => scheduleSeoulDateRollover(setClassificationTime), []);

  if (loading) {
    return (
      <div className="max-w-[700px] mx-auto flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[var(--hb-hairline)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="max-w-[700px] mx-auto text-center py-20">
        <AlertCircle className="w-10 h-10 text-danger-700 mx-auto mb-3" />
        <p className="text-base text-[var(--hb-text-body)]">{error}</p>
        <button
          aria-label="예약 요청 기록 다시 불러오기"
          onClick={() => {
            setError(null);
            setLoading(true);
            setLoadVersion((version) => version + 1);
          }}
          className="mt-4 text-sm font-medium underline underline-offset-4"
        >
          다시 불러오기
        </button>
      </div>
    );
  }

  const upcoming = bookings.filter((booking) => classifyBookingDate({
    bookingDate: booking.bookingDate,
    status: booking.status,
    now: classificationTime,
  }) === "upcoming");
  const past = bookings.filter((booking) => classifyBookingDate({
    bookingDate: booking.bookingDate,
    status: booking.status,
    now: classificationTime,
  }) === "past");

  return (
    <div className="mx-auto max-w-[860px]">
      {/* 예산·체크리스트·일정·라운지와 같은 기능 요약 강조(샴페인 면)를 쓴다. */}
      <div data-bookings-summary className={`${FEATURE_SUMMARY_CLASS} mb-5 p-4 animate-fade-in sm:p-5`}>
        <h1 className="font-serif-kr text-[var(--hb-summary-ink,#382F2B)]">예약 요청 기록</h1>
        <p className="mt-2 text-[13px] font-medium leading-[1.65] text-[var(--hb-summary-label,#624A3C)]">
          아모라 안에 남긴 방문·상담 후보 기록이에요. 업체 전달·확정·취소와 환불은 업체에 별도로 확인해 주세요.
        </p>
        {bookings.length > 0 && (
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--hb-summary-line,#DEC9BA)] pt-3">
            <div className="flex items-baseline gap-2">
              <dt className={SUMMARY_LABEL_CLASS}>다가오는 요청</dt>
              <dd className="text-[15px] font-semibold tabular-nums text-[var(--hb-summary-ink,#382F2B)]">{upcoming.length}건</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className={SUMMARY_LABEL_CLASS}>지난·취소</dt>
              <dd className="text-[15px] font-semibold tabular-nums text-[var(--hb-summary-ink,#382F2B)]">{past.length}건</dd>
            </div>
          </dl>
        )}
      </div>

      {bookings.length === 0 ? (
        <div className="rounded-[6px] border border-[var(--hb-hairline)] bg-white/90 p-8 text-center shadow-[var(--shadow-raised)] animate-fade-in">
          <Calendar className="mx-auto mb-4 h-12 w-12 text-[var(--hb-text-muted)]" />
          <p className="mb-2 font-serif-kr text-[22px] font-medium text-[var(--hb-text-strong)]">아직 예약 요청 기록이 없어요</p>
          <p className="mb-6 text-[13px] font-medium leading-[1.65] text-[var(--hb-text-body)]">
            업체를 둘러보고 방문·상담 후보를 아모라에 기록해 보세요
          </p>
          <Link
            {...weddingLinkProps("/vendors")}
            className="inline-flex items-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-5 py-3 text-[13px] font-semibold text-white shadow-[var(--shadow-raised)] transition-colors hover:bg-[#2d4642]"
          >
            업체 둘러보기
          </Link>
        </div>
      ) : (
        <>
          {/* 다가오는 요청 기록 */}
          {upcoming.length > 0 && (
            <div className="mb-8">
              <h2 className="hb-h-eyebrow mb-3 text-[var(--hb-text-body)]">다가오는 요청 기록</h2>
              <div className="space-y-3">
                {upcoming.map((booking) => {
                  const statusConfig = STATUS_LABELS[booking.status];

                  return (
                    <div key={booking.id} className="animate-fade-in">
                      <div className="block rounded-[6px] border border-[var(--hb-hairline)] bg-white/90 px-5 py-4 shadow-[var(--shadow-raised)]">
                        <div className="flex items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <h3 className="font-serif-kr text-[var(--hb-text-strong)] truncate">
                                {booking.vendorName}
                              </h3>
                              <span className={`px-2.5 py-0.5 rounded-full text-sm font-medium ${statusConfig?.color ?? ""}`}>
                                {statusConfig?.label ?? booking.status}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-[13px] font-medium text-[var(--hb-text-body)]">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-4 h-4" />
                                {formatBookingDate(booking.bookingDate)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                {booking.bookingTime}
                              </span>
                              {booking.productName && <span>{booking.productName}</span>}
                              {booking.amount > 0 && (
                                <span title="결제·지출 기록이 아닌 예약 요청 견적">
                                  요청 견적 {formatPrice(booking.amount)}
                                </span>
                              )}
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

          {/* 지난·취소 기록 */}
          {past.length > 0 && (
            <div>
              <h2 className="hb-h-eyebrow mb-3 text-[var(--hb-text-body)]">지난·취소 기록</h2>
              <div className="space-y-2">
                {past.map((booking) => {
                  const statusConfig = STATUS_LABELS[booking.status];
                  return (
                    <div
                      key={booking.id}
                      className="flex items-center gap-4 rounded-[6px] border border-[var(--hb-hairline)]/70 bg-white/80 px-5 py-4"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-semibold text-[var(--hb-text-strong)] truncate">
                            {booking.vendorName}
                          </span>
                          <span className={`px-2.5 py-0.5 rounded-full text-sm font-medium ${statusConfig?.color ?? ""}`}>
                            {statusConfig?.label ?? booking.status}
                          </span>
                        </div>
                        <span className="text-sm text-[var(--hb-text-muted)]">
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
