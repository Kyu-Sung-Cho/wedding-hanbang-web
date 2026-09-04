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
  FileCheck2,
  Search,
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
    recommendationPolicy?: string;
    coverageNote?: string;
    disclaimer?: string;
    vendors?: {
      id: string;
      name: string;
      location?: string | null;
      priceRange?: string | null;
      rating?: number | null;
      reviewCount?: number | null;
      tags?: string[];
      reasons?: string[];
      dataBadges?: string[];
      link: string;
    }[];
  };

  const vendors = output.vendors ?? [];
  const isOfficial = output.recommendationPolicy === "official_price_explainable_v1";
  const hasRating = (rating: number | null | undefined, reviewCount: number | null | undefined) =>
    Number.isFinite(rating) && Number.isFinite(reviewCount);

  if (vendors.length === 0 && isOfficial) {
    return (
      <div className="flex justify-start ml-14 my-2">
        <div className="max-w-[440px] rounded-[6px] border border-[#DDE8E1] bg-[#F8FBF9] px-5 py-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E4EFE8]">
              <FileCheck2 className="h-5 w-5 text-[#52715D]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-[var(--hb-text-strong)]">조건에 맞는 공시 업체를 찾지 못했어요</p>
              <p className="mt-1 text-sm leading-relaxed text-[#5D6861]">
                지역이나 예산, 필수 조건 중 하나를 조금 넓혀서 다시 찾아볼게요. 확인되지 않은 가격을 임의로 추천하지는 않을게요.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Historical conversations may still contain a retired vendor-tool result.
  if (vendors.length === 0) {
    return (
      <div className="flex justify-start ml-14 my-2">
        <div className="rounded-[6px] border border-[#F5F0E8] bg-gradient-to-br from-[#FAF7F2] to-white px-5 py-4 shadow-sm max-w-[440px]">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#C4967E]/15">
              <Sparkles className="w-5 h-5 text-[#C4967E]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-[var(--hb-text-strong)]">현재 업체 추천은 제공하지 않아요</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--hb-text-body)]">
                직접 받은 견적의 포함 항목·추가금·변경 및 환불 조건은 견적 체크에서 확인하고,
                아모라와 예산·할 일·일정을 정리할 수 있어요.
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
            className="rounded-[6px] border border-black/[0.06] bg-white px-5 py-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-lg font-semibold text-[var(--hb-text-strong)] truncate">
                  {v.name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  {hasRating(v.rating, v.reviewCount) && (
                    <>
                      <Star className="h-4 w-4 fill-[var(--hb-accent)] text-[var(--hb-primary)]" />
                      <span className="text-sm text-[var(--hb-text-muted)]">{v.rating} ({v.reviewCount})</span>
                    </>
                  )}
                  {v.location && (
                    <span className="flex items-center gap-1 text-sm text-[#68726C]">
                      <MapPin className="h-4 w-4 text-[#8A958E]" />
                      {v.location}
                    </span>
                  )}
                  {v.priceRange && (
                    <span className="text-sm font-medium text-[#52715D]">{v.priceRange}</span>
                  )}
                </div>
              </div>
            </div>

            {isOfficial && v.dataBadges && v.dataBadges.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {v.dataBadges.slice(0, 3).map((badge) => (
                  <span
                    key={badge}
                    className="rounded-full border border-[#CFE0D4] bg-[#F1F7F3] px-2.5 py-0.5 text-xs font-medium text-[#52715D]"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            )}

            {/* 태그 */}
            {v.tags && v.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {v.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="text-sm px-2.5 py-0.5 rounded-full bg-[#FAF7F2] text-[var(--hb-text-muted)] border border-black/[0.04]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* 추천 이유 */}
            {v.reasons && v.reasons.length > 0 && (
              isOfficial ? (
                <ul className="mt-2.5 space-y-1 text-sm leading-5 text-[#52715D]">
                  {v.reasons.slice(0, 3).map((reason) => (
                    <li key={reason} className="flex gap-2">
                      <span aria-hidden="true" className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-[#7F9A87]" />
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 truncate text-sm text-[#C4967E]">
                  {v.reasons.slice(0, 3).join(" · ")}
                </p>
              )
            )}

            {/* 버튼 */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {isOfficial ? (
                <>
                  <Link
                    href={v.link}
                    className="flex flex-1 items-center justify-center gap-2 rounded-[6px] bg-[#52715D] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#405D4A]"
                  >
                    <FileCheck2 className="h-4 w-4" />
                    공시 가격·근거 보기
                  </Link>
                  {onSend && (
                    <button
                      type="button"
                      onClick={() => onSend(`${v.name} 추천 이유와 확인할 점을 더 알려줘 [vendor:${v.id}]`)}
                      disabled={disabled}
                      className="flex h-10 items-center justify-center rounded-[6px] border border-[#DDE8E1] px-3 text-sm text-[#52715D] transition-colors hover:bg-[#F1F7F3] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      더 물어보기
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    onClick={() => onSend?.(`${v.name} 상세 정보 보여줘 [vendor:${v.id}]`)}
                    disabled={disabled}
                    className="flex flex-1 items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-4 py-2.5 text-sm font-medium text-white transition-colors bg-[var(--hb-text-body)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Package className="h-4 w-4" />
                    상품·스태프 보기
                  </button>
                  <Link
                    href={v.link}
                    className="flex h-10 w-10 items-center justify-center rounded-[6px] border border-black/[0.06] text-[var(--hb-text-muted)] transition-colors hover:border-[#C4967E]/30 hover:text-[#C4967E]"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Link>
                </>
              )}
            </div>
          </div>
        ))}
        {isOfficial && (output.coverageNote || output.disclaimer) && (
          <div className="rounded-[6px] border border-[#E3E9E5] bg-[#FAFCFA] px-4 py-3 text-xs leading-relaxed text-[#68726C]">
            {output.coverageNote && <p>{output.coverageNote}</p>}
            {output.disclaimer && <p className={output.coverageNote ? "mt-1" : undefined}>{output.disclaimer}</p>}
          </div>
        )}
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
    profilePolicy?: string;
    dataStatus?: string;
    vendorId: string;
    vendorName: string;
    location?: string | null;
    profileLink?: string;
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
    officialProfile?: {
      tags?: { slug: string; label: string; tag_group: string }[];
      official_prices?: {
        id: string;
        item_name: string;
        price_min_krw: number | null;
        price_max_krw: number | null;
        period_label: string;
        source: string;
      }[];
      data_badges?: string[];
      sources?: string[];
    };
    bookingData?: {
      policy: string;
      auxiliary: boolean;
      notice?: string;
      products?: {
        id: string;
        name: string;
        description: string;
        price: number;
        discountPrice: number | null;
        duration: number | null;
        isPopular: boolean;
        includes: string[];
      }[];
      staff?: {
        id: string;
        name: string;
        role: string | null;
        description: string;
      }[];
    };
  };

  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const products = useMemo(
    () => output.bookingData?.products ?? output.products ?? [],
    [output.bookingData?.products, output.products],
  );
  const staff = useMemo(
    () => output.bookingData?.staff ?? output.staff ?? [],
    [output.bookingData?.staff, output.staff],
  );
  const hasStaff = staff.length > 0;
  const isOfficial = output.profilePolicy === "official_disclosure_profile_v1";
  const officialPrices = output.officialProfile?.official_prices ?? [];
  const officialMoneyRange = (min: number | null, max: number | null) => {
    if (min === null && max === null) return "금액 별도 확인";
    if (min === null) return `${formatPrice(max!)} 이하`;
    if (max === null || min === max) return formatPrice(min);
    return `${formatPrice(min)} ~ ${formatPrice(max)}`;
  };

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
      <div className="rounded-[6px] border border-black/[0.06] bg-white shadow-sm w-full max-w-[460px] overflow-hidden">
        {/* 헤더 */}
        <div className="px-5 py-4 bg-gradient-to-r from-[#FAF7F2] to-[#F5F0E8] border-b border-black/[0.04]">
          <p className="text-lg font-semibold text-[var(--hb-text-strong)]">{output.vendorName}</p>
          <p className="text-sm text-[var(--hb-text-muted)] mt-1">
            {isOfficial
              ? "공시 근거를 먼저 확인하고, 필요하면 예약 보조 정보를 이어서 보세요"
              : hasStaff ? "상품과 스태프를 선택해 주세요" : "상품을 선택하면 등록된 방문·상담 시간 후보를 확인할 수 있어요"}
          </p>
        </div>

        {isOfficial && (
          <section className="border-b border-[#E3E9E5] bg-[#FAFCFA] px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileCheck2 className="h-5 w-5 text-[#52715D]" />
                <h3 className="text-base font-semibold text-[#263A2D]">확인된 공시 정보</h3>
              </div>
              {output.profileLink && (
                <Link
                  href={output.profileLink}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#52715D] underline-offset-2 hover:underline"
                >
                  전체 근거 보기
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
            {output.location && (
              <p className="mt-2 flex items-center gap-1 text-sm text-[#68726C]">
                <MapPin className="h-4 w-4" />
                {output.location}
              </p>
            )}
            {(output.officialProfile?.data_badges?.length ?? 0) > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {output.officialProfile!.data_badges!.slice(0, 4).map((badge) => (
                  <span key={badge} className="rounded-full border border-[#CFE0D4] bg-white px-2.5 py-0.5 text-xs font-medium text-[#52715D]">
                    {badge}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-3 space-y-2.5">
              {officialPrices.slice(0, 3).map((price) => (
                <article key={price.id} className="rounded-[6px] border border-[#E3E9E5] bg-white px-3.5 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-[#263A2D]">{price.item_name}</p>
                    <p className="text-sm font-semibold text-[#52715D]">
                      {officialMoneyRange(price.price_min_krw, price.price_max_krw)}
                    </p>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#68726C]">{price.source}</p>
                </article>
              ))}
              {officialPrices.length === 0 && (
                <p className="text-sm text-[#68726C]">공개 가능한 공시 가격 항목이 아직 없어요.</p>
              )}
            </div>
            {(output.officialProfile?.tags?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {output.officialProfile!.tags!.slice(0, 6).map((tag) => (
                  <span key={tag.slug} className="rounded-full bg-[#EEF4F0] px-2.5 py-1 text-xs text-[#52715D]">
                    {tag.label}
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 상품 선택 */}
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center gap-2 mb-2.5">
            <Package className="w-5 h-5 text-[#C4967E]" />
            <span className="text-base font-semibold text-[var(--hb-text-strong)]">
              {isOfficial ? "예약 보조 정보" : "상품 선택"}
            </span>
          </div>

          {isOfficial && output.bookingData?.notice && (
            <p className="mb-3 rounded-[6px] bg-[#FFF8F1] px-3 py-2 text-xs leading-relaxed text-[#7A6656]">
              {output.bookingData.notice}
            </p>
          )}

          {products.length === 0 ? (
            <p className="text-sm text-[var(--hb-text-muted)] py-2">
              {isOfficial ? "등록된 예약 보조 상품이 없습니다" : "등록된 상품이 없습니다"}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {products.map((p) => {
                const isSelected = selectedProduct === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => handleProductSelect(p.id)}
                    disabled={disabled || confirmed}
                    className={`w-full text-left px-4 py-3 rounded-[6px] border transition-colors
                      ${isSelected
                        ? "border-[#C4967E] bg-[#C4967E]/5"
                        : "border-black/[0.06] hover:border-[#C4967E]/30 bg-white"
                      } disabled:opacity-40`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-base font-medium ${isSelected ? "text-[#C4967E]" : "text-[var(--hb-text-strong)]"}`}>
                            {p.name}
                          </p>
                          {p.isPopular && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-[rgba(54,83,78,0.12)] text-[var(--hb-primary)] font-medium">
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
                              <span className="text-sm text-[var(--hb-text-muted)] line-through">
                                {formatPrice(p.price)}
                              </span>
                            </>
                          ) : (
                            <span className="text-sm font-semibold text-[var(--hb-text-strong)]">
                              {formatPrice(p.price)}
                            </span>
                          )}
                          {p.duration && (
                            <>
                              <span className="text-sm text-[var(--hb-text-muted)]">·</span>
                              <span className="text-sm text-[var(--hb-text-muted)]">
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
                            className="text-xs px-2 py-0.5 rounded-[6px] bg-[#FAF7F2] text-[var(--hb-text-muted)]"
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
              <span className="text-base font-semibold text-[var(--hb-text-strong)]">스태프 선택</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {staff.map((s) => {
                const isSelected = selectedStaff === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStaff(isSelected ? null : s.id)}
                    disabled={disabled || confirmed}
                    className={`px-4 py-2 rounded-[6px] text-sm font-medium border transition-colors
                      ${isSelected
                        ? "border-[#C4967E] bg-[#C4967E]/5 text-[#C4967E]"
                        : "border-black/[0.06] text-[var(--hb-text-muted)] hover:border-[#C4967E]/30"
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
                className={`px-4 py-2 rounded-[6px] text-sm font-medium border transition-colors
                  ${selectedStaff === null
                    ? "border-[#C4967E] bg-[#C4967E]/5 text-[#C4967E]"
                    : "border-black/[0.06] text-[var(--hb-text-muted)] hover:border-[#C4967E]/30"
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
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-[6px]
                bg-[var(--hb-primary)] text-white text-base font-medium
                bg-[var(--hb-text-body)] active:scale-[0.98]
                disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Calendar className="w-5 h-5" />
              가능 시간 후보 확인
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

    onSend?.(`${dateLabel} ${slot.time} 예약 요청 기록으로 남길게요 ${tags}`);
  };

  if (slots.length === 0) {
    return (
      <div className="flex justify-start ml-14 my-2">
        <div className="rounded-[6px] border border-black/[0.06] bg-white px-5 py-4 shadow-sm max-w-[440px]">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-[var(--hb-text-muted)]" />
            <p className="text-base text-[var(--hb-text-muted)]">
              {filterLabel
                ? `${filterLabel}에 아모라에 등록된 가능 시간 후보가 없습니다`
                : "아모라에 등록된 가능 시간 후보가 없습니다"}
            </p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--hb-text-muted)]">
            실제 가능 여부와 최종 확정은 업체에 별도로 확인해 주세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start ml-14 my-2">
      <div className="rounded-[6px] border border-black/[0.06] bg-white shadow-sm w-full max-w-[460px] overflow-hidden">
        {/* 헤더 */}
        <div className="px-5 py-4 bg-gradient-to-r from-[#FAF7F2] to-[#F5F0E8] border-b border-black/[0.04]">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-[#C4967E]" />
            <p className="text-lg font-semibold text-[var(--hb-text-strong)]">아모라에 등록된 가능 시간 후보</p>
          </div>
          <p className="text-sm text-[var(--hb-text-muted)] mt-1">
            {output.vendorName}
            {filterLabel && !usingFallback ? ` · ${filterLabel}` : ""}
            {" · 실제 가능 여부와 최종 확정은 업체 확인이 필요해요"}
          </p>
          {usingFallback && (
            <p className="mt-2 text-xs text-[#9A6B62] bg-[#C4967E]/10 rounded-[6px] px-2 py-1.5 inline-block">
              💡 {filterLabel}에는 등록 후보가 없어 인접한 시기의 참고 후보를 보여드려요
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
                <p className={`text-base font-medium mb-2 ${isWeekend ? "text-[#C4967E]" : "text-[var(--hb-text-strong)]"}`}>
                  {month}/{day} ({dayLabel})
                </p>
                <div className="flex flex-wrap gap-2">
                  {dateSlots.map((slot) => (
                    <button
                      key={`${slot.date}-${slot.time}`}
                      onClick={() => handleSelect(slot)}
                      disabled={disabled}
                      className="px-4 py-2 rounded-[6px] border border-black/[0.06] text-sm
                        text-[var(--hb-text-strong)] hover:border-[#C4967E] hover:text-[#C4967E] hover:bg-[#C4967E]/5
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
    quotedAmount: number;
    amountBasis: "quote";
    status: string;
    completedSchedulePreserved?: boolean;
    projectionStatus?: "completed" | "pending_retry" | "failed";
  };

  if (!result.success) {
    return (
      <div className="flex justify-start ml-14 my-2">
        <div className="rounded-[6px] border border-red-200 bg-red-50 px-5 py-4 shadow-sm max-w-[440px]">
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
    onSend?.(`아모라 예약 요청 기록을 취소로 표시해줘 [booking:${output.bookingId}]`);
  };

  return (
    <div className="flex justify-start ml-11 my-1.5">
      <div className={`rounded-[6px] border shadow-sm w-full max-w-[24rem] overflow-hidden ${
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
            <p className="text-sm font-semibold text-[var(--hb-text-strong)]">
              {cancelled ? "아모라 기록 취소 표시 요청됨" : "아모라에 예약 요청을 기록했어요"}
            </p>
            <p className="text-xs text-[var(--hb-text-muted)]">
              {cancelled
                ? "업체 취소 전달·확정은 별도 확인"
                : "업체에 전달되거나 확정된 상태가 아니에요"}
            </p>
          </div>
        </div>

        {/* 상세 */}
        <div className="px-4 pb-3">
          <div className="rounded-[6px] bg-white border border-black/[0.04] px-3 py-2.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#C4967E]" />
              <span className="text-xs text-[var(--hb-text-muted)]">업체</span>
              <span className="text-xs font-medium text-[var(--hb-text-strong)] ml-auto">{output.vendorName}</span>
            </div>
            {output.productName && (
              <div className="flex items-center gap-2">
                <Package className="w-3.5 h-3.5 text-[#C4967E]" />
                <span className="text-xs text-[var(--hb-text-muted)]">상품</span>
                <span className="text-xs font-medium text-[var(--hb-text-strong)] ml-auto">
                  {output.productName}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <FileCheck2 className="w-3.5 h-3.5 text-[#C4967E]" />
              <span className="text-xs text-[var(--hb-text-muted)]">아모라 내부 후보 견적</span>
              <span className="text-xs font-medium text-[var(--hb-text-strong)] ml-auto">
                {output.quotedAmount > 0 ? formatPrice(output.quotedAmount) : "미확정"}
              </span>
            </div>
            {output.staffName && (
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-[#C4967E]" />
                <span className="text-xs text-[var(--hb-text-muted)]">담당</span>
                <span className="text-xs font-medium text-[var(--hb-text-strong)] ml-auto">{output.staffName}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-[#C4967E]" />
              <span className="text-xs text-[var(--hb-text-muted)]">일시</span>
              <span className="text-xs font-medium text-[var(--hb-text-strong)] ml-auto">
                {dateLabel} {output.time}
              </span>
            </div>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-[#6F6862]">
            이 금액은 결제·지출 기록이 아니에요. 실제 지출은 별도로 확인해 기록해요.
          </p>

          {output.projectionStatus === "pending_retry" && (
            <div className="mt-2 rounded-[6px] border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-semibold text-amber-800">일정 반영 중</p>
              <p className="mt-0.5 text-xs leading-relaxed text-amber-700">
                아모라 안 요청 기록은 저장됐어요. 자동으로 다시 반영하니 같은 기록을 다시 만들 필요는 없어요.
              </p>
            </div>
          )}
          {output.projectionStatus === "failed" && (
            <div className="mt-2 rounded-[6px] border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs font-semibold text-red-700">일정 반영 확인 필요</p>
              <p className="mt-0.5 text-xs leading-relaxed text-red-600">
                아모라 안 요청 기록은 저장됐어요. 같은 기록을 다시 만들지 말고 고객지원에 알려주세요.
              </p>
            </div>
          )}

          {/* 취소 버튼 */}
          {!cancelled && (
            <div className="mt-2">
              {showCancelConfirm ? (
                <div className="flex items-center justify-between bg-red-50 rounded-[6px] px-3 py-2">
                  <p className="text-xs text-red-600">
                    아모라 안 기록만 취소로 표시할까요? 업체 취소는 별도예요.
                  </p>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setShowCancelConfirm(false)}
                      className="px-2.5 py-1 text-xs rounded-[6px] bg-white border border-black/[0.06] text-[var(--hb-text-muted)]"
                    >
                      아니요
                    </button>
                    <button
                      onClick={handleCancel}
                      disabled={disabled}
                      className="px-2.5 py-1 text-xs rounded-[6px] bg-red-500 text-white disabled:opacity-40"
                    >
                      기록 취소 표시
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  disabled={disabled}
                  className="text-xs text-[var(--hb-text-muted)] hover:text-red-400 transition-colors disabled:opacity-40"
                >
                  기록 취소 표시
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
    recordedSpendPreserved?: boolean;
    completedSchedulePreserved?: boolean;
    quoteContributionCorrected?: boolean;
    quoteCorrectionAmount?: number;
    refundStatus?: "unknown";
    projectionStatus?: "completed" | "pending_retry" | "failed";
  };

  if (!result.success) {
    return (
      <div className="flex justify-start ml-14 my-2">
        <div className="rounded-[6px] border border-red-200 bg-red-50 px-5 py-4 shadow-sm max-w-[440px]">
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
      <div className="rounded-[6px] border border-gray-200 bg-gradient-to-r from-gray-50 to-white shadow-sm w-full max-w-[440px] overflow-hidden">
        <div className="px-5 pt-4 pb-2.5 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-gray-400 flex items-center justify-center">
            <X className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-lg font-semibold text-[var(--hb-text-strong)]">아모라 예약 기록을 취소로 표시했어요</p>
          </div>
        </div>
        <div className="px-5 pb-4">
          <div className="rounded-[6px] bg-white border border-black/[0.04] px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[var(--hb-text-muted)]" />
              <span className="text-sm text-[var(--hb-text-muted)]">업체</span>
              <span className="text-sm font-medium text-[var(--hb-text-muted)] ml-auto line-through">{output.vendorName}</span>
            </div>
            {output.productName && (
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-[var(--hb-text-muted)]" />
                <span className="text-sm text-[var(--hb-text-muted)]">상품</span>
                <span className="text-sm font-medium text-[var(--hb-text-muted)] ml-auto line-through">{output.productName}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[var(--hb-text-muted)]" />
              <span className="text-sm text-[var(--hb-text-muted)]">일시</span>
              <span className="text-sm font-medium text-[var(--hb-text-muted)] ml-auto line-through">{dateLabel} {output.time}</span>
            </div>
          </div>
          <div className="mt-2 rounded-[6px] border border-slate-200 bg-slate-50 px-3 py-2">
            {output.completedSchedulePreserved && (
              <p className="text-xs leading-relaxed text-slate-700">
                연결 일정은 이미 완료 기록이라 취소로 바꾸지 않고 보존했어요.
              </p>
            )}
            {output.recordedSpendPreserved && (
              <p className="text-xs leading-relaxed text-slate-700">
                기록된 실제 지출은 유지돼요. 아모라 기록의 취소 표시만으로 환불 처리하지 않아요.
              </p>
            )}
            {output.quoteContributionCorrected && (
              <p className="text-xs leading-relaxed text-slate-700">
                과거에 지출로 잘못 반영된 견적
                {typeof output.quoteCorrectionAmount === "number"
                  ? ` ${formatPrice(output.quoteCorrectionAmount)}`
                  : ""}만 바로잡았어요.
              </p>
            )}
            <p className="text-xs leading-relaxed text-slate-700">
              업체 취소는 전달되거나 확정되지 않았어요.
            </p>
            <p className="text-xs leading-relaxed text-slate-700">
              환불 여부와 금액은 아직 확인되지 않았어요. 업체 조건을 확인해 주세요.
            </p>
          </div>
          {output.projectionStatus === "pending_retry" && (
            <div className="mt-2 rounded-[6px] border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-semibold text-amber-800">일정 취소 상태 반영 중</p>
              <p className="mt-0.5 text-xs leading-relaxed text-amber-700">
                아모라 안 취소 표시는 저장됐어요. 자동으로 다시 반영하니 같은 취소 표시를 다시 보낼 필요는 없어요.
              </p>
            </div>
          )}
          {output.projectionStatus === "failed" && (
            <div className="mt-2 rounded-[6px] border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs font-semibold text-red-700">일정 취소 상태 확인 필요</p>
              <p className="mt-0.5 text-xs leading-relaxed text-red-600">
                아모라 안 취소 표시는 저장됐어요. 같은 취소 표시를 다시 보내지 말고 고객지원에 알려주세요.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── E. 네이버 지역 검색 장소 카드 ──

/**
 * 조회 시각을 KST 시:분으로 적는다. (2026-09-03)
 *
 * 기본 시간대를 쓰면 서버·기기 시간대를 타서 한국 새벽에 엉뚱한 시각이 뜬다.
 * `hourCycle: "h23"` 은 자정을 `24:00` 이 아니라 `00:00` 으로 쓰기 위한 것이다.
 */
const PLACE_SEARCHED_AT_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * 받침에 맞는 조사. '대전 식당'으로 / '강남 카페'로. (2026-09-03)
 * 한글 음절이 아니면 '로' 로 둔다 — 숫자·영문 뒤에서는 어느 쪽도 완전하지 않다.
 */
function withRoParticle(word: string): string {
  const last = word.trim().slice(-1);
  if (!last) return "로";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "로";
  const jongseong = (code - 0xac00) % 28;
  return jongseong === 0 || jongseong === 8 ? "로" : "으로";
}

export function placeSearchedAtLabel(searchedAt: unknown): string | null {
  if (typeof searchedAt !== "string" || !searchedAt) return null;
  const parsed = new Date(searchedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return PLACE_SEARCHED_AT_FORMATTER.format(parsed);
}

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
      mapsUrl: string;
      blogSearchUrl: string;
      link: string | null;
      imageUrl: string | null;
      imageSourceUrl: string | null;
      searchUrl: string;
      regionLabel?: string | null;
    }[];
    query?: string;
    searchedAt?: string;
    providerUnavailable?: boolean;
    // 저장된 결과에는 제공자 텍스트가 없고 우리 값만 남는다(2026-09-03).
    displayOnlyPlaceholder?: boolean;
    resultCount?: number;
    reason?: string;
    handoff?: {
      searchUrl?: string;
      mapsUrl?: string;
    };
  };
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set());

  const safeNaverUrl = (value: string | undefined): string | null => {
    if (!value) return null;
    try {
      const url = new URL(value);
      const isNaver = url.hostname === "naver.com" || url.hostname.endsWith(".naver.com");
      return url.protocol === "https:" && isNaver && !url.username && !url.password
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  };

  // 다시 열었을 때. 네이버 항목은 저장하지 않으므로 카드 자리에 우리 값만 적는다
  // (2026-09-03 — 예전에는 새로고침하면 카드가 통째로 사라졌다).
  if (output.displayOnlyPlaceholder) {
    const restoredQuery = output.query ?? "";
    const restoredCount = typeof output.resultCount === "number" ? output.resultCount : 0;
    const restoredAt = placeSearchedAtLabel(output.searchedAt);
    return (
      <div className="flex justify-start ml-14 my-2">
        <div
          role="note"
          className="rounded-[6px] border border-[#F5F0E8] bg-gradient-to-br from-[#FAF7F2] to-white px-5 py-4 shadow-sm max-w-[440px]"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#C4967E]/15">
              <MapPin className="w-5 h-5 text-[#C4967E]" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-[var(--hb-text-strong)]">
                {restoredAt ? `${restoredAt}에 ` : ""}
                &apos;{restoredQuery}&apos;{withRoParticle(restoredQuery)} {restoredCount}곳을 찾았어요
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--hb-text-body)]">
                검색 결과 카드는 저장하지 않아서 다시 열면 사라져요. 다시 검색할까요?
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 웨딩 업체 질의는 여기서 검색하지 않는다. 그건 실패가 아니라 안내이므로
  // 빨간 경고가 아니라 중립 카드로 그린다(2026-09-03 감사). 차단 자체는 그대로다.
  if (output.reason === "wedding_vendor_query_blocked") {
    return (
      <div className="flex justify-start ml-14 my-2">
        <div
          role="note"
          className="rounded-[6px] border border-[#F5F0E8] bg-gradient-to-br from-[#FAF7F2] to-white px-5 py-4 shadow-sm max-w-[440px]"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#C4967E]/15">
              <MapPin className="w-5 h-5 text-[#C4967E]" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-[var(--hb-text-strong)]">
                예식장·웨딩홀은 업체 탐색에서 볼 수 있어요
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--hb-text-body)]">
                {result.displayMessage
                  || "예식장·웨딩홀은 여기서 검색하지 않고 업체 탐색에서 볼 수 있어요."}
              </p>
              {/* 2026-09-04: 갈 곳을 말해 놓고 길은 안 내줬다. 차단은 그대로다. */}
              <Link
                href="/vendors"
                className="mt-2 inline-flex min-h-9 items-center rounded-[6px] bg-[#C4967E]/15 px-3 text-sm font-semibold text-[#8B5E48] hover:bg-[#C4967E]/25"
              >
                업체 탐색 열기
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handoffSearchUrl = safeNaverUrl(output.handoff?.searchUrl);
  const handoffMapsUrl = safeNaverUrl(output.handoff?.mapsUrl);
  if (output.providerUnavailable && (handoffSearchUrl || handoffMapsUrl)) {
    const primaryUrl = handoffSearchUrl ?? handoffMapsUrl!;
    return (
      <div className="flex justify-start ml-14 my-2">
        <div className="w-full max-w-[440px] overflow-hidden rounded-[6px] border border-[#DCE8DA] bg-white shadow-sm">
          <a
            href={primaryUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${output.query || "장소"} 네이버 검색에서 보기`}
            className="flex items-start gap-3 px-5 py-4 outline-none transition-colors hover:bg-[#F7FAF5] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2DB400]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2DB400]/10">
              <Search className="h-5 w-5 text-[#218A00]" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-[var(--hb-text-strong)]">
                {output.query ? `‘${output.query}’ 네이버™에서 바로 보기` : "네이버™에서 바로 검색하기"}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--hb-text-body)]">
                검색 결과 연결이 지연되고 있어 네이버의 최신 검색 화면으로 바로 이어드려요.
              </p>
              <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[#218A00]">
                네이버 검색 열기
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
          </a>
          {handoffMapsUrl && (
            <a
              href={handoffMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 border-t border-black/[0.05] py-3 text-sm font-medium text-[var(--hb-text-strong)] transition-colors hover:bg-[#FAF7F2]"
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              네이버 지도에서 보기
            </a>
          )}
          <p className="border-t border-black/[0.05] bg-[#FAFAF8] px-4 py-2 text-[10px] text-[var(--hb-text-muted)]">
            네이버™는 NAVER®의 등록상표입니다.
          </p>
        </div>
      </div>
    );
  }

  if (!result.success) {
    return (
      <div className="flex justify-start ml-14 my-2">
        <div
          role="alert"
          className="w-full max-w-[440px] rounded-[6px] border border-red-200 bg-red-50 px-5 py-4 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
              <MapPin className="h-5 w-5 text-red-500" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-red-700">장소 검색을 완료하지 못했어요</p>
              <p className="mt-1 text-sm leading-relaxed text-red-600">
                {result.displayMessage || "잠시 후 다시 검색해 주세요."}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const places = output.places ?? [];
  if (places.length === 0) {
    return (
      <div className="flex justify-start ml-14 my-2">
        <div className="rounded-[6px] border border-[#F5F0E8] bg-gradient-to-br from-[#FAF7F2] to-white px-5 py-4 shadow-sm max-w-[440px]">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#C4967E]/15">
              <MapPin className="w-5 h-5 text-[#C4967E]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-[var(--hb-text-strong)]">
                {output.query ? `'${output.query}' 근처 결과를 못 찾았어요` : "근처 장소 검색 결과가 없어요"}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--hb-text-body)]">
                다른 키워드로 다시 물어봐 주시거나, 좀 더 넓은 지역으로 알려주시면 다시 찾아볼게요.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const searchedAtLabel = placeSearchedAtLabel(output.searchedAt);

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
            <span className="text-sm text-[var(--hb-text-muted)] font-medium">
              &apos;{output.query}&apos; 네이버™ 검색 결과
            </span>
          </div>
        )}

        {places.map((p, idx) => (
          <div
            key={p.id}
            className="rounded-[6px] border border-black/[0.06] bg-white shadow-sm hover:shadow-md hover:border-[#C4967E]/20 transition-colors overflow-hidden"
          >
            {/* 메인 컨텐츠 — 하단 지도/블로그 링크와 분리된 단일 검색 링크 */}
            <a
              href={p.searchUrl || p.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${p.name} 네이버에서 리뷰·별점 보기`}
              className="block px-5 pt-4 pb-3.5 outline-none transition-colors hover:bg-[var(--hb-surface-page)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#A77B74]"
            >
              <div className="flex items-start gap-3">
                {/* 네이버 이미지 검색 대표 사진 + 순위 */}
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[6px] border border-black/[0.05] bg-[#FAF7F2] sm:h-24 sm:w-24">
                  <span className="absolute left-1.5 top-1.5 z-10 flex h-7 min-w-7 items-center justify-center rounded-[6px] border border-black/[0.05] bg-white/95 px-1 text-sm font-semibold text-[#C4967E] shadow-sm">
                    {idx + 1}
                  </span>
                  {p.imageUrl && !failedImageIds.has(p.id) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Naver search thumbnails have dynamic pstatic paths.
                    <img
                      src={p.imageUrl}
                      alt={`${p.name} 검색 사진`}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                      onError={() => {
                        setFailedImageIds((previous) => {
                          if (previous.has(p.id)) return previous;
                          const next = new Set(previous);
                          next.add(p.id);
                          return next;
                        });
                      }}
                    />
                  ) : (
                    <div
                      role="img"
                      aria-label={
                        failedImageIds.has(p.id)
                          ? `${p.name} 사진을 불러오지 못했어요`
                          : `${p.name} 검색 사진이 아직 없어요`
                      }
                      className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 text-center text-[var(--hb-text-muted)]"
                    >
                      <MapPin className="h-5 w-5 text-[#A77B74]" aria-hidden="true" />
                      <span className="text-[10px] leading-tight">사진 준비 중</span>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {/* 이름 + 검색 링크 표시 */}
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-lg font-semibold text-[var(--hb-text-strong)]">
                      {p.name}
                    </p>
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-[var(--color-rose-700)] sm:text-xs">
                      리뷰·별점 보기
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </div>

                  {/* 태그 줄: 지역(두 지역을 함께 찾았을 때만) + 음식종류 + 세부카테고리 */}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {p.regionLabel && (
                      <span className="text-sm px-2.5 py-0.5 rounded-full bg-[#5a6147]/10 text-[#5a6147] font-medium">
                        {p.regionLabel}
                      </span>
                    )}
                    {p.cuisineType && (
                      <span className="text-sm px-2.5 py-0.5 rounded-full bg-[#1A1A1F]/[0.06] text-[var(--hb-text-strong)] font-medium">
                        {cuisineEmoji[p.cuisineType] || "🍴"} {p.cuisineType}
                      </span>
                    )}
                    {p.category && p.category !== p.cuisineType && (
                      <span className="text-sm px-2.5 py-0.5 rounded-full bg-[#C4967E]/10 text-[#C4967E] font-medium">
                        {p.category}
                      </span>
                    )}
                  </div>

                  {p.description && (
                    <p className="text-sm text-[#6B6560] mt-2 leading-[1.5] line-clamp-2">
                      {p.description}
                    </p>
                  )}

                  {/* 주소 + 전화 */}
                  <div className="flex items-center gap-3 mt-2.5">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-[var(--hb-text-muted)] shrink-0" />
                      <span className="text-sm text-[var(--hb-text-muted)] truncate max-w-[220px]">
                        {p.address}
                      </span>
                    </div>
                    {p.telephone && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-[var(--hb-text-muted)] shrink-0" />
                        <span className="text-sm text-[var(--hb-text-muted)]">
                          {p.telephone}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </a>

            {/* 하단 액션 버튼 */}
            <div className="flex border-t border-black/[0.04]">
              <a
                href={p.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium text-[var(--hb-text-strong)] hover:bg-[#FAF7F2] transition-colors"
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

            <div
              role="note"
              className="flex flex-col gap-1 border-t border-black/[0.04] bg-[#FAFAF8] px-4 py-2.5 text-[11px] leading-relaxed text-[var(--hb-text-muted)] sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              {p.imageUrl && (
                <span className="shrink-0 font-medium text-[#7A6F66]">사진 출처: 네이버 이미지 검색</span>
              )}
              {/* 광고·제휴인지 묻는 질문에 화면이 답한다(2026-09-03). 우리는 네이버
                  일반 지역검색만 부르므로 이건 우리가 단언할 수 있는 사실이다.
                  조회 시각은 실행기가 넣은 `searchedAt` — 없으면 그 문장만 뺀다. */}
              <span>
                {searchedAtLabel
                  ? `네이버 지역검색 일반 결과예요(광고·제휴 아님). 정렬은 네이버 기준이고, 조회 시각은 ${searchedAtLabel} 입니다. 리뷰 수·별점과 가격은 카드를 눌러 네이버에서 확인해 주세요. 네이버™는 NAVER®의 등록상표입니다.`
                  : "네이버 지역검색 일반 결과예요(광고·제휴 아님). 정렬은 네이버 기준이에요. 리뷰 수·별점과 가격은 카드를 눌러 네이버에서 확인해 주세요. 네이버™는 NAVER®의 등록상표입니다."}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
