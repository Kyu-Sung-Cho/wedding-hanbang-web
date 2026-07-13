"use client";

import { useState, useEffect, use, useId } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Star, MapPin, Phone, Clock, Sparkles, CalendarCheck, Check, Package, Tag, ChevronDown, ChevronUp, Timer, Loader2, MessageSquare, Send, X, Users, Heart, Image as ImageIcon, MessageCircle } from "lucide-react";
import Link from "next/link";
import { CATEGORY_PRODUCT_FIELDS, formatDuration, type ProductFieldDef } from "@/data/vendorFields";
import { weddingPath } from "@/lib/weddingPaths";
import type { Vendor, VendorProduct } from "@/types/vendor.types";
import { useEventTracker, useViewDuration } from "@/hooks/useEventTracker";
import { useAccessibleDialog } from "@/hooks/useAccessibleDialog";
import { formatLocalDateOnly, nextLocalDateForDatabaseWeekday } from "@hanbang/shared";

interface ReviewItem {
  id: string;
  rating: number;
  content: string | null;
  images: string[] | null;
  reply: string | null;
  replied_at: string | null;
  created_at: string;
}

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const BOOKING_REQUESTS_ENABLED = false as const;
const VENDOR_MESSAGES_ENABLED = false as const;

function formatPrice(price: number): string {
  if (price >= 10000) return `${(price / 10000).toFixed(0)}만원`;
  return `${price.toLocaleString()}원`;
}

function renderFieldValue(field: ProductFieldDef, value: unknown): string {
  if (value === undefined || value === null) return "-";
  if (field.type === "boolean") return value ? "포함" : "미포함";
  if (field.type === "multiselect" && Array.isArray(value)) return value.join(", ");
  if (field.type === "number" && field.unit) return `${value}${field.unit}`;
  return String(value);
}

