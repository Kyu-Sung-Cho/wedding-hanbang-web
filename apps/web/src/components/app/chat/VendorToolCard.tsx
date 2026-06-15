"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import type { ToolExecutionResult } from "@/types/database.types";
import {
  Star,
  ChevronRight,
  Package,
  Users,
  Calendar,
  Clock,
  CheckCircle2,
  MapPin,
  Sparkles,
  Phone,
  ExternalLink,
  MessageSquareText,
  X,
} from "lucide-react";
import QuoteAnalysisCard from "./QuoteAnalysisCard";
import ProtectionToolCard, { PROTECTION_TOOL_NAMES } from "./ProtectionToolCard";

// 업체 관련 tool 이름 집합
export const VENDOR_TOOL_NAMES = new Set([
  "recommend_vendors",
  "search_vendors",
  "get_vendor_detail",
  "get_available_slots",
  "check_vendor_availability",
  "create_booking",
  "cancel_booking",
  "search_nearby_places",
  "analyze_quote",
  ...PROTECTION_TOOL_NAMES,
]);

interface VendorToolCardProps {
  result: ToolExecutionResult;
  onSend?: (text: string) => void;
  disabled?: boolean;
}

function formatPrice(amount: number): string {
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(1)}억원`;
  if (amount >= 10000) return `${Math.round(amount / 10000).toLocaleString()}만원`;
  return `${amount.toLocaleString()}원`;
}

export default function VendorToolCard({ result, onSend, disabled }: VendorToolCardProps) {
  switch (result.toolName) {
    case "recommend_vendors":
    case "search_vendors":
      return <VendorRecommendCards result={result} onSend={onSend} disabled={disabled} />;
    case "get_vendor_detail":
      return <VendorDetailCard result={result} onSend={onSend} disabled={disabled} />;
    case "get_available_slots":
    case "check_vendor_availability":
      return <TimeslotPicker result={result} onSend={onSend} disabled={disabled} />;
    case "create_booking":
      return <BookingConfirmCard result={result} onSend={onSend} disabled={disabled} />;
    case "cancel_booking":
      return <BookingCancelCard result={result} />;
    case "search_nearby_places":
      return <PlaceCards result={result} />;
    case "analyze_quote":
      return <QuoteAnalysisCard result={result} onSend={onSend} disabled={disabled} />;
    case "analyze_contract_readiness":
    case "simulate_guest_guarantee":
      return <ProtectionToolCard result={result} />;
    default:
      return null;
  }
}

// ── A. 업체 추천/검색 결과 카드 ──

function VendorRecommendCards({
  result,
  onSend,
  disabled,
}: {
  result: ToolExecutionResult;
  onSend?: (text: string) => void;
  disabled?: boolean;
}) {
  const output = result.toolOutput as {
    vendors?: {
      id: string;
      name: string;
      location: string;
      priceRange: string;
      rating: number;
      reviewCount: number;
      tags: string[];
      reasons?: string[];
      link: string;
    }[];
  };

  const vendors = output.vendors ?? [];

  // DB에 매칭 업체가 0건일 때 — "AI 웨딩플래너인데 빈 카드/실패 X 표시가 줄줄이"
  // 라는 인상 대신, 베타 안내 카드 1개로 깔끔하게 노출.
  if (vendors.length === 0) {
    return (
      <div className="flex justify-start ml-14 my-2">
        <div className="rounded-xl border border-[#F5F0E8] bg-gradient-to-br from-[#FAF7F2] to-white px-5 py-4 shadow-sm max-w-[440px]">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#C4967E]/15">
              <Sparkles className="w-5 h-5 text-[#C4967E]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-[#1A1A1F]">업체 추천은 준비 중이에요</p>
              <p className="mt-1 text-sm leading-relaxed text-[#504444]">
                지금은 업체 데이터베이스를 검수·정리하고 있어요. 곧 지역·예산·스타일에 맞는
                실제 후보를 보여드릴 수 있게 준비 중입니다. 그동안 견적 체크·예산·일정 정리는
                바로 도와드릴 수 있어요.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start ml-14 my-2">
      <div className="flex flex-col gap-2.5 w-full max-w-[440px]">
        {vendors.map((v) => (
          <div
            key={v.id}
            className="rounded-xl border border-black/[0.06] bg-white px-5 py-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-lg font-semibold text-[#1A1A1F] truncate">
                  {v.name}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Star className="w-4 h-4 text-[#C9A96E] fill-[#C9A96E]" />
                  <span className="text-sm text-[#928980]">
                    {v.rating} ({v.reviewCount})
                  </span>
                  <span className="text-sm text-[#B5ADA3]">·</span>
                  <MapPin className="w-4 h-4 text-[#B5ADA3]" />
                  <span className="text-sm text-[#928980]">{v.location}</span>
                  <span className="text-sm text-[#B5ADA3]">·</span>
                  <span className="text-sm text-[#928980]">{v.priceRange}</span>
                </div>
              </div>
            </div>

            {/* 태그 */}
            {v.tags && v.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {v.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="text-sm px-2.5 py-0.5 rounded-full bg-[#FAF7F2] text-[#928980] border border-black/[0.04]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* 추천 이유 */}
            {v.reasons && v.reasons.length > 0 && (
              <p className="text-sm text-[#C4967E] mt-2 truncate">
                {v.reasons.slice(0, 3).join(" · ")}
              </p>
            )}

            {/* 버튼 */}
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => onSend?.(`${v.name} 상세 정보 보여줘 [vendor:${v.id}]`)}
                disabled={disabled}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
                  bg-[#795252] text-white text-sm font-medium
                  hover:bg-[#946a6a] active:scale-[0.98]
                  disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Package className="w-4 h-4" />
                상품·스태프 보기
              </button>
              <Link
                href={v.link}
                className="flex items-center justify-center w-10 h-10 rounded-lg border border-black/[0.06]
                  text-[#B5ADA3] hover:text-[#C4967E] hover:border-[#C4967E]/30 transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── B. 업체 상세 (상품 + 스태프 선택) 카드 ──

function VendorDetailCard({
  result,
  onSend,
  disabled,
}: {
  result: ToolExecutionResult;
  onSend?: (text: string) => void;
  disabled?: boolean;
}) {
  const output = result.toolOutput as {
    vendorId: string;
    vendorName: string;
    products: {
      id: string;
      name: string;
      description: string;
      price: number;
      discountPrice: number | null;
      duration: number | null;
      isPopular: boolean;
      includes: string[];
    }[];
    staff: {
      id: string;
      name: string;
      role: string | null;
      description: string;
    }[];
  };

  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const products = useMemo(() => output.products ?? [], [output.products]);
  const staff = useMemo(() => output.staff ?? [], [output.staff]);
  const hasStaff = staff.length > 0;

  const handleConfirm = useCallback((productId: string, staffId: string | null) => {
    if (confirmed) return;
    setConfirmed(true);
    const product = products.find((p) => p.id === productId);
    const staffMember = staffId ? staff.find((s) => s.id === staffId) : null;

    const tags = [
      `[vendor:${output.vendorId}]`,
      `[product:${productId}]`,
      staffId ? `[staff:${staffId}]` : "",
    ].filter(Boolean).join("");

    const productLabel = product?.name ?? "상품";
    const staffLabel = staffMember ? staffMember.name : "스태프 미지정";

    onSend?.(`${productLabel}, ${staffLabel} 선택했어요 ${tags}`);
  }, [confirmed, products, staff, output.vendorId, onSend]);

  // 스태프 없으면 상품 선택 시 바로 진행
  const handleProductSelect = useCallback((productId: string) => {
    setSelectedProduct(productId);
    if (!hasStaff) {
      handleConfirm(productId, null);
    }
  }, [hasStaff, handleConfirm]);

  return (
    <div className="flex justify-start ml-14 my-2">
      <div className="rounded-xl border border-black/[0.06] bg-white shadow-sm w-full max-w-[460px] overflow-hidden">
        {/* 헤더 */}
        <div className="px-5 py-4 bg-gradient-to-r from-[#FAF7F2] to-[#F5F0E8] border-b border-black/[0.04]">
          <p className="text-lg font-semibold text-[#1A1A1F]">{output.vendorName}</p>
          <p className="text-sm text-[#928980] mt-1">{hasStaff ? "상품과 스태프를 선택해 주세요" : "상품을 선택하면 바로 예약 가능 시간을 확인할 수 있어요"}</p>
        </div>

        {/* 상품 선택 */}
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center gap-2 mb-2.5">
            <Package className="w-5 h-5 text-[#C4967E]" />
            <span className="text-base font-semibold text-[#1A1A1F]">상품 선택</span>
          </div>

          {products.length === 0 ? (
            <p className="text-sm text-[#B5ADA3] py-2">등록된 상품이 없습니다</p>
          ) : (
            <div className="flex flex-col gap-2">
              {products.map((p) => {
                const isSelected = selectedProduct === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => handleProductSelect(p.id)}
                    disabled={disabled || confirmed}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-colors
                      ${isSelected
                        ? "border-[#C4967E] bg-[#C4967E]/5"
                        : "border-black/[0.06] hover:border-[#C4967E]/30 bg-white"
                      } disabled:opacity-40`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-base font-medium ${isSelected ? "text-[#C4967E]" : "text-[#1A1A1F]"}`}>
                            {p.name}
                          </p>
                          {p.isPopular && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-[#C9A96E]/10 text-[#C9A96E] font-medium">
                              인기
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {p.discountPrice ? (
                            <>
                              <span className="text-sm font-semibold text-[#C4967E]">
                                {formatPrice(p.discountPrice)}
                              </span>
                              <span className="text-sm text-[#B5ADA3] line-through">
                                {formatPrice(p.price)}
                              </span>
                            </>
                          ) : (
                            <span className="text-sm font-semibold text-[#1A1A1F]">
                              {formatPrice(p.price)}
                            </span>
                          )}
                          {p.duration && (
                            <>
                              <span className="text-sm text-[#B5ADA3]">·</span>
                              <span className="text-sm text-[#928980]">
                                {p.duration >= 60 ? `${Math.floor(p.duration / 60)}시간` : ""}
                                {p.duration % 60 > 0 ? ` ${p.duration % 60}분` : ""}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5
                        ${isSelected ? "border-[#C4967E] bg-[#C4967E]" : "border-[#B5ADA3]"}`}>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-white" />}
                      </div>
                    </div>
                    {isSelected && p.includes && p.includes.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {p.includes.slice(0, 5).map((inc, i) => (
                          <span
                            key={i}
                            className="text-xs px-2 py-0.5 rounded bg-[#FAF7F2] text-[#928980]"
                          >
                            {inc}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 스태프 선택 (스태프가 있을 때만 표시) */}
        {hasStaff && (
          <div className="px-5 pt-2 pb-4">
            <div className="flex items-center gap-2 mb-2.5">
              <Users className="w-5 h-5 text-[#C4967E]" />
              <span className="text-base font-semibold text-[#1A1A1F]">스태프 선택</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {staff.map((s) => {
                const isSelected = selectedStaff === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStaff(isSelected ? null : s.id)}
                    disabled={disabled || confirmed}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors
                      ${isSelected
                        ? "border-[#C4967E] bg-[#C4967E]/5 text-[#C4967E]"
                        : "border-black/[0.06] text-[#928980] hover:border-[#C4967E]/30"
                      } disabled:opacity-40`}
                  >
                    {s.name}
                    {s.role && <span className="text-sm opacity-70 ml-1">{s.role}</span>}
                  </button>
                );
              })}
              <button
                onClick={() => setSelectedStaff(null)}
                disabled={disabled || confirmed}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors
                  ${selectedStaff === null
                    ? "border-[#C4967E] bg-[#C4967E]/5 text-[#C4967E]"
                    : "border-black/[0.06] text-[#928980] hover:border-[#C4967E]/30"
                  } disabled:opacity-40`}
              >
                상관없음
              </button>
            </div>
          </div>
        )}

        {/* 확인 버튼 (스태프 있을 때만, 스태프 선택 후 진행) */}
        {hasStaff && (
          <div className="px-5 pb-4">
            <button
              onClick={() => handleConfirm(selectedProduct!, selectedStaff)}
              disabled={disabled || !selectedProduct || confirmed}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl
                bg-[#795252] text-white text-base font-medium
                hover:bg-[#946a6a] active:scale-[0.98]
                disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Calendar className="w-5 h-5" />
              예약 가능 시간 확인
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── C. 타임슬롯 선택 ──

function TimeslotPicker({
  result,
  onSend,
  disabled,
}: {
  result: ToolExecutionResult;
  onSend?: (text: string) => void;
  disabled?: boolean;
}) {
  const output = result.toolOutput as {
    vendorId: string;
    vendorName: string;
    productId: string | null;
    staffId: string | null;
    slots: {
      date: string;
      dayLabel: string;
      hour: number;
      time: string;
      remaining: number;
    }[];
    fallbackSlots?: {
      date: string;
      dayLabel: string;
      hour: number;
      time: string;
      remaining: number;
    }[];
    filterLabel?: string | null;
    _debug?: {
      slotSource?: string;
      slotsLoaded?: number;
      rangeStart?: string;
      rangeEnd?: string;
      expanded?: number;
      primary?: number;
      fallback?: number;
      targetMonthResolved?: string | null;
      targetDateResolved?: string | null;
    };
  };

  // 1차: 사용자가 지정한 월/날짜의 슬롯. 비어있으면 인접 월 fallback 슬롯으로 자동 대체.
  const primary = output.slots ?? [];
  const fallback = output.fallbackSlots ?? [];
  const filterLabel = output.filterLabel ?? "";
  const usingFallback = primary.length === 0 && fallback.length > 0;
  const slots = primary.length > 0 ? primary : fallback;

  // 날짜별 그룹핑
  const grouped = new Map<string, typeof slots>();
  for (const slot of slots) {
    const key = slot.date;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(slot);
  }

  const handleSelect = (slot: (typeof slots)[0]) => {
    const tags = [
      `[vendor:${output.vendorId}]`,
      output.productId ? `[product:${output.productId}]` : "",
      output.staffId ? `[staff:${output.staffId}]` : "",
      `[date:${slot.date}]`,
      `[time:${slot.time}]`,
    ].filter(Boolean).join("");

    // 날짜 포맷 (3/15(토)) — slot.date 는 "YYYY-MM-DD" 문자열이므로 timezone 영향
    // 받지 않게 직접 파싱 (new Date("YYYY-MM-DD") 은 UTC 자정으로 해석돼 해외
    // timezone 사용자에게 ±1일 어긋날 수 있음).
    const [, ymM, ymD] = slot.date.split("-");
    const dateLabel = `${Number(ymM)}/${Number(ymD)}(${slot.dayLabel})`;

    onSend?.(`${dateLabel} ${slot.time} 예약할게요 ${tags}`);
  };

  if (slots.length === 0) {
    const dbg = output._debug;
    return (
      <div className="flex justify-start ml-14 my-2">
        <div className="rounded-xl border border-black/[0.06] bg-white px-5 py-4 shadow-sm max-w-[440px]">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-[#B5ADA3]" />
            <p className="text-base text-[#928980]">
              {filterLabel
                ? `${filterLabel}에 예약 가능한 시간이 없습니다`
                : "예약 가능한 시간이 없습니다"}
            </p>
          </div>
          {dbg && (
            <pre className="mt-2 text-[0.625rem] text-[#B5ADA3] font-mono leading-tight whitespace-pre-wrap break-all">
              {`src=${dbg.slotSource ?? "-"} loaded=${dbg.slotsLoaded ?? "-"}
range=${dbg.rangeStart ?? "-"}~${dbg.rangeEnd ?? "-"}
expanded=${dbg.expanded ?? "-"} primary=${dbg.primary ?? "-"} fallback=${dbg.fallback ?? "-"}
targetMonth=${dbg.targetMonthResolved ?? "-"} targetDate=${dbg.targetDateResolved ?? "-"}
vendorId=${output.vendorId} productId=${output.productId ?? "-"} staffId=${output.staffId ?? "-"}`}
            </pre>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start ml-14 my-2">
      <div className="rounded-xl border border-black/[0.06] bg-white shadow-sm w-full max-w-[460px] overflow-hidden">
        {/* 헤더 */}
        <div className="px-5 py-4 bg-gradient-to-r from-[#FAF7F2] to-[#F5F0E8] border-b border-black/[0.04]">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-[#C4967E]" />
            <p className="text-lg font-semibold text-[#1A1A1F]">예약 가능 시간</p>
          </div>
          <p className="text-sm text-[#928980] mt-1">
            {output.vendorName}
            {filterLabel && !usingFallback ? ` · ${filterLabel}` : ""}
            {" · 원하시는 시간을 선택해 주세요"}
          </p>
          {usingFallback && (
            <p className="mt-2 text-xs text-[#9A6B62] bg-[#C4967E]/10 rounded px-2 py-1.5 inline-block">
              💡 {filterLabel}에는 빈 시간이 없어 인접한 시기의 슬롯을 보여드려요
            </p>
          )}
        </div>

        {/* 날짜별 슬롯 */}
        <div className="px-5 py-4 flex flex-col gap-3.5 max-h-[340px] overflow-y-auto">
          {Array.from(grouped.entries()).map(([date, dateSlots]) => {
            // date 는 "YYYY-MM-DD" 문자열 — timezone-free 하게 직접 파싱
            const [, ymM, ymD] = date.split("-");
            const month = Number(ymM);
            const day = Number(ymD);
            const dayLabel = dateSlots[0].dayLabel;
            const isWeekend = dayLabel === "토" || dayLabel === "일";

            return (
              <div key={date}>
                <p className={`text-base font-medium mb-2 ${isWeekend ? "text-[#C4967E]" : "text-[#1A1A1F]"}`}>
                  {month}/{day} ({dayLabel})
                </p>
                <div className="flex flex-wrap gap-2">
                  {dateSlots.map((slot) => (
                    <button
                      key={`${slot.date}-${slot.time}`}
                      onClick={() => handleSelect(slot)}
                      disabled={disabled}
                      className="px-4 py-2 rounded-lg border border-black/[0.06] text-sm
                        text-[#1A1A1F] hover:border-[#C4967E] hover:text-[#C4967E] hover:bg-[#C4967E]/5
                        active:scale-[0.95] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <span className="font-medium">{slot.time}</span>
                      {slot.remaining <= 2 && (
                        <span className="text-xs text-[#C4967E] ml-1">잔여{slot.remaining}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── D. 예약 확인 카드 ──

function BookingConfirmCard({ result, onSend, disabled }: { result: ToolExecutionResult; onSend?: (text: string) => void; disabled?: boolean }) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const output = result.toolOutput as {
    bookingId: string;
    vendorName: string;
    productName: string;
    staffName: string;
    date: string;
    time: string;
    amount: number;
    status: string;
  };

  if (!result.success) {
    return (
      <div className="flex justify-start ml-14 my-2">
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 shadow-sm max-w-[440px]">
          <p className="text-base text-red-600">{result.displayMessage}</p>
        </div>
      </div>
    );
  }

  // output.date 는 "YYYY-MM-DD" — timezone-free 파싱 (new Date 는 UTC 자정 해석)
  const [ymY, ymM, ymD] = output.date.split("-");
  const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
  // 요일 계산: UTC.Date 로 같은 ymd 생성 후 getUTCDay (브라우저 timezone 무관)
  const weekdayIdx = new Date(Date.UTC(Number(ymY), Number(ymM) - 1, Number(ymD))).getUTCDay();
  const dateLabel = `${ymY}.${ymM}.${ymD} (${DAYS[weekdayIdx]})`;

  const handleCancel = () => {
    setCancelled(true);
    setShowCancelConfirm(false);
    onSend?.(`예약 취소해줘 [booking:${output.bookingId}]`);
  };

  return (
    <div className="flex justify-start ml-11 my-1.5">
      <div className={`rounded-xl border shadow-sm w-full max-w-[24rem] overflow-hidden ${
        cancelled ? "border-gray-200 bg-gray-50" : "border-emerald-200 bg-gradient-to-r from-emerald-50 to-white"
      }`}>
        {/* 헤더 */}
        <div className="px-4 pt-3 pb-2 flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
            cancelled ? "bg-gray-400" : "bg-emerald-500"
          }`}>
            <CheckCircle2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1A1A1F]">
              {cancelled ? "예약 취소 요청됨" : "예약이 접수되었습니다"}
            </p>
            <p className="text-xs text-[#928980]">
              {cancelled ? "취소 처리 중" : "업체 확인 후 최종 확정"}
            </p>
          </div>
        </div>

        {/* 상세 */}
        <div className="px-4 pb-3">
          <div className="rounded-lg bg-white border border-black/[0.04] px-3 py-2.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#C4967E]" />
              <span className="text-xs text-[#928980]">업체</span>
              <span className="text-xs font-medium text-[#1A1A1F] ml-auto">{output.vendorName}</span>
            </div>
            {output.productName && (
              <div className="flex items-center gap-2">
                <Package className="w-3.5 h-3.5 text-[#C4967E]" />
                <span className="text-xs text-[#928980]">상품</span>
                <span className="text-xs font-medium text-[#1A1A1F] ml-auto">
                  {output.productName}
                  {output.amount > 0 && ` (${formatPrice(output.amount)})`}
                </span>
              </div>
            )}
            {output.staffName && (
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-[#C4967E]" />
                <span className="text-xs text-[#928980]">담당</span>
                <span className="text-xs font-medium text-[#1A1A1F] ml-auto">{output.staffName}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-[#C4967E]" />
              <span className="text-xs text-[#928980]">일시</span>
              <span className="text-xs font-medium text-[#1A1A1F] ml-auto">
                {dateLabel} {output.time}
              </span>
            </div>
          </div>

          {/* 취소 버튼 */}
          {!cancelled && (
            <div className="mt-2">
              {showCancelConfirm ? (
                <div className="flex items-center justify-between bg-red-50 rounded-lg px-3 py-2">
                  <p className="text-xs text-red-600">예약을 취소할까요?</p>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setShowCancelConfirm(false)}
                      className="px-2.5 py-1 text-xs rounded-md bg-white border border-black/[0.06] text-[#928980]"
                    >
                      아니요
                    </button>
                    <button
                      onClick={handleCancel}
                      disabled={disabled}
                      className="px-2.5 py-1 text-xs rounded-md bg-red-500 text-white disabled:opacity-40"
                    >
                      취소하기
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  disabled={disabled}
                  className="text-xs text-[#B5ADA3] hover:text-red-400 transition-colors disabled:opacity-40"
                >
                  예약 취소
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── D-2. 예약 취소 확인 카드 ──

function BookingCancelCard({ result }: { result: ToolExecutionResult }) {
  // hidden 플래그 — invalid booking_id 또는 중복 호출 시 server 가 silent return.
  // 사용자에게 fail/redundant 카드 노출 회피.
  const hiddenOutput = result.toolOutput as { hidden?: boolean } | null;
  if (hiddenOutput?.hidden) return null;

  const output = result.toolOutput as {
    bookingId: string;
    vendorName: string;
    productName: string;
    date: string;
    time: string;
    status: string;
  };

  if (!result.success) {
    return (
      <div className="flex justify-start ml-14 my-2">
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 shadow-sm max-w-[440px]">
          <p className="text-base text-red-600">{result.displayMessage}</p>
        </div>
      </div>
    );
  }

  // output.date 는 "YYYY-MM-DD" — timezone-free 파싱 (new Date 는 UTC 자정 해석)
  const [ymY, ymM, ymD] = output.date.split("-");
  const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
  // 요일 계산: UTC.Date 로 같은 ymd 생성 후 getUTCDay (브라우저 timezone 무관)
  const weekdayIdx = new Date(Date.UTC(Number(ymY), Number(ymM) - 1, Number(ymD))).getUTCDay();
  const dateLabel = `${ymY}.${ymM}.${ymD} (${DAYS[weekdayIdx]})`;

  return (
    <div className="flex justify-start ml-14 my-2">
      <div className="rounded-xl border border-gray-200 bg-gradient-to-r from-gray-50 to-white shadow-sm w-full max-w-[440px] overflow-hidden">
        <div className="px-5 pt-4 pb-2.5 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-gray-400 flex items-center justify-center">
            <X className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-lg font-semibold text-[#1A1A1F]">예약이 취소되었습니다</p>
          </div>
        </div>
        <div className="px-5 pb-4">
          <div className="rounded-lg bg-white border border-black/[0.04] px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#928980]" />
              <span className="text-sm text-[#928980]">업체</span>
              <span className="text-sm font-medium text-[#928980] ml-auto line-through">{output.vendorName}</span>
            </div>
            {output.productName && (
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-[#928980]" />
                <span className="text-sm text-[#928980]">상품</span>
                <span className="text-sm font-medium text-[#928980] ml-auto line-through">{output.productName}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#928980]" />
              <span className="text-sm text-[#928980]">일시</span>
              <span className="text-sm font-medium text-[#928980] ml-auto line-through">{dateLabel} {output.time}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── E. 네이버 지역 검색 장소 카드 ──

function PlaceCards({ result }: { result: ToolExecutionResult }) {
  const output = result.toolOutput as {
    places?: {
      id: string;
      name: string;
      address: string;
      category: string;
      categoryFull: string;
      cuisineType: string;
      description: string | null;
      telephone: string | null;
      priceRange: string | null;
      hasPrivateRoom: boolean;
      mapsUrl: string;
      blogSearchUrl: string;
      blogReviewCount: number;
      blogSnippet: string | null;
      link: string | null;
    }[];
    query?: string;
  };

  const places = output.places ?? [];
  if (places.length === 0) {
    return (
      <div className="flex justify-start ml-14 my-2">
        <div className="rounded-xl border border-[#F5F0E8] bg-gradient-to-br from-[#FAF7F2] to-white px-5 py-4 shadow-sm max-w-[440px]">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#C4967E]/15">
              <MapPin className="w-5 h-5 text-[#C4967E]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-[#1A1A1F]">
                {output.query ? `'${output.query}' 근처 결과를 못 찾았어요` : "근처 장소 검색 결과가 없어요"}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[#504444]">
                다른 키워드로 다시 물어봐 주시거나, 좀 더 넓은 지역으로 알려주시면 다시 찾아볼게요.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 블로그 리뷰 수 포맷
  const formatCount = (n: number) => {
    if (n >= 10000) return `${(n / 10000).toFixed(1)}만`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  // 음식 종류별 이모지
  const cuisineEmoji: Record<string, string> = {
    "한식": "🍚", "양식": "🍝", "일식": "🍣", "중식": "🥟",
    "분식": "🍜", "뷔페": "🍽", "카페": "☕", "베이커리": "🍞",
  };

  return (
    <div className="flex justify-start ml-14 my-2">
      <div className="flex flex-col gap-3 w-full max-w-[460px]">
        {/* 검색 결과 헤더 */}
        {output.query && (
          <div className="flex items-center gap-2 px-1">
            <MapPin className="w-5 h-5 text-[#C4967E]" />
            <span className="text-sm text-[#928980] font-medium">
              &apos;{output.query}&apos; 검색 결과
            </span>
          </div>
        )}

        {places.map((p, idx) => (
          <div
            key={p.id}
            className="rounded-xl border border-black/[0.06] bg-white shadow-sm hover:shadow-md hover:border-[#C4967E]/20 transition-colors overflow-hidden"
          >
            {/* 메인 컨텐츠 */}
            <div className="px-5 pt-4 pb-3.5">
              <div className="flex items-start gap-3">
                {/* 순위 번호 */}
                <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br from-[#FAF7F2] to-[#F5F0E8] flex items-center justify-center border border-black/[0.04]">
                  <span className="text-base font-semibold text-[#C4967E]">
                    {idx + 1}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  {/* 이름 */}
                  <p className="text-lg font-semibold text-[#1A1A1F] truncate">
                    {p.name}
                  </p>

                  {/* 태그 줄: 음식종류 + 세부카테고리 + 후기 수 */}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {p.cuisineType && (
                      <span className="text-sm px-2.5 py-0.5 rounded-full bg-[#1A1A1F]/[0.06] text-[#1A1A1F] font-medium">
                        {cuisineEmoji[p.cuisineType] || "🍴"} {p.cuisineType}
                      </span>
                    )}
                    {p.category && p.category !== p.cuisineType && (
                      <span className="text-sm px-2.5 py-0.5 rounded-full bg-[#C4967E]/10 text-[#C4967E] font-medium">
                        {p.category}
                      </span>
                    )}
                    {p.blogReviewCount > 0 && (
                      <span
                        className="text-sm px-2.5 py-0.5 rounded-full bg-[#E8F5E9] text-[#2E7D5A] font-medium"
                        title="네이버 블로그에서 이 가게가 언급된 글 수 (정확한 후기 수와 다를 수 있어요)"
                      >
                        블로그 {formatCount(p.blogReviewCount)}+
                      </span>
                    )}
                  </div>

                  {/* 가격대 + 룸 정보 */}
                  {(p.priceRange || p.hasPrivateRoom) && (
                    <div className="flex items-center gap-2.5 mt-2">
                      {p.priceRange && (
                        <span className="text-sm text-[#C9A96E] font-semibold">
                          💰 {p.priceRange}
                        </span>
                      )}
                      {p.hasPrivateRoom && (
                        <span className="text-sm px-2.5 py-0.5 rounded-full bg-[#EDE7F6] text-[#5E35B1] font-medium">
                          🚪 룸 있음
                        </span>
                      )}
                    </div>
                  )}

                  {/* 설명 또는 블로그 스니펫 */}
                  {(p.description || p.blogSnippet) && (
                    <p className="text-sm text-[#6B6560] mt-2 leading-[1.5] line-clamp-2">
                      {p.description || p.blogSnippet}
                    </p>
                  )}

                  {/* 주소 + 전화 */}
                  <div className="flex items-center gap-3 mt-2.5">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-[#B5ADA3] shrink-0" />
                      <span className="text-sm text-[#928980] truncate max-w-[220px]">
                        {p.address}
                      </span>
                    </div>
                    {p.telephone && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-[#B5ADA3] shrink-0" />
                        <span className="text-sm text-[#928980]">
                          {p.telephone}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 하단 액션 버튼 */}
            <div className="flex border-t border-black/[0.04]">
              <a
                href={p.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium text-[#1A1A1F] hover:bg-[#FAF7F2] transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                네이버 지도
              </a>
              <div className="w-px bg-black/[0.04]" />
              <a
                href={p.blogSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium text-[#C4967E] hover:bg-[#FDF8F5] transition-colors"
              >
                <MessageSquareText className="w-4 h-4" />
                블로그 후기
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
