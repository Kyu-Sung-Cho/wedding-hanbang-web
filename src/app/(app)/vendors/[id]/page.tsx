"use client";

import { useState, useEffect, use } from "react";
import { ArrowLeft, Star, MapPin, Phone, Clock, Sparkles, CalendarCheck, Check, Package, Tag, ChevronDown, ChevronUp, Timer, Loader2, MessageSquare, Send, X, Users } from "lucide-react";
import Link from "next/link";
import { CATEGORY_PRODUCT_FIELDS, formatDuration, type ProductFieldDef } from "@/data/mockVendors";
import type { Vendor, VendorProduct } from "@/types/vendor.types";
import { useEventTracker, useViewDuration } from "@/hooks/useEventTracker";

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];

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
    <div className={`rounded-xl border transition-all ${isSelected ? "border-rose-500 bg-rose-500/[0.03] shadow-sm" : "border-black/[0.04] bg-white hover:border-rose-500/30"}`}>
      <div className="p-4 cursor-pointer" onClick={onSelect}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-[14px] font-medium text-noir-800">{product.name}</h4>
              {product.isPopular && (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-gold/10 text-[10px] text-gold font-medium">
                  <Star className="w-2.5 h-2.5 fill-gold" />인기
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {product.discountPrice ? (
                <>
                  <span className="text-[15px] font-medium text-rose-500">{formatPrice(product.discountPrice)}</span>
                  <span className="text-[12px] text-taupe-400 line-through">{formatPrice(product.price)}</span>
                </>
              ) : (
                <span className="text-[15px] font-medium text-noir-800">{formatPrice(product.price)}</span>
              )}
              <span className="text-[11px] text-taupe-400 flex items-center gap-0.5">
                <Timer className="w-3 h-3" />{formatDuration(product.duration)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {hasSlots && <span className="px-1.5 py-0.5 rounded-full bg-[#2E7D5A]/10 text-[10px] text-[#2E7D5A] font-medium">예약가능</span>}
            {isSelected && (
              <div className="w-6 h-6 rounded-full bg-rose-500 flex items-center justify-center">
                <Check className="w-3.5 h-3.5 text-white" />
              </div>
            )}
          </div>
        </div>

        {product.includes.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {product.includes.slice(0, 4).map((item, idx) => (
              <span key={idx} className="px-2 py-0.5 rounded-full bg-ivory-warm text-[10px] text-charcoal font-medium">{item}</span>
            ))}
            {product.includes.length > 4 && (
              <span className="px-2 py-0.5 rounded-full bg-ivory-warm text-[10px] text-taupe-400">+{product.includes.length - 4}</span>
            )}
          </div>
        )}
      </div>

      <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} className="w-full flex items-center justify-center gap-1 py-2 border-t border-black/[0.03] text-[11px] text-taupe-400 hover:text-rose-500 transition-colors">
        {expanded ? "접기" : "상세 보기"}
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-black/[0.03]">
          {product.description && (
            <p className="text-[12px] text-taupe-500 font-light mt-3 mb-3">{product.description}</p>
          )}
          <div className="space-y-1.5">
            {config?.fields.map((field) => {
              const val = product.categoryFields[field.key];
              if (val === undefined || val === null || val === "" || val === false) return null;
              return (
                <div key={field.key} className="flex items-center justify-between">
                  <span className="text-[11px] text-taupe-400">{field.label}</span>
                  <span className="text-[11px] text-noir-800 font-medium">{renderFieldValue(field, val)}</span>
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
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [booked, setBooked] = useState(false);
  const [booking, setBooking] = useState(false);
  const [showMessageBox, setShowMessageBox] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [messageSent, setMessageSent] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [staffList, setStaffList] = useState<{ id: string; name: string; role: string | null; timeSlots: { day: number; hour: number; maxBookings: number; currentBookings: number }[] }[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
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
          // 업체 조회 이벤트 추적
          trackEvent("vendor_view", { vendorId: id, metadata: { source: "direct" } });
        }
        // 스태프 조회
        const staffRes = await fetch(`/api/vendors/${id}/staff`);
        if (staffRes.ok) {
          const staffData = await staffRes.json();
          setStaffList(staffData.staff ?? []);
        }
      } catch (err) {
        console.error("Fetch vendor error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, trackEvent]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 text-taupe-400 animate-spin" />
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="max-w-[800px] mx-auto text-center py-20">
        <p className="text-[14px] text-taupe-400">업체를 찾을 수 없습니다</p>
        <Link href="/vendors" className="text-[14px] text-rose-500 mt-2 inline-block">
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

  const activeProducts = vendor.products.filter((p) => p.isActive);
  const config = CATEGORY_PRODUCT_FIELDS[vendor.category as keyof typeof CATEGORY_PRODUCT_FIELDS];
  const currentProduct = activeProducts.find((p) => p.id === selectedProduct);

  // 상품이 선택되면 해당 상품의 타임슬롯, 아니면 업체 글로벌 타임슬롯
  const currentSlots = currentProduct ? currentProduct.timeSlots : vendor.timeSlots;
  const daySlots = currentSlots.filter((s) => s.day === selectedDay && s.available);

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
    if (selectedSlot === null) return;
    setBooking(true);

    // 오늘 기준으로 가장 가까운 선택 요일 날짜 계산
    const today = new Date();
    const todayDay = (today.getDay() + 6) % 7; // 0=월 ~ 6=일
    let diff = selectedDay - todayDay;
    if (diff <= 0) diff += 7;
    const bookingDate = new Date(today);
    bookingDate.setDate(today.getDate() + diff);
    const dateStr = bookingDate.toISOString().split("T")[0];
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
      }
    } catch (err) {
      console.error("Booking error:", err);
    } finally {
      setBooking(false);
    }
  };

  const handleSendMessage = async () => {
    if (!messageText.trim() || !vendor) return;
    setSendingMessage(true);
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
      }
    } catch (err) {
      console.error("Send message error:", err);
    } finally {
      setSendingMessage(false);
    }
  };

  return (
    <div className="max-w-[900px] mx-auto">
      <Link href="/vendors" className="inline-flex items-center gap-1.5 text-[13px] text-taupe-400 hover:text-rose-500 transition-colors mb-6">
        <ArrowLeft className="w-4 h-4" />
        업체 목록
      </Link>

      <div className="grid grid-cols-5 gap-6 max-lg:grid-cols-1">
        {/* 업체 정보 + 상품 */}
        <div className="col-span-3 space-y-6">
          <div className="animate-fade-in">
            <div className="h-[220px] bg-gradient-to-br from-ivory-deep to-ivory-warm rounded-2xl flex items-center justify-center relative mb-5">
              <span className="text-[14px] text-taupe-400 font-light">{vendor.category} 대표 사진</span>
              <div className="absolute top-3 left-3 flex gap-2">
                {vendor.aiRecommend && (
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500 text-white text-[11px] font-medium">
                    <Sparkles className="w-3 h-3" />AI 추천
                  </span>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-black/[0.04] p-6">
              <h1 className="font-serif-kr text-[24px] font-normal text-noir-800 mb-2">{vendor.name}</h1>
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-gold fill-gold" />
                  <span className="text-[14px] font-medium text-noir-800">{vendor.rating}</span>
                  <span className="text-[12px] text-taupe-400">({vendor.reviewCount}개 리뷰)</span>
                </div>
                <span className="text-taupe-400">·</span>
                <span className="text-[13px] text-rose-500 font-medium">{vendor.priceRange}</span>
              </div>
              <div className="flex items-center gap-4 mb-3 text-[13px] text-taupe-500">
                <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-taupe-400" />{vendor.address}</span>
              </div>
              <div className="flex items-center gap-4 mb-5 text-[13px] text-taupe-500">
                <span className="flex items-center gap-1.5"><Phone className="w-4 h-4 text-taupe-400" />{vendor.phone}</span>
              </div>
              <div className="flex gap-1.5 flex-wrap mb-5">
                {vendor.tags.map((tag) => (
                  <span key={tag} className="px-3 py-1 rounded-full bg-ivory-warm text-[12px] text-charcoal font-medium">{tag}</span>
                ))}
              </div>
              <p className="text-[14px] text-charcoal font-light leading-[1.8]">{vendor.description}</p>
            </div>
          </div>

          {/* 상품 리스트 */}
          {activeProducts.length > 0 && (
            <div className="animate-fade-in">
              <div className="bg-white rounded-2xl border border-black/[0.04] p-6">
                <div className="flex items-center gap-2 mb-2">
                  <Package className="w-5 h-5 text-rose-500" />
                  <h2 className="text-[17px] font-medium text-noir-800">{config?.productLabel ?? "상품"}</h2>
                  <span className="text-[12px] text-taupe-400 ml-1">{activeProducts.length}개</span>
                </div>
                <p className="text-[12px] text-taupe-400 font-light mb-5">상품을 선택하면 해당 상품의 예약 가능 시간이 표시됩니다</p>
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
        </div>

        {/* 예약 패널 */}
        <div className="col-span-2 animate-fade-in">
          <div className="sticky top-[88px] space-y-4">
            {/* 선택 상품 요약 */}
            {currentProduct && (
              <div className="bg-white rounded-2xl border border-rose-500/20 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Tag className="w-4 h-4 text-rose-500" />
                  <span className="text-[12px] text-rose-500 font-medium">선택한 상품</span>
                </div>
                <h4 className="text-[14px] font-medium text-noir-800 mb-1">{currentProduct.name}</h4>
                <div className="flex items-center gap-3">
                  <p className="text-[15px] font-medium text-rose-500">
                    {currentProduct.discountPrice ? formatPrice(currentProduct.discountPrice) : formatPrice(currentProduct.price)}
                  </p>
                  <span className="text-[11px] text-taupe-400 flex items-center gap-0.5">
                    <Timer className="w-3 h-3" />{formatDuration(currentProduct.duration)}
                  </span>
                </div>
              </div>
            )}

            {/* 스태프 선택 */}
            {staffList.length > 0 && (
              <div className="bg-white rounded-2xl border border-black/[0.04] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-5 h-5 text-rose-500" />
                  <h3 className="text-[15px] font-medium text-noir-800">담당자 선택</h3>
                  <span className="text-[11px] text-taupe-400">(선택사항)</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedStaff(null)}
                    className={`px-3 py-2 rounded-lg text-[12px] font-medium transition-colors ${
                      selectedStaff === null
                        ? "bg-noir-800 text-white"
                        : "bg-ivory-warm text-charcoal hover:bg-ivory-deep"
                    }`}
                  >
                    아무나
                  </button>
                  {staffList.map((staff) => (
                    <button
                      key={staff.id}
                      onClick={() => setSelectedStaff(staff.id)}
                      className={`px-3 py-2 rounded-lg text-[12px] font-medium transition-colors ${
                        selectedStaff === staff.id
                          ? "bg-rose-500 text-white"
                          : "bg-ivory-warm text-charcoal hover:bg-rose-500/10 hover:text-rose-500"
                      }`}
                    >
                      {staff.name}
                      {staff.role && <span className="text-[10px] opacity-70 ml-1">({staff.role})</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 예약 시간 선택 */}
            <div className="bg-white rounded-2xl border border-black/[0.04] p-5">
              <div className="flex items-center gap-2 mb-4">
                <CalendarCheck className="w-5 h-5 text-rose-500" />
                <h3 className="text-[15px] font-medium text-noir-800">
                  {currentProduct ? `${currentProduct.name} 예약` : "예약 가능 시간"}
                </h3>
              </div>

              {/* 상품 미선택 안내 */}
              {activeProducts.length > 0 && !currentProduct && (
                <div className="py-6 text-center">
                  <Package className="w-8 h-8 text-taupe-400/30 mx-auto mb-2" />
                  <p className="text-[13px] text-taupe-400 mb-1">상품을 먼저 선택해주세요</p>
                  <p className="text-[11px] text-taupe-400/70 font-light">상품마다 예약 가능 시간이 다릅니다</p>
                </div>
              )}

              {/* 상품이 선택되었거나 상품이 없는 업체 */}
              {(currentProduct || activeProducts.length === 0) && (
                <>
                  {/* 요일 선택 */}
                  <div className="flex gap-1.5 mb-4">
                    {DAYS.map((day, di) => {
                      const hasSlots = currentSlots.some((s) => s.day === di && s.available);
                      return (
                        <button
                          key={day}
                          onClick={() => { setSelectedDay(di); setSelectedSlot(null); }}
                          className={`flex-1 py-2 rounded-lg text-[12px] font-medium transition-colors ${
                            selectedDay === di
                              ? "bg-noir-800 text-white"
                              : hasSlots
                              ? "bg-ivory-warm text-charcoal hover:bg-ivory-deep"
                              : "bg-ivory-warm/50 text-taupe-400/50"
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>

                  {/* 시간 슬롯 */}
                  {daySlots.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {daySlots.map((slot) => {
                        const remaining = slot.maxBookings - slot.currentBookings;
                        const isFull = remaining <= 0;
                        return (
                          <button
                            key={`${slot.day}-${slot.hour}`}
                            onClick={() => !isFull && setSelectedSlot(slot.hour)}
                            disabled={isFull}
                            className={`py-2.5 rounded-lg text-[13px] font-medium transition-colors relative ${
                              isFull
                                ? "bg-taupe-400/10 text-taupe-400/50 cursor-not-allowed"
                                : selectedSlot === slot.hour
                                ? "bg-rose-500 text-white"
                                : "bg-ivory-warm text-charcoal hover:bg-rose-500/10 hover:text-rose-500"
                            }`}
                          >
                            <Clock className="w-3 h-3 inline mr-1" />
                            {String(slot.hour).padStart(2, "0")}:00
                            {isFull ? (
                              <span className="block text-[10px] mt-0.5 opacity-70">마감</span>
                            ) : remaining <= 2 && slot.maxBookings > 1 ? (
                              <span className={`block text-[10px] mt-0.5 ${
                                selectedSlot === slot.hour ? "text-white/80" : "text-rose-500"
                              }`}>
                                잔여 {remaining}석
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-6 text-center">
                      <p className="text-[13px] text-taupe-400">이 요일에는 예약 가능 시간이 없습니다</p>
                    </div>
                  )}

                  {/* 예약 버튼 */}
                  <button
                    onClick={handleBook}
                    disabled={selectedSlot === null || booked || booking}
                    className={`w-full py-3.5 rounded-xl text-[14px] font-medium transition-all flex items-center justify-center gap-2 ${
                      booked
                        ? "bg-[#2E7D5A] text-white"
                        : selectedSlot !== null
                        ? "bg-gradient-to-r from-rose-500 to-gold text-white hover:shadow-[0_8px_32px_rgba(196,150,126,0.3)]"
                        : "bg-taupe-400/20 text-taupe-400 cursor-not-allowed"
                    }`}
                  >
                    {booking ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />예약 중...</>
                    ) : booked ? (
                      <><Check className="w-4 h-4" />예약 신청 완료!</>
                    ) : selectedSlot !== null ? (
                      `${DAYS[selectedDay]} ${String(selectedSlot).padStart(2, "0")}:00 예약 신청`
                    ) : (
                      "시간을 선택해주세요"
                    )}
                  </button>

                  {booked && (
                    <p className="text-[12px] text-[#2E7D5A] text-center mt-2">
                      업체에서 확인 후 연락드릴 예정입니다
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="bg-ivory-warm rounded-xl p-4">
              <p className="text-[12px] text-taupe-500 font-light leading-relaxed">
                예약은 업체 확인 후 확정됩니다. 확정 시 등록하신 연락처로 안내해드립니다. 예약 변경/취소는 방문일 1일 전까지 가능합니다.
              </p>
            </div>

            {/* 문의하기 */}
            <button
              onClick={() => setShowMessageBox(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-rose-500/30 text-[13px] text-rose-500 font-medium hover:bg-rose-500/5 transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              업체에 문의하기
            </button>
          </div>
        </div>
      </div>

      {/* 문의 다이얼로그 */}
      {showMessageBox && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-5" onClick={() => setShowMessageBox(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-rose-500" />
                <h3 className="text-[16px] font-medium text-noir-800">{vendor.name}에 문의</h3>
              </div>
              <button onClick={() => setShowMessageBox(false)} className="p-1 rounded-lg hover:bg-ivory-warm transition-colors">
                <X className="w-5 h-5 text-taupe-400" />
              </button>
            </div>
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="궁금한 점을 자유롭게 작성해주세요..."
              rows={4}
              className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors resize-none mb-4"
            />
            <button
              onClick={handleSendMessage}
              disabled={!messageText.trim() || sendingMessage || messageSent}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-medium transition-all ${
                messageSent
                  ? "bg-[#2E7D5A] text-white"
                  : "bg-noir-800 text-white hover:bg-noir-soft disabled:opacity-50"
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
          </div>
        </div>
      )}
    </div>
  );
}