// 상품 카드
function ProductCard({ product, category, isSelected, onSelect }: {
  product: VendorProduct;
  category: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = CATEGORY_PRODUCT_FIELDS[category as keyof typeof CATEGORY_PRODUCT_FIELDS];
  const hasSlots = product.timeSlots.some((s) => s.available);

  return (
    <div className={`rounded-xl transition-all ${isSelected ? "bg-[#F6F3F2] shadow-[0_8px_30px_rgba(121,82,82,0.08)] ring-1 ring-[#795252]/20" : "bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_40px_rgb(0,0,0,0.06)]"}`}>
      <div className="p-4 cursor-pointer" onClick={onSelect}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-base font-medium text-[#1A1A1F]">{product.name}</h4>
            </div>
            <div className="flex items-center gap-3">
              {product.discountPrice ? (
                <>
                  <span className="text-[17px] font-medium text-[#795252]">{formatPrice(product.discountPrice)}</span>
                  <span className="text-sm text-[#B5ADA3] line-through">{formatPrice(product.price)}</span>
                </>
              ) : (
                <span className="text-[17px] font-medium text-[#1A1A1F]">{formatPrice(product.price)}</span>
              )}
              <span className="text-sm text-[#B5ADA3] flex items-center gap-1">
                <Timer className="w-4 h-4" />{formatDuration(product.duration)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {hasSlots && <span className="px-2 py-0.5 rounded-full bg-[#2E7D5A]/10 text-sm text-[#2E7D5A] font-medium">운영시간 공개</span>}
            {isSelected && (
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
              </div>
            )}
          </div>
        </div>

        {product.includes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {product.includes.slice(0, 4).map((item, idx) => (
              <span key={idx} className="px-2 py-0.5 rounded-full bg-[#F6F3F2] text-sm text-[#504444] font-medium">{item}</span>
            ))}
            {product.includes.length > 4 && (
              <span className="px-2 py-0.5 rounded-full bg-[#F6F3F2] text-sm text-[#B5ADA3]">+{product.includes.length - 4}</span>
            )}
          </div>
        )}
      </div>

      <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm text-[#B5ADA3] hover:text-[#795252] transition-colors">
        {expanded ? "접기" : "상세 보기"}
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {product.description && (
            <p className="mt-3 mb-3 text-[13px] font-medium leading-[1.65] text-[#5d6879]">{product.description}</p>
          )}
          <div className="space-y-1.5">
            {config?.fields.map((field) => {
              const val = product.categoryFields[field.key];
              if (val === undefined || val === null || val === "" || val === false) return null;
              return (
                <div key={field.key} className="flex items-center justify-between">
                  <span className="text-sm text-[#B5ADA3]">{field.label}</span>
                  <span className="text-sm text-[#1A1A1F] font-medium">{renderFieldValue(field, val)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  // 외부에서 ?product=xxx 로 들어오면 자동 선택 (catchtable 슬롯 페이지에서 점프 시).
  const initialProductId = searchParams.get("product");
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(initialProductId);
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [booked, setBooked] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [bookingNeedsContact, setBookingNeedsContact] = useState(false);
  const [showMessageBox, setShowMessageBox] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [messageSent, setMessageSent] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const messageDialogTitleId = useId();
  const messageInputId = useId();
  const { dialogRef: messageDialogRef } = useAccessibleDialog({
    isOpen: VENDOR_MESSAGES_ENABLED && showMessageBox,
    onClose: () => setShowMessageBox(false),
  });
  const [staffList, setStaffList] = useState<{ id: string; name: string; role: string | null; timeSlots: { day: number; hour: number; maxBookings: number; currentBookings: number }[] }[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [availabilitySlots, setAvailabilitySlots] = useState<Array<{ hour: number; remaining: number }>>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [availabilityReloadKey, setAvailabilityReloadKey] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [likedPhotos, setLikedPhotos] = useState<Set<string>>(new Set());
  const { trackEvent } = useEventTracker();

  // 체류시간 자동 추적
  useViewDuration(id);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/vendors/${id}`);
        if (res.ok) {
          const data = await res.json();
          setVendor(data.vendor);
          if (data.reviews) setReviews(data.reviews);
          if (data.isFavorite) setIsFavorite(true);
          // 업체 조회 이벤트 추적
          trackEvent("vendor_view", { vendorId: id, metadata: { source: "direct" } });
        }
        // 스태프 조회
        const staffRes = await fetch(`/api/vendors/${id}/staff`);
        if (staffRes.ok) {
          const staffData = await staffRes.json();
          setStaffList(staffData.staff ?? []);
        }
        // 사진 좋아요 조회
        const likesRes = await fetch(`/api/vendors/${id}/photos`);
        if (likesRes.ok) {
          const likesData = await likesRes.json();
          setLikedPhotos(new Set(likesData.likedPhotos ?? []));
        }
      } catch (err) {
        console.error("Fetch vendor error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, trackEvent]);

  useEffect(() => {
    const selectedDate = nextLocalDateForDatabaseWeekday(selectedDay);
    if (!selectedDate) return;

    const controller = new AbortController();
    const query = new URLSearchParams({ date: formatLocalDateOnly(selectedDate) });
    if (selectedProduct) query.set("productId", selectedProduct);
    if (selectedStaff) query.set("staffId", selectedStaff);

    setSelectedSlot(null);
    setAvailabilitySlots([]);
    setAvailabilityError(false);
    setAvailabilityLoading(true);

    void fetch(`/api/vendors/${encodeURIComponent(id)}/availability?${query.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          slots?: Array<{ hour?: unknown; remaining?: unknown }>;
        } | null;
        if (!response.ok) throw new Error("availability_failed");
        const slots = Array.isArray(payload?.slots)
          ? payload.slots.flatMap((slot) => (
              Number.isInteger(slot.hour) && Number.isInteger(slot.remaining)
                ? [{ hour: Number(slot.hour), remaining: Math.max(0, Number(slot.remaining)) }]
                : []
            ))
          : [];
        setAvailabilitySlots(slots);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAvailabilityError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setAvailabilityLoading(false);
      });

    return () => controller.abort();
  }, [availabilityReloadKey, id, selectedDay, selectedProduct, selectedStaff]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 text-[#B5ADA3] animate-spin" />
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="max-w-[800px] mx-auto text-center py-20">
        <p className="text-base text-[#B5ADA3]">업체를 찾을 수 없습니다</p>
        <Link href={weddingPath("/vendors")} className="text-base text-[#795252] mt-2 inline-block">
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

  const toggleFavorite = async () => {
    const was = isFavorite;
    setIsFavorite(!was);
    trackEvent(was ? "favorite_remove" : "favorite_add", { vendorId: id });
    try {
      await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId: id }),
      });
    } catch {
      setIsFavorite(was);
    }
  };

  const togglePhotoLike = async (photoUrl: string) => {
    const was = likedPhotos.has(photoUrl);
    setLikedPhotos((prev) => {
      const next = new Set(prev);
      if (was) next.delete(photoUrl);
      else next.add(photoUrl);
      return next;
    });
    try {
      await fetch(`/api/vendors/${id}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoUrl }),
      });
    } catch {
      // 실패 시 롤백
      setLikedPhotos((prev) => {
        const next = new Set(prev);
        if (was) next.add(photoUrl);
        else next.delete(photoUrl);
        return next;
      });
    }
  };

  const activeProducts = vendor.products.filter((p) => p.isActive);
  const config = CATEGORY_PRODUCT_FIELDS[vendor.category as keyof typeof CATEGORY_PRODUCT_FIELDS];
  const currentProduct = activeProducts.find((p) => p.id === selectedProduct);

  // 담당자 → 상품 → 업체 순으로 표시 가능한 요일을 안내한다. 실제 남은
  // 수량은 선택 날짜마다 aggregate API에서 다시 읽고, 생성 RPC가 최종 검증한다.
  const currentStaff = staffList.find((staff) => staff.id === selectedStaff);
  const currentSlots = currentStaff
    ? currentStaff.timeSlots.map((slot) => ({ ...slot, available: true }))
    : currentProduct
      ? currentProduct.timeSlots
      : vendor.timeSlots;
  const upcomingDates = DAYS.map((_, weekday) => nextLocalDateForDatabaseWeekday(weekday));
  const selectedBookingDate = upcomingDates[selectedDay];

  const handleSelectProduct = (productId: string) => {
    if (selectedProduct === productId) {
      setSelectedProduct(null);
    } else {
      setSelectedProduct(productId);
      setSelectedSlot(null);
      // 상품 조회 이벤트 추적
      trackEvent("product_view", { vendorId: id, productId });
    }
  };

  const handleBook = async () => {
    if (!VENDOR_MESSAGES_ENABLED) {
      setBookingError("업체 연결 준비 중입니다. 현재 상담 요청은 업체에 전송되지 않습니다.");
      return;
    }
    if (selectedSlot === null) return;
    setBooking(true);
    setBookingError("");
    setBookingNeedsContact(false);

    if (!selectedBookingDate) {
      setBookingError("선택한 날짜를 확인하지 못했습니다. 날짜를 다시 선택해주세요.");
      setBooking(false);
      return;
    }
    const dateStr = formatLocalDateOnly(selectedBookingDate);
    const timeStr = `${String(selectedSlot).padStart(2, "0")}:00`;

    try {
      // 예약 시작 이벤트
      trackEvent("booking_start", { vendorId: vendor.id, productId: selectedProduct || undefined });

      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: vendor.id,
          productId: selectedProduct || null,
          staffId: selectedStaff || null,
          date: dateStr,
          time: timeStr,
        }),
      });

      if (res.ok) {
        setBooked(true);
        // 예약 완료 이벤트
        trackEvent("booking_complete", {
          vendorId: vendor.id,
          productId: selectedProduct || undefined,
          metadata: { date: dateStr, time: timeStr },
        });
        setTimeout(() => setBooked(false), 3000);
      } else {
        const payload = await res.json().catch(() => ({} as { error?: string; code?: string }));
        setBookingNeedsContact(payload.code === "booking_contact_required");
        setBookingError(
          typeof payload.error === "string"
            ? payload.error
            : "상담 요청을 접수하지 못했습니다. 선택한 날짜와 시간을 확인한 뒤 다시 시도해주세요."
        );
      }
    } catch (err) {
      console.error("Booking error:", err);
      setBookingError("예약 요청 중 연결이 끊겼습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setBooking(false);
    }
  };

  const handleSendMessage = async () => {
    if (!BOOKING_REQUESTS_ENABLED) {
      setMessageError("업체 연결 준비 중입니다. 현재 문의는 업체에 전송되지 않습니다.");
      return;
    }
    if (!messageText.trim() || !vendor) return;
    setSendingMessage(true);
    setMessageError("");
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: vendor.id,
          content: messageText.trim(),
        }),
      });
      if (res.ok) {
        setMessageSent(true);
        setMessageText("");
        // 메시지 전송 이벤트 추적
        trackEvent("message_send", { vendorId: vendor.id });
        setTimeout(() => { setMessageSent(false); setShowMessageBox(false); }, 2000);
      } else {
        const payload = await res.json().catch(() => ({} as { error?: string }));
        setMessageError(payload.error || "문의를 보내지 못했습니다. 내용을 확인한 뒤 다시 시도해주세요.");
      }
    } catch (err) {
      console.error("Send message error:", err);
      setMessageError("연결이 끊겨 문의를 보내지 못했습니다. 입력 내용은 그대로 두었어요.");
    } finally {
      setSendingMessage(false);
    }
  };

  return (
    <div className="max-w-[900px] mx-auto bg-[#FAFAF8]">
      <Link href={weddingPath("/vendors")} className="inline-flex items-center gap-1.5 text-base text-[#B5ADA3] hover:text-[#795252] transition-colors mb-6">
        <ArrowLeft className="w-4 h-4" />
        업체 목록
      </Link>

      <div className="grid grid-cols-5 gap-6 max-lg:grid-cols-1">
        {/* 업체 정보 + 상품 */}
        <div className="col-span-3 space-y-6">
          <div className="animate-fade-in">
            <div className="h-[220px] bg-gradient-to-br from-[#F6F3F2] to-[#EDE7E5] rounded-xl flex items-center justify-center relative mb-5 overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <span className="text-base text-[#B5ADA3] font-light">{vendor.category} 대표 사진</span>
              <div className="absolute top-3 left-3 flex gap-2">
                {vendor.aiRecommend && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/95 text-[#36534E] text-sm font-medium shadow-sm ring-1 ring-[#d9e4dc]">
                    <Sparkles className="w-4 h-4" />등록 탐색 후보
                  </span>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
              <div className="flex items-center justify-between mb-2">
                <h1 className="font-serif-kr text-[26px] font-medium leading-tight text-[#071629] sm:text-[30px]">{vendor.name}</h1>
                <button
                  onClick={toggleFavorite}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-full transition-all ${
                    isFavorite
                      ? "bg-[#795252]/10 text-[#795252]"
                      : "bg-[#F6F3F2] text-[#B5ADA3] hover:text-[#795252] hover:bg-[#EDE7E5]"
                  }`}
                >
                  <Heart className={`w-4 h-4 ${isFavorite ? "fill-[#795252]" : ""}`} />
                  <span className="text-base font-medium">{isFavorite ? "찜" : "찜하기"}</span>
                </button>
              </div>
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center gap-1">
                  <Star className="w-5 h-5 text-[#C9A96E] fill-[#C9A96E]" />
                  <span className="text-base font-medium text-[#1A1A1F]">{vendor.rating}</span>
                  <span className="text-sm text-[#B5ADA3]">({vendor.reviewCount}개 리뷰)</span>
                </div>
                <span className="text-[#B5ADA3]">·</span>
                <span className="text-base text-[#795252] font-medium">{vendor.priceRange}</span>
              </div>
              <div className="flex items-center gap-4 mb-3 text-base text-[#504444]">
                <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-[#B5ADA3]" />{vendor.address}</span>
              </div>
              <div className="flex items-center gap-4 mb-5 text-base text-[#504444]">
                <span className="flex items-center gap-1.5"><Phone className="w-4 h-4 text-[#B5ADA3]" />{vendor.phone}</span>
              </div>
              <div className="flex gap-1.5 flex-wrap mb-5">
                {vendor.tags.map((tag) => (
                  <span key={tag} className="px-3 py-1.5 rounded-full bg-[#F6F3F2] text-sm text-[#504444] font-medium">{tag}</span>
                ))}
              </div>
              <p className="text-[14px] font-medium leading-[1.7] text-[#5d6879]">{vendor.description}</p>
              <p className="mt-4 rounded-lg bg-[#fffdf7] px-3 py-2 text-[12px] font-medium leading-[1.6] text-[#746c65]">
                평점·리뷰·가격은 등록된 참고 정보이며 출처와 최신성을 보증하지 않습니다. 품질, 실제 총액, 계약 조건과 가능 일정은 업체의 공식 연락처로 직접 확인해 주세요.
              </p>
            </div>
          </div>

          {/* 상품 리스트 */}
          {activeProducts.length > 0 && (
            <div className="animate-fade-in">
              <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
                <div className="flex items-center gap-2 mb-2">
                  <Package className="w-5 h-5 text-[#795252]" />
                  <h2 className="font-serif-kr text-[22px] font-medium leading-tight text-[#071629]">{config?.productLabel ?? "상품"}</h2>
                  <span className="text-sm text-[#B5ADA3] ml-1">{activeProducts.length}개</span>
                </div>
                <p className="text-sm text-[#B5ADA3] font-light mb-5">상품을 선택하면 업체가 공개한 운영시간이 참고용으로 표시됩니다</p>
                <div className="space-y-3">
                  {activeProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      category={vendor.category}
                      isSelected={selectedProduct === product.id}
                      onSelect={() => handleSelectProduct(product.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 포트폴리오 갤러리 */}
          {(() => {
            const allImages = activeProducts.flatMap((p) => p.images ?? []).filter(Boolean);
            if (allImages.length === 0) return null;
            return (
              <div className="animate-fade-in">
                <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <ImageIcon className="w-5 h-5 text-[#795252]" />
                    <h2 className="font-serif-kr text-[22px] font-medium leading-tight text-[#071629]">포트폴리오</h2>
                    <span className="text-sm text-[#B5ADA3] ml-1">{allImages.length}장</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {allImages.slice(0, 9).map((src, idx) => (
                      <div key={idx} className="relative aspect-square rounded-xl overflow-hidden bg-[#F6F3F2] group">
                        {/* eslint-disable-next-line @next/next/no-img-element -- Vendor portfolio URLs are user-managed remote assets. */}
                        <img src={src} alt={`포트폴리오 ${idx + 1}`} className="w-full h-full object-cover" />
                        <button
                          onClick={() => togglePhotoLike(src)}
                          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/50"
                        >
                          <Heart className={`w-3.5 h-3.5 ${likedPhotos.has(src) ? "text-[#946a6a] fill-[#946a6a]" : "text-white"}`} />
                        </button>
                        {likedPhotos.has(src) && (
                          <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center group-hover:opacity-0 transition-opacity">
                            <Heart className="w-3.5 h-3.5 text-[#946a6a] fill-[#946a6a]" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {allImages.length > 9 && (
                    <p className="text-center text-sm text-[#B5ADA3] mt-3">+{allImages.length - 9}장 더보기</p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* 고객 리뷰 */}
          {reviews.length > 0 && (
            <div className="animate-fade-in">
              <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
                <div className="flex items-center gap-2 mb-1">
                  <MessageCircle className="w-5 h-5 text-[#795252]" />
                  <h2 className="font-serif-kr text-[22px] font-medium leading-tight text-[#071629]">고객 리뷰</h2>
                  <span className="text-sm text-[#B5ADA3] ml-1">{reviews.length}개</span>
                </div>
                {/* 평균 별점 */}
                <div className="flex items-center gap-2 mb-5">
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        className={`w-4 h-4 ${
                          s <= Math.round(reviews.reduce((a, r) => a + r.rating, 0) / reviews.length)
                            ? "text-[#C9A96E] fill-[#C9A96E]"
                            : "text-[#B5ADA3]/30"
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-base font-medium text-[#1A1A1F]">
                    {(reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1)}
                  </span>
                </div>
                <div className="space-y-4">
                  {reviews.map((review, idx) => (
                    <div key={review.id} className={`pt-4 ${idx === 0 ? "" : "border-t border-black/[0.04]"} first:pt-0`}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star
                              key={s}
                              className={`w-4 h-4 ${s <= review.rating ? "text-[#C9A96E] fill-[#C9A96E]" : "text-[#B5ADA3]/30"}`}
                            />
                          ))}
                        </div>
                        <span className="text-sm text-[#B5ADA3]">
                          {new Date(review.created_at).toLocaleDateString("ko-KR")}
                        </span>
                      </div>
                      {review.content && (
                        <p className="mb-2 text-[13px] font-medium leading-[1.65] text-[#5d6879]">{review.content}</p>
                      )}
                      {/* 리뷰 이미지 */}
                      {review.images && review.images.length > 0 && (
                        <div className="flex gap-1.5 mb-2">
                          {review.images.slice(0, 4).map((img, idx) => (
                            <div key={idx} className="w-16 h-16 rounded-lg overflow-hidden bg-[#F6F3F2] flex-shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element -- Review images are user-managed remote assets. */}
                              <img src={img} alt={`리뷰 사진 ${idx + 1}`} className="w-full h-full object-cover" />
                            </div>
                          ))}
                        </div>
                      )}
                      {/* 업체 답변 */}
                      {review.reply && (
                        <div className="ml-4 mt-2 px-3 py-2.5 bg-[#F6F3F2] rounded-xl">
                          <p className="text-sm text-[#795252] font-medium mb-1">업체 답변</p>
                          <p className="text-[13px] font-medium leading-[1.65] text-[#5d6879]">{review.reply}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 예약 패널 */}
        <div className="col-span-2 animate-fade-in">
          <div className="sticky top-[88px] space-y-4">
            {/* 선택 상품 요약 */}
            {currentProduct && (
              <div className="bg-white rounded-xl shadow-[0_8px_30px_rgba(121,82,82,0.08)] ring-1 ring-[#795252]/10 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Tag className="w-4 h-4 text-[#795252]" />
                  <span className="text-sm text-[#795252] font-medium">선택한 상품</span>
                </div>
                <h4 className="text-base font-medium text-[#1A1A1F] mb-1">{currentProduct.name}</h4>
                <div className="flex items-center gap-3">
                  <p className="text-[17px] font-medium text-[#795252]">
                    {currentProduct.discountPrice ? formatPrice(currentProduct.discountPrice) : formatPrice(currentProduct.price)}
                  </p>
                  <span className="text-sm text-[#B5ADA3] flex items-center gap-1">
                    <Timer className="w-4 h-4" />{formatDuration(currentProduct.duration)}
                  </span>
                </div>
              </div>
            )}

            {/* 스태프 선택 */}
            {staffList.length > 0 && (
              <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-5 h-5 text-[#795252]" />
                  <h3 className="font-serif-kr text-[18px] font-medium leading-tight text-[#071629]">담당자 선택</h3>
                  <span className="text-sm text-[#B5ADA3]">(선택사항)</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedStaff(null)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      selectedStaff === null
                        ? "bg-[#795252] text-white"
                        : "bg-[#F6F3F2] text-[#504444] hover:bg-[#EDE7E5]"
                    }`}
                  >
                    아무나
                  </button>
                  {staffList.map((staff) => (
                    <button
                      key={staff.id}
                      onClick={() => setSelectedStaff(staff.id)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        selectedStaff === staff.id
                          ? "bg-[#795252] text-white"
                          : "bg-[#F6F3F2] text-[#504444] hover:bg-[#EDE7E5] hover:text-[#795252]"
                      }`}
                    >
                      {staff.name}
                      {staff.role && <span className="text-sm opacity-70 ml-1">({staff.role})</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 예약 시간 선택 */}
            <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-5">
              <div className="flex items-center gap-2 mb-4">
                <CalendarCheck className="w-5 h-5 text-[#795252]" />
                <h3 className="font-serif-kr text-[18px] font-medium leading-tight text-[#071629]">
                  {currentProduct ? `${currentProduct.name} 공개 운영시간` : "공개 운영시간(참고)"}
                </h3>
              </div>

              {/* 상품 미선택 안내 */}
              {activeProducts.length > 0 && !currentProduct && (
                <div className="py-6 text-center">
                  <Package className="w-8 h-8 text-[#B5ADA3]/30 mx-auto mb-2" />
                  <p className="text-base text-[#B5ADA3] mb-1">상품을 먼저 선택해주세요</p>
                  <p className="text-sm text-[#B5ADA3]/70 font-light">상품마다 공개된 운영시간이 다를 수 있습니다</p>
                </div>
              )}

              {/* 상품이 선택되었거나 상품이 없는 업체 */}
              {(currentProduct || activeProducts.length === 0) && (
                <>
                  {/* 요일 선택 */}
                  <div className="flex gap-1.5 mb-4">
                    {DAYS.map((day, di) => {
                      const hasSlots = currentSlots.some((s) => s.day === di && s.available);
                      const date = upcomingDates[di];
                      return (
                        <button
                          key={day}
                          onClick={() => { setSelectedDay(di); setSelectedSlot(null); }}
                          className={`flex-1 min-h-12 py-2 rounded-lg text-sm font-medium transition-colors ${
                            selectedDay === di
                              ? "bg-[#795252] text-white"
                              : hasSlots
                              ? "bg-[#F6F3F2] text-[#504444] hover:bg-[#EDE7E5]"
                              : "bg-[#F6F3F2]/50 text-[#B5ADA3]/50"
                          }`}
                        >
                          <span className="block">{day}</span>
                          <span className={`block text-[10px] ${selectedDay === di ? "text-white/75" : "opacity-70"}`}>
                            {date ? `${date.getMonth() + 1}/${date.getDate()}` : "-"}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* 시간 슬롯 */}
                  {availabilityLoading ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-sm text-[#B5ADA3]" role="status">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      공개된 운영시간을 확인하고 있어요
                    </div>
                  ) : availabilityError ? (
                    <div className="py-5 text-center" role="alert">
                      <p className="mb-2 text-sm text-red-700">공개된 운영시간을 확인하지 못했어요.</p>
                      <button
                        type="button"
                        onClick={() => setAvailabilityReloadKey((key) => key + 1)}
                        className="rounded-lg border border-[#795252]/25 px-3 py-2 text-sm font-medium text-[#795252]"
                      >
                        다시 확인하기
                      </button>
                    </div>
                  ) : availabilitySlots.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {availabilitySlots.map((slot) => {
                        const isRecordedFull = slot.remaining <= 0;
                        return (
                          <button
                            key={`${selectedDay}-${slot.hour}`}
                            disabled
                            className="relative cursor-not-allowed rounded-lg bg-white py-2.5 text-base font-medium text-[#795252] ring-1 ring-[#795252]/15"
                          >
                            <Clock className="w-4 h-4 inline mr-1" />
                            {String(slot.hour).padStart(2, "0")}:00
                            <span className="mt-0.5 block text-sm opacity-70">
                              {isRecordedFull ? "내부 기록상 마감" : "참고용"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-6 text-center">
                      <p className="text-base text-[#B5ADA3]">이 요일에는 공개된 운영시간이 없습니다</p>
                    </div>
                  )}

                  {/* 예약 버튼 */}
                  <button
                    onClick={handleBook}
                    disabled={!BOOKING_REQUESTS_ENABLED || selectedSlot === null || booked || booking}
                    className={`w-full py-3.5 rounded-xl text-base font-medium transition-all flex items-center justify-center gap-2 ${
                      !BOOKING_REQUESTS_ENABLED
                        ? "bg-[#E8E1DF] text-[#756D6B] cursor-not-allowed"
                        : booked
                        ? "bg-[#2E7D5A] text-white"
                        : selectedSlot !== null
                        ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white shadow-[0_8px_24px_rgba(121,82,82,0.25)] hover:shadow-[0_12px_32px_rgba(121,82,82,0.3)]"
                        : "bg-[#B5ADA3]/20 text-[#B5ADA3] cursor-not-allowed"
                    }`}
                  >
                    {!BOOKING_REQUESTS_ENABLED ? (
                      "업체 연결 준비 중"
                    ) : booking ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />요청 보내는 중...</>
                    ) : booked ? (
                      <><Check className="w-4 h-4" />상담 요청 접수 완료</>
                    ) : selectedSlot !== null && selectedBookingDate ? (
                      `${selectedBookingDate.getMonth() + 1}월 ${selectedBookingDate.getDate()}일 (${DAYS[selectedDay]}) ${String(selectedSlot).padStart(2, "0")}:00 요청 보내기`
                    ) : (
                      "시간을 선택해주세요"
                    )}
                  </button>

                  {bookingError && (
                    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-700" role="alert">
                      <p>{bookingError}</p>
                      {bookingNeedsContact && (
                        <Link href={weddingPath("/settings")} className="mt-2 inline-flex rounded-lg bg-red-700 px-3 py-1.5 font-medium text-white hover:bg-red-800">
                          연락처 등록하기
                        </Link>
                      )}
                    </div>
                  )}

                  {booked && (
                    <div className="mt-2 text-center text-sm text-[#2E7D5A]">
                      <p>상담 요청을 접수했습니다. 업체에서 확인 후 내 프로필 연락처로 안내드릴 예정입니다.</p>
                      <Link href={weddingPath("/bookings")} className="mt-1 inline-flex font-medium underline underline-offset-2">
                        상담 요청 내역 보기
                      </Link>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="bg-[#F6F3F2] rounded-xl p-4" role="status">
              <p className="text-sm text-[#504444] font-light leading-relaxed">
                업체 연결 준비 중입니다. 현재 상담 요청과 문의는 업체에 전송되지 않습니다.
                이름·휴대폰 번호·희망 일시·메모도 새로 저장하거나 업체에 제공하지 않습니다.
                공개된 운영시간은 참고 정보이며, 최신 가능 여부와 계약 조건은 업체의 공식 연락처로 직접 확인해 주세요.
              </p>
              <Link href={weddingPath("/bookings")} className="mt-2 inline-flex text-sm font-medium text-[#795252] underline underline-offset-2">
                과거 상담 요청 내역 보기
              </Link>
            </div>

            {/* 문의하기 */}
            {VENDOR_MESSAGES_ENABLED ? (
              <button
                type="button"
                onClick={() => setShowMessageBox(true)}
                aria-haspopup="dialog"
                aria-expanded={showMessageBox}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-white text-base text-[#795252] font-medium shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_40px_rgb(0,0,0,0.08)] transition-shadow"
              >
                <MessageSquare className="w-5 h-5" />
                업체에 문의하기
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* 문의 다이얼로그 */}
      {VENDOR_MESSAGES_ENABLED && showMessageBox && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-5" onClick={() => setShowMessageBox(false)}>
          <div
            ref={messageDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={messageDialogTitleId}
            tabIndex={-1}
            className="bg-white rounded-xl w-full max-w-md p-6 shadow-[0_20px_60px_rgba(0,0,0,0.15)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-[#795252]" />
                <h3 id={messageDialogTitleId} className="font-serif-kr text-[22px] font-medium leading-tight text-[#071629]">{vendor.name}에 문의</h3>
              </div>
              <button type="button" onClick={() => setShowMessageBox(false)} aria-label="업체 문의 창 닫기" className="p-1 rounded-lg hover:bg-[#F6F3F2] transition-colors">
                <X className="w-5 h-5 text-[#B5ADA3]" />
              </button>
            </div>
            <label htmlFor={messageInputId} className="sr-only">업체에 보낼 문의 내용</label>
            <textarea
              id={messageInputId}
              data-dialog-initial-focus
              value={messageText}
              onChange={(e) => { setMessageText(e.target.value); setMessageError(""); }}
              placeholder="궁금한 점을 자유롭게 작성해주세요..."
              rows={4}
              className="w-full px-4 py-3 bg-[#F6F3F2] rounded-xl text-base outline-none focus:ring-2 focus:ring-[#795252]/30 transition-all resize-none mb-4"
            />
            <button
              type="button"
              onClick={handleSendMessage}
              disabled={!messageText.trim() || sendingMessage || messageSent}
              className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-base font-medium transition-all ${
                messageSent
                  ? "bg-[#2E7D5A] text-white"
                  : "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white shadow-[0_8px_24px_rgba(121,82,82,0.2)] hover:shadow-[0_12px_32px_rgba(121,82,82,0.25)] disabled:opacity-50"
              }`}
            >
              {sendingMessage ? (
                <><Loader2 className="w-4 h-4 animate-spin" />전송 중...</>
              ) : messageSent ? (
                <><Check className="w-4 h-4" />전송 완료!</>
              ) : (
                <><Send className="w-4 h-4" />문의 보내기</>
              )}
            </button>
            {messageError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {messageError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
