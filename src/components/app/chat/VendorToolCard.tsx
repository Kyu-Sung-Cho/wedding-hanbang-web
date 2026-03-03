"use client";

import { useState } from "react";
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
} from "lucide-react";

// 업체 관련 tool 이름 집합
export const VENDOR_TOOL_NAMES = new Set([
  "recommend_vendors",
  "search_vendors",
  "get_vendor_detail",
  "get_available_slots",
  "create_booking",
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
      return <TimeslotPicker result={result} onSend={onSend} disabled={disabled} />;
    case "create_booking":
      return <BookingConfirmCard result={result} />;
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
                <p className="text-[13px] font-semibold text-[#1A1A1F] truncate">
                  {v.name}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Star className="w-3 h-3 text-[#C9A96E] fill-[#C9A96E]" />
                  <span className="text-[11px] text-[#928980]">
                    {v.rating} ({v.reviewCount})
                  </span>
                  <span className="text-[11px] text-[#B5ADA3]">·</span>
                  <MapPin className="w-3 h-3 text-[#B5ADA3]" />
                  <span className="text-[11px] text-[#928980]">{v.location}</span>
                  <span className="text-[11px] text-[#B5ADA3]">·</span>
                  <span className="text-[11px] text-[#928980]">{v.priceRange}</span>
                </div>
              </div>
            </div>

            {/* 태그 */}
            {v.tags && v.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {v.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-[#FAF7F2] text-[#928980] border border-black/[0.04]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* 추천 이유 */}
            {v.reasons && v.reasons.length > 0 && (
              <p className="text-[10px] text-[#C4967E] mt-1.5 truncate">
                {v.reasons.slice(0, 3).join(" · ")}
              </p>
            )}

            {/* 버튼 */}
            <div className="flex items-center gap-2 mt-2.5">
              <button
                onClick={() => onSend?.(`${v.name} 상세 정보 보여줘 [vendor:${v.id}]`)}
                disabled={disabled}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg
                  bg-[#1A1A1F] text-white text-[11px] font-medium
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

  const products = output.products ?? [];
  const staff = output.staff ?? [];

  const handleConfirm = () => {
    if (!selectedProduct) return;
    const product = products.find((p) => p.id === selectedProduct);
    const staffMember = staff.find((s) => s.id === selectedStaff);

    const tags = [
      `[vendor:${output.vendorId}]`,
      `[product:${selectedProduct}]`,
      selectedStaff ? `[staff:${selectedStaff}]` : "",
    ].filter(Boolean).join("");

    const productLabel = product?.name ?? "상품";
    const staffLabel = staffMember ? staffMember.name : "스태프 미지정";

    onSend?.(`${productLabel}, ${staffLabel} 선택했어요 ${tags}`);
  };

  return (
    <div className="flex justify-start ml-12 my-2">
      <div className="rounded-xl border border-black/[0.06] bg-white shadow-sm w-full max-w-[420px] overflow-hidden">
        {/* 헤더 */}
        <div className="px-4 py-3 bg-gradient-to-r from-[#FAF7F2] to-[#F5F0E8] border-b border-black/[0.04]">
          <p className="text-[13px] font-semibold text-[#1A1A1F]">{output.vendorName}</p>
          <p className="text-[10px] text-[#928980] mt-0.5">상품과 스태프를 선택해 주세요</p>
        </div>

        {/* 상품 선택 */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-1.5 mb-2">
            <Package className="w-3.5 h-3.5 text-[#C4967E]" />
            <span className="text-[11px] font-semibold text-[#1A1A1F]">상품 선택</span>
          </div>

          {products.length === 0 ? (
            <p className="text-[11px] text-[#B5ADA3] py-2">등록된 상품이 없습니다</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {products.map((p) => {
                const isSelected = selectedProduct === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProduct(p.id)}
                    disabled={disabled}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all
                      ${isSelected
                        ? "border-[#C4967E] bg-[#C4967E]/5"
                        : "border-black/[0.06] hover:border-[#C4967E]/30 bg-white"
                      } disabled:opacity-40`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className={`text-[12px] font-medium ${isSelected ? "text-[#C4967E]" : "text-[#1A1A1F]"}`}>
                            {p.name}
                          </p>
                          {p.isPopular && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#C9A96E]/10 text-[#C9A96E] font-medium">
                              인기
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {p.discountPrice ? (
                            <>
                              <span className="text-[11px] font-semibold text-[#C4967E]">
                                {formatPrice(p.discountPrice)}
                              </span>
                              <span className="text-[10px] text-[#B5ADA3] line-through">
                                {formatPrice(p.price)}
                              </span>
                            </>
                          ) : (
                            <span className="text-[11px] font-semibold text-[#1A1A1F]">
                              {formatPrice(p.price)}
                            </span>
                          )}
                          {p.duration && (
                            <>
                              <span className="text-[10px] text-[#B5ADA3]">·</span>
                              <span className="text-[10px] text-[#928980]">
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
                            className="text-[9px] px-1.5 py-0.5 rounded bg-[#FAF7F2] text-[#928980]"
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

        {/* 스태프 선택 */}
        <div className="px-4 pt-2 pb-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Users className="w-3.5 h-3.5 text-[#C4967E]" />
            <span className="text-[11px] font-semibold text-[#1A1A1F]">스태프 선택</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {staff.map((s) => {
              const isSelected = selectedStaff === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedStaff(isSelected ? null : s.id)}
                  disabled={disabled}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all
                    ${isSelected
                      ? "border-[#C4967E] bg-[#C4967E]/5 text-[#C4967E]"
                      : "border-black/[0.06] text-[#928980] hover:border-[#C4967E]/30"
                    } disabled:opacity-40`}
                >
                  {s.name}
                  {s.role && <span className="text-[10px] opacity-70 ml-1">{s.role}</span>}
                </button>
              );
            })}
            <button
              onClick={() => setSelectedStaff(null)}
              disabled={disabled}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all
                ${selectedStaff === null
                  ? "border-[#C4967E] bg-[#C4967E]/5 text-[#C4967E]"
                  : "border-black/[0.06] text-[#928980] hover:border-[#C4967E]/30"
                } disabled:opacity-40`}
            >
              상관없음
            </button>
          </div>
        </div>

        {/* 확인 버튼 */}
        <div className="px-4 pb-3">
          <button
            onClick={handleConfirm}
            disabled={disabled || !selectedProduct}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
              bg-[#1A1A1F] text-white text-[12px] font-medium
              hover:bg-[#2A2A2F] active:scale-[0.98]
              disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <Calendar className="w-3.5 h-3.5" />
            예약 가능 시간 확인
          </button>
        </div>
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
            <p className="text-[12px] text-[#928980]">
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
            <p className="text-[13px] font-semibold text-[#1A1A1F]">예약 가능 시간</p>
          </div>
          <p className="text-[10px] text-[#928980] mt-0.5">
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
                <p className={`text-[11px] font-medium mb-1.5 ${isWeekend ? "text-[#C4967E]" : "text-[#1A1A1F]"}`}>
                  {month}/{day} ({dayLabel})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {dateSlots.map((slot) => (
                    <button
                      key={`${slot.date}-${slot.time}`}
                      onClick={() => handleSelect(slot)}
                      disabled={disabled}
                      className="px-3 py-1.5 rounded-lg border border-black/[0.06] text-[11px]
                        text-[#1A1A1F] hover:border-[#C4967E] hover:text-[#C4967E] hover:bg-[#C4967E]/5
                        active:scale-[0.95] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      <span className="font-medium">{slot.time}</span>
                      {slot.remaining <= 2 && (
                        <span className="text-[9px] text-[#C4967E] ml-1">잔여{slot.remaining}</span>
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

function BookingConfirmCard({ result }: { result: ToolExecutionResult }) {
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
          <p className="text-[12px] text-red-600">{result.displayMessage}</p>
        </div>
      </div>
    );
  }

  const d = new Date(output.date);
  const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const dateLabel = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} (${DAYS[d.getDay()]})`;

  return (
    <div className="flex justify-start ml-12 my-2">
      <div className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white shadow-sm w-full max-w-[400px] overflow-hidden">
        {/* 헤더 */}
        <div className="px-4 pt-3 pb-2 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center">
            <CheckCircle2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[#1A1A1F]">예약이 접수되었습니다!</p>
            <p className="text-[10px] text-[#928980]">업체 확인 후 최종 확정됩니다</p>
          </div>
        </div>

        {/* 상세 */}
        <div className="px-4 pb-3">
          <div className="rounded-lg bg-white border border-black/[0.04] px-3 py-2.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-[#C4967E]" />
              <span className="text-[11px] text-[#928980]">업체</span>
              <span className="text-[11px] font-medium text-[#1A1A1F] ml-auto">{output.vendorName}</span>
            </div>
            {output.productName && (
              <div className="flex items-center gap-2">
                <Package className="w-3 h-3 text-[#C4967E]" />
                <span className="text-[11px] text-[#928980]">상품</span>
                <span className="text-[11px] font-medium text-[#1A1A1F] ml-auto">
                  {output.productName}
                  {output.amount > 0 && ` (${formatPrice(output.amount)})`}
                </span>
              </div>
            )}
            {output.staffName && (
              <div className="flex items-center gap-2">
                <Users className="w-3 h-3 text-[#C4967E]" />
                <span className="text-[11px] text-[#928980]">담당</span>
                <span className="text-[11px] font-medium text-[#1A1A1F] ml-auto">{output.staffName}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3 text-[#C4967E]" />
              <span className="text-[11px] text-[#928980]">일시</span>
              <span className="text-[11px] font-medium text-[#1A1A1F] ml-auto">
                {dateLabel} {output.time}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
