"use client";

import { useState, useCallback } from "react";
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
  if (vendors.length === 0) return null;

  return (
    <div className="flex justify-start ml-12 my-2">
      <div className="flex flex-col gap-2 w-full max-w-[400px]">
        {vendors.map((v) => (
          <div
            key={v.id}
            className="rounded-xl border border-black/[0.06] bg-white px-4 py-3 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[25px] font-semibold text-[#1A1A1F] truncate">
                  {v.name}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Star className="w-3 h-3 text-[#C9A96E] fill-[#C9A96E]" />
                  <span className="text-[23px] text-[#928980]">
                    {v.rating} ({v.reviewCount})
                  </span>
                  <span className="text-[23px] text-[#B5ADA3]">·</span>
                  <MapPin className="w-3 h-3 text-[#B5ADA3]" />
                  <span className="text-[23px] text-[#928980]">{v.location}</span>
                  <span className="text-[23px] text-[#B5ADA3]">·</span>
                  <span className="text-[23px] text-[#928980]">{v.priceRange}</span>
                </div>
              </div>
            </div>

            {/* 태그 */}
            {v.tags && v.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {v.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="text-[25px] px-2 py-0.5 rounded-full bg-[#FAF7F2] text-[#928980] border border-black/[0.04]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* 추천 이유 */}
            {v.reasons && v.reasons.length > 0 && (
              <p className="text-[25px] text-[#C4967E] mt-1.5 truncate">
                {v.reasons.slice(0, 3).join(" · ")}
              </p>
            )}

            {/* 버튼 */}
            <div className="flex items-center gap-2 mt-2.5">
              <button
                onClick={() => onSend?.(`${v.name} 상세 정보 보여줘 [vendor:${v.id}]`)}
                disabled={disabled}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg
                  bg-[#1A1A1F] text-white text-[23px] font-medium
                  hover:bg-[#2A2A2F] active:scale-[0.98]
                  disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <Package className="w-3 h-3" />
                상품·스태프 보기
              </button>
              <Link
                href={v.link}
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-black/[0.06]
                  text-[#B5ADA3] hover:text-[#C4967E] hover:border-[#C4967E]/30 transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
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

  const products = output.products ?? [];
  const staff = output.staff ?? [];
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
    <div className="flex justify-start ml-12 my-2">
      <div className="rounded-xl border border-black/[0.06] bg-white shadow-sm w-full max-w-[420px] overflow-hidden">
        {/* 헤더 */}
        <div className="px-4 py-3 bg-gradient-to-r from-[#FAF7F2] to-[#F5F0E8] border-b border-black/[0.04]">
          <p className="text-[25px] font-semibold text-[#1A1A1F]">{output.vendorName}</p>
          <p className="text-[25px] text-[#928980] mt-0.5">{hasStaff ? "상품과 스태프를 선택해 주세요" : "상품을 선택하면 바로 예약 가능 시간을 확인할 수 있어요"}</p>
        </div>

        {/* 상품 선택 */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-1.5 mb-2">
            <Package className="w-3.5 h-3.5 text-[#C4967E]" />
            <span className="text-[23px] font-semibold text-[#1A1A1F]">상품 선택</span>
          </div>

          {products.length === 0 ? (
            <p className="text-[23px] text-[#B5ADA3] py-2">등록된 상품이 없습니다</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {products.map((p) => {
                const isSelected = selectedProduct === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => handleProductSelect(p.id)}
                    disabled={disabled || confirmed}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all
                      ${isSelected
                        ? "border-[#C4967E] bg-[#C4967E]/5"
                        : "border-black/[0.06] hover:border-[#C4967E]/30 bg-white"
                      } disabled:opacity-40`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className={`text-[38px] font-medium ${isSelected ? "text-[#C4967E]" : "text-[#1A1A1F]"}`}>
                            {p.name}
                          </p>
                          {p.isPopular && (
                            <span className="text-[23px] px-1.5 py-0.5 rounded-full bg-[#C9A96E]/10 text-[#C9A96E] font-medium">
                              인기
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {p.discountPrice ? (
                            <>
                              <span className="text-[23px] font-semibold text-[#C4967E]">
                                {formatPrice(p.discountPrice)}
                              </span>
                              <span className="text-[25px] text-[#B5ADA3] line-through">
                                {formatPrice(p.price)}
                              </span>
                            </>
                          ) : (
                            <span className="text-[23px] font-semibold text-[#1A1A1F]">
                              {formatPrice(p.price)}
                            </span>
                          )}
                          {p.duration && (
                            <>
                              <span className="text-[25px] text-[#B5ADA3]">·</span>
                              <span className="text-[25px] text-[#928980]">
                                {p.duration >= 60 ? `${Math.floor(p.duration / 60)}시간` : ""}
                                {p.duration % 60 > 0 ? ` ${p.duration % 60}분` : ""}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5
                        ${isSelected ? "border-[#C4967E] bg-[#C4967E]" : "border-[#B5ADA3]"}`}>
                        {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                      </div>
                    </div>
                    {isSelected && p.includes && p.includes.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {p.includes.slice(0, 5).map((inc, i) => (
                          <span
                            key={i}
                            className="text-[23px] px-1.5 py-0.5 rounded bg-[#FAF7F2] text-[#928980]"
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
          <div className="px-4 pt-2 pb-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Users className="w-3.5 h-3.5 text-[#C4967E]" />
              <span className="text-[23px] font-semibold text-[#1A1A1F]">스태프 선택</span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {staff.map((s) => {
                const isSelected = selectedStaff === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStaff(isSelected ? null : s.id)}
                    disabled={disabled || confirmed}
                    className={`px-3 py-1.5 rounded-lg text-[23px] font-medium border transition-all
                      ${isSelected
                        ? "border-[#C4967E] bg-[#C4967E]/5 text-[#C4967E]"
                        : "border-black/[0.06] text-[#928980] hover:border-[#C4967E]/30"
                      } disabled:opacity-40`}
                  >
                    {s.name}
                    {s.role && <span className="text-[25px] opacity-70 ml-1">{s.role}</span>}
                  </button>
                );
              })}
              <button
                onClick={() => setSelectedStaff(null)}
                disabled={disabled || confirmed}
                className={`px-3 py-1.5 rounded-lg text-[23px] font-medium border transition-all
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
          <div className="px-4 pb-3">
            <button
              onClick={() => handleConfirm(selectedProduct!, selectedStaff)}
              disabled={disabled || !selectedProduct || confirmed}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                bg-[#1A1A1F] text-white text-[38px] font-medium
                hover:bg-[#2A2A2F] active:scale-[0.98]
                disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <Calendar className="w-3.5 h-3.5" />
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
  };

  const slots = output.slots ?? [];

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

    // 날짜 포맷 (3/15(토))
    const d = new Date(slot.date);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const dateLabel = `${month}/${day}(${slot.dayLabel})`;

    onSend?.(`${dateLabel} ${slot.time} 예약할게요 ${tags}`);
  };

  if (slots.length === 0) {
    return (
      <div className="flex justify-start ml-12 my-2">
        <div className="rounded-xl border border-black/[0.06] bg-white px-4 py-3 shadow-sm max-w-[400px]">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#B5ADA3]" />
            <p className="text-[38px] text-[#928980]">
              향후 14일간 예약 가능한 시간이 없습니다
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start ml-12 my-2">
      <div className="rounded-xl border border-black/[0.06] bg-white shadow-sm w-full max-w-[420px] overflow-hidden">
        {/* 헤더 */}
        <div className="px-4 py-3 bg-gradient-to-r from-[#FAF7F2] to-[#F5F0E8] border-b border-black/[0.04]">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[#C4967E]" />
            <p className="text-[25px] font-semibold text-[#1A1A1F]">예약 가능 시간</p>
          </div>
          <p className="text-[25px] text-[#928980] mt-0.5">
            {output.vendorName} · 원하시는 시간을 선택해 주세요
          </p>
        </div>

        {/* 날짜별 슬롯 */}
        <div className="px-4 py-3 flex flex-col gap-3 max-h-[300px] overflow-y-auto">
          {Array.from(grouped.entries()).map(([date, dateSlots]) => {
            const d = new Date(date);
            const month = d.getMonth() + 1;
            const day = d.getDate();
            const dayLabel = dateSlots[0].dayLabel;
            const isWeekend = dayLabel === "토" || dayLabel === "일";

            return (
              <div key={date}>
                <p className={`text-[23px] font-medium mb-1.5 ${isWeekend ? "text-[#C4967E]" : "text-[#1A1A1F]"}`}>
                  {month}/{day} ({dayLabel})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {dateSlots.map((slot) => (
                    <button
                      key={`${slot.date}-${slot.time}`}
                      onClick={() => handleSelect(slot)}
                      disabled={disabled}
                      className="px-3 py-1.5 rounded-lg border border-black/[0.06] text-[23px]
                        text-[#1A1A1F] hover:border-[#C4967E] hover:text-[#C4967E] hover:bg-[#C4967E]/5
                        active:scale-[0.95] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      <span className="font-medium">{slot.time}</span>
                      {slot.remaining <= 2 && (
                        <span className="text-[23px] text-[#C4967E] ml-1">잔여{slot.remaining}</span>
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
      <div className="flex justify-start ml-12 my-2">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 shadow-sm max-w-[400px]">
          <p className="text-[38px] text-red-600">{result.displayMessage}</p>
        </div>
      </div>
    );
  }

  const d = new Date(output.date);
  const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const dateLabel = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} (${DAYS[d.getDay()]})`;

  const handleCancel = () => {
    setCancelled(true);
    setShowCancelConfirm(false);
    onSend?.(`예약 취소해줘 [booking:${output.bookingId}]`);
  };

  return (
    <div className="flex justify-start ml-12 my-2">
      <div className={`rounded-xl border shadow-sm w-full max-w-[400px] overflow-hidden ${
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
            <p className="text-[25px] font-semibold text-[#1A1A1F]">
              {cancelled ? "예약 취소 요청됨" : "예약이 접수되었습니다!"}
            </p>
            <p className="text-[25px] text-[#928980]">
              {cancelled ? "취소 처리 중입니다" : "업체 확인 후 최종 확정됩니다"}
            </p>
          </div>
        </div>

        {/* 상세 */}
        <div className="px-4 pb-3">
          <div className="rounded-lg bg-white border border-black/[0.04] px-3 py-2.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-[#C4967E]" />
              <span className="text-[23px] text-[#928980]">업체</span>
              <span className="text-[23px] font-medium text-[#1A1A1F] ml-auto">{output.vendorName}</span>
            </div>
            {output.productName && (
              <div className="flex items-center gap-2">
                <Package className="w-3 h-3 text-[#C4967E]" />
                <span className="text-[23px] text-[#928980]">상품</span>
                <span className="text-[23px] font-medium text-[#1A1A1F] ml-auto">
                  {output.productName}
                  {output.amount > 0 && ` (${formatPrice(output.amount)})`}
                </span>
              </div>
            )}
            {output.staffName && (
              <div className="flex items-center gap-2">
                <Users className="w-3 h-3 text-[#C4967E]" />
                <span className="text-[23px] text-[#928980]">담당</span>
                <span className="text-[23px] font-medium text-[#1A1A1F] ml-auto">{output.staffName}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3 text-[#C4967E]" />
              <span className="text-[23px] text-[#928980]">일시</span>
              <span className="text-[23px] font-medium text-[#1A1A1F] ml-auto">
                {dateLabel} {output.time}
              </span>
            </div>
          </div>

          {/* 취소 버튼 */}
          {!cancelled && (
            <div className="mt-2">
              {showCancelConfirm ? (
                <div className="flex items-center justify-between bg-red-50 rounded-lg px-3 py-2">
                  <p className="text-[23px] text-red-600">예약을 취소할까요?</p>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setShowCancelConfirm(false)}
                      className="px-2.5 py-1 text-[25px] rounded-md bg-white border border-black/[0.06] text-[#928980]"
                    >
                      아니요
                    </button>
                    <button
                      onClick={handleCancel}
                      disabled={disabled}
                      className="px-2.5 py-1 text-[25px] rounded-md bg-red-500 text-white disabled:opacity-40"
                    >
                      취소하기
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  disabled={disabled}
                  className="text-[25px] text-[#B5ADA3] hover:text-red-400 transition-colors disabled:opacity-40"
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
      <div className="flex justify-start ml-12 my-2">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 shadow-sm max-w-[400px]">
          <p className="text-[38px] text-red-600">{result.displayMessage}</p>
        </div>
      </div>
    );
  }

  const d = new Date(output.date);
  const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const dateLabel = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} (${DAYS[d.getDay()]})`;

  return (
    <div className="flex justify-start ml-12 my-2">
      <div className="rounded-xl border border-gray-200 bg-gradient-to-r from-gray-50 to-white shadow-sm w-full max-w-[400px] overflow-hidden">
        <div className="px-4 pt-3 pb-2 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gray-400 flex items-center justify-center">
            <X className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[25px] font-semibold text-[#1A1A1F]">예약이 취소되었습니다</p>
          </div>
        </div>
        <div className="px-4 pb-3">
          <div className="rounded-lg bg-white border border-black/[0.04] px-3 py-2.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-[#928980]" />
              <span className="text-[23px] text-[#928980]">업체</span>
              <span className="text-[23px] font-medium text-[#928980] ml-auto line-through">{output.vendorName}</span>
            </div>
            {output.productName && (
              <div className="flex items-center gap-2">
                <Package className="w-3 h-3 text-[#928980]" />
                <span className="text-[23px] text-[#928980]">상품</span>
                <span className="text-[23px] font-medium text-[#928980] ml-auto line-through">{output.productName}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3 text-[#928980]" />
              <span className="text-[23px] text-[#928980]">일시</span>
              <span className="text-[23px] font-medium text-[#928980] ml-auto line-through">{dateLabel} {output.time}</span>
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
  if (places.length === 0) return null;

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
    <div className="flex justify-start ml-12 my-2">
      <div className="flex flex-col gap-2.5 w-full max-w-[420px]">
        {/* 검색 결과 헤더 */}
        {output.query && (
          <div className="flex items-center gap-2 px-1">
            <MapPin className="w-3.5 h-3.5 text-[#C4967E]" />
            <span className="text-[23px] text-[#928980] font-medium">
              &apos;{output.query}&apos; 검색 결과
            </span>
          </div>
        )}

        {places.map((p, idx) => (
          <div
            key={p.id}
            className="rounded-xl border border-black/[0.06] bg-white shadow-sm hover:shadow-md hover:border-[#C4967E]/20 transition-all overflow-hidden"
          >
            {/* 메인 컨텐츠 */}
            <div className="px-4 pt-3.5 pb-3">
              <div className="flex items-start gap-3">
                {/* 순위 번호 */}
                <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-[#FAF7F2] to-[#F5F0E8] flex items-center justify-center border border-black/[0.04]">
                  <span className="text-[38px] font-semibold text-[#C4967E]">
                    {idx + 1}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  {/* 이름 */}
                  <p className="text-[25px] font-semibold text-[#1A1A1F] truncate">
                    {p.name}
                  </p>

                  {/* 태그 줄: 음식종류 + 세부카테고리 + 후기 수 */}
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {p.cuisineType && (
                      <span className="text-[25px] px-2 py-0.5 rounded-full bg-[#1A1A1F]/[0.06] text-[#1A1A1F] font-medium">
                        {cuisineEmoji[p.cuisineType] || "🍴"} {p.cuisineType}
                      </span>
                    )}
                    {p.category && p.category !== p.cuisineType && (
                      <span className="text-[25px] px-2 py-0.5 rounded-full bg-[#C4967E]/10 text-[#C4967E] font-medium">
                        {p.category}
                      </span>
                    )}
                    {p.blogReviewCount > 0 && (
                      <span className="text-[25px] px-2 py-0.5 rounded-full bg-[#E8F5E9] text-[#2E7D5A] font-medium">
                        후기 {formatCount(p.blogReviewCount)}
                      </span>
                    )}
                  </div>

                  {/* 가격대 + 룸 정보 */}
                  {(p.priceRange || p.hasPrivateRoom) && (
                    <div className="flex items-center gap-2 mt-1.5">
                      {p.priceRange && (
                        <span className="text-[25px] text-[#C9A96E] font-semibold">
                          💰 {p.priceRange}
                        </span>
                      )}
                      {p.hasPrivateRoom && (
                        <span className="text-[25px] px-2 py-0.5 rounded-full bg-[#EDE7F6] text-[#5E35B1] font-medium">
                          🚪 룸 있음
                        </span>
                      )}
                    </div>
                  )}

                  {/* 설명 또는 블로그 스니펫 */}
                  {(p.description || p.blogSnippet) && (
                    <p className="text-[23px] text-[#6B6560] mt-1.5 leading-[1.5] line-clamp-2">
                      {p.description || p.blogSnippet}
                    </p>
                  )}

                  {/* 주소 + 전화 */}
                  <div className="flex items-center gap-3 mt-2">
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-[#B5ADA3] shrink-0" />
                      <span className="text-[25px] text-[#928980] truncate max-w-[200px]">
                        {p.address}
                      </span>
                    </div>
                    {p.telephone && (
                      <div className="flex items-center gap-1">
                        <Phone className="w-2.5 h-2.5 text-[#B5ADA3] shrink-0" />
                        <span className="text-[25px] text-[#928980]">
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
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[23px] font-medium text-[#1A1A1F] hover:bg-[#FAF7F2] transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                네이버 지도
              </a>
              <div className="w-px bg-black/[0.04]" />
              <a
                href={p.blogSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[23px] font-medium text-[#C4967E] hover:bg-[#FDF8F5] transition-colors"
              >
                <MessageSquareText className="w-3 h-3" />
                블로그 후기
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
