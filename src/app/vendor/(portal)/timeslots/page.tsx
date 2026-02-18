"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Save, RotateCcw, Calendar, Clock, Info } from "lucide-react";
import WeeklyTimeGrid from "@/components/vendor/WeeklyTimeGrid";
import { mockVendors, HOURS, DAYS } from "@/data/mockVendors";
import type { TimeSlot } from "@/data/mockVendors";

const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

export default function TimeSlotsPage() {
  const vendor = mockVendors[0];
  const [slots, setSlots] = useState<TimeSlot[]>(vendor.timeSlots);
  const [saved, setSaved] = useState(false);
  const [maxPerSlot, setMaxPerSlot] = useState(1);

  const availableCount = slots.filter((s) => s.available).length;
  const totalSlots = HOURS.length * DAYS.length;

  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };
  const handleReset = () => { setSlots(vendor.timeSlots); };
  const handleAllOn = () => { setSlots(slots.map((s) => ({ ...s, available: true }))); };
  const handleAllOff = () => { setSlots(slots.map((s) => ({ ...s, available: false }))); };

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="grid grid-cols-3 gap-4 mb-6 max-md:grid-cols-1">
        <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="bg-white rounded-2xl p-5 border border-black/[0.04]">
          <div className="flex items-center gap-2 mb-2"><Calendar className="w-4 h-4 text-rose-500" /><p className="text-[12px] text-taupe-500">예약 가능 슬롯</p></div>
          <p className="font-display text-[28px] font-light text-noir-800">{availableCount}<span className="text-[14px] text-taupe-400">/{totalSlots}</span></p>
        </motion.div>
        <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.05 }} className="bg-white rounded-2xl p-5 border border-black/[0.04]">
          <div className="flex items-center gap-2 mb-2"><Clock className="w-4 h-4 text-gold" /><p className="text-[12px] text-taupe-500">주당 운영 시간</p></div>
          <p className="font-display text-[28px] font-light text-noir-800">{availableCount}<span className="text-[14px] text-taupe-400">시간</span></p>
        </motion.div>
        <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.1 }} className="bg-white rounded-2xl p-5 border border-black/[0.04]">
          <div className="flex items-center gap-2 mb-2"><Info className="w-4 h-4 text-[#2E7D5A]" /><p className="text-[12px] text-taupe-500">슬롯당 최대 예약</p></div>
          <div className="flex items-center gap-3">
            <p className="font-display text-[28px] font-light text-noir-800">{maxPerSlot}<span className="text-[14px] text-taupe-400">건</span></p>
            <div className="flex items-center gap-1">
              <button onClick={() => setMaxPerSlot(Math.max(1, maxPerSlot - 1))} className="w-7 h-7 rounded-lg border border-platinum text-[14px] text-charcoal hover:border-rose-500 transition-colors">-</button>
              <button onClick={() => setMaxPerSlot(maxPerSlot + 1)} className="w-7 h-7 rounded-lg border border-platinum text-[14px] text-charcoal hover:border-rose-500 transition-colors">+</button>
            </div>
          </div>
        </motion.div>
      </div>

      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.15 }} className="bg-white rounded-2xl border border-black/[0.04] p-6">
        <div className="flex items-center justify-between mb-5 max-md:flex-col max-md:gap-3">
          <h3 className="font-serif-kr text-[17px] font-normal text-noir-800">기본 주간 스케줄</h3>
          <div className="flex items-center gap-2">
            <button onClick={handleAllOn} className="px-3 py-1.5 rounded-lg text-[12px] text-charcoal border border-platinum hover:border-rose-500 hover:text-rose-500 transition-colors">전체 열기</button>
            <button onClick={handleAllOff} className="px-3 py-1.5 rounded-lg text-[12px] text-charcoal border border-platinum hover:border-rose-500 hover:text-rose-500 transition-colors">전체 닫기</button>
            <button onClick={handleReset} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] text-taupe-400 border border-platinum hover:border-taupe-400 transition-colors"><RotateCcw className="w-3 h-3" />초기화</button>
          </div>
        </div>
        <WeeklyTimeGrid slots={slots} onChange={setSlots} />
        <div className="mt-5 bg-ivory-warm rounded-xl p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-taupe-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] text-noir-800 font-medium mb-1">특정 날짜 휴무/추가 오픈</p>
            <p className="text-[12px] text-taupe-500 font-light">위 스케줄은 매주 반복되는 기본 패턴입니다. 특정 날짜의 휴무일이나 추가 오픈은 정식 출시 후 캘린더에서 설정할 수 있습니다.</p>
          </div>
        </div>
      </motion.div>

      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.2 }} className="mt-6">
        <button onClick={handleSave} className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-[14px] font-medium transition-all ${saved ? "bg-[#2E7D5A] text-white" : "bg-noir-800 text-white hover:bg-noir-soft"}`}>
          <Save className="w-4 h-4" />{saved ? "저장되었습니다!" : "스케줄 저장"}
        </button>
      </motion.div>
    </div>
  );
}
