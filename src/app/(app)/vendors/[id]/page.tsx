"use client";

import { useState, use } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Star, MapPin, Phone, Clock, Sparkles, CalendarCheck, Check } from "lucide-react";
import Link from "next/link";
import { mockVendors, DAYS, HOURS } from "@/data/mockVendors";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

export default function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const vendor = mockVendors.find((v) => v.id === id);
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [booked, setBooked] = useState(false);

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

  const daySlots = vendor.timeSlots.filter((s) => s.day === selectedDay && s.available);

  const handleBook = () => {
    setBooked(true);
    setTimeout(() => setBooked(false), 3000);
  };

  return (
    <div className="max-w-[900px] mx-auto">
      {/* 뒤로가기 */}
      <Link href="/vendors" className="inline-flex items-center gap-1.5 text-[13px] text-taupe-400 hover:text-rose-500 transition-colors mb-6">
        <ArrowLeft className="w-4 h-4" />
        업체 목록
      </Link>

      <div className="grid grid-cols-5 gap-6 max-lg:grid-cols-1">
        {/* 업체 정보 */}
        <div className="col-span-3 space-y-6">
          <motion.div {...fadeIn} transition={{ duration: 0.5 }}>
            {/* 이미지 */}
            <div className="h-[220px] bg-gradient-to-br from-ivory-deep to-ivory-warm rounded-2xl flex items-center justify-center relative mb-5">
              <span className="text-[14px] text-taupe-400 font-light">{vendor.category} 대표 사진</span>
              <div className="absolute top-3 left-3 flex gap-2">
                {vendor.aiRecommend && (
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500 text-white text-[11px] font-medium">
                    <Sparkles className="w-3 h-3" />
                    AI 추천
                  </span>
                )}
              </div>
            </div>

            {/* 기본 정보 */}
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

              <div className="flex items-center gap-4 mb-5 text-[13px] text-taupe-500">
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-taupe-400" />
                  {vendor.address}
                </span>
              </div>
              <div className="flex items-center gap-4 mb-5 text-[13px] text-taupe-500">
                <span className="flex items-center gap-1.5">
                  <Phone className="w-4 h-4 text-taupe-400" />
                  {vendor.phone}
                </span>
              </div>

              <div className="flex gap-1.5 flex-wrap mb-5">
                {vendor.tags.map((tag) => (
                  <span key={tag} className="px-3 py-1 rounded-full bg-ivory-warm text-[12px] text-charcoal font-medium">
                    {tag}
                  </span>
                ))}
              </div>

              <p className="text-[14px] text-charcoal font-light leading-[1.8]">{vendor.description}</p>
            </div>
          </motion.div>
        </div>

        {/* 예약 패널 */}
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="col-span-2"
        >
          <div className="sticky top-[88px] space-y-4">
            <div className="bg-white rounded-2xl border border-black/[0.04] p-5">
              <div className="flex items-center gap-2 mb-4">
                <CalendarCheck className="w-5 h-5 text-rose-500" />
                <h3 className="text-[15px] font-medium text-noir-800">예약 가능 시간</h3>
              </div>

              {/* 요일 선택 */}
              <div className="flex gap-1.5 mb-4">
                {DAYS.map((day, di) => {
                  const hasSlots = vendor.timeSlots.some((s) => s.day === di && s.available);
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
                  {daySlots.map((slot) => (
                    <button
                      key={`${slot.day}-${slot.hour}`}
                      onClick={() => setSelectedSlot(slot.hour)}
                      className={`py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
                        selectedSlot === slot.hour
                          ? "bg-rose-500 text-white"
                          : "bg-ivory-warm text-charcoal hover:bg-rose-500/10 hover:text-rose-500"
                      }`}
                    >
                      <Clock className="w-3 h-3 inline mr-1" />
                      {String(slot.hour).padStart(2, "0")}:00
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center">
                  <p className="text-[13px] text-taupe-400">이 요일에는 예약 가능 시간이 없습니다</p>
                </div>
              )}

              {/* 예약 버튼 */}
              <button
                onClick={handleBook}
                disabled={selectedSlot === null || booked}
                className={`w-full py-3.5 rounded-xl text-[14px] font-medium transition-all flex items-center justify-center gap-2 ${
                  booked
                    ? "bg-[#2E7D5A] text-white"
                    : selectedSlot !== null
                    ? "bg-gradient-to-r from-rose-500 to-gold text-white hover:shadow-[0_8px_32px_rgba(196,150,126,0.3)]"
                    : "bg-taupe-400/20 text-taupe-400 cursor-not-allowed"
                }`}
              >
                {booked ? (
                  <>
                    <Check className="w-4 h-4" />
                    예약 신청 완료!
                  </>
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
            </div>

            {/* 업체 운영 요약 */}
            <div className="bg-ivory-warm rounded-xl p-4">
              <p className="text-[12px] text-taupe-500 font-light leading-relaxed">
                예약은 업체 확인 후 확정됩니다. 확정 시 등록하신 연락처로 안내해드립니다. 예약 변경/취소는 방문일 1일 전까지 가능합니다.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
