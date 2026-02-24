"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Save, RotateCcw, Calendar, Clock, Info, Package, Timer, ChevronDown } from "lucide-react";
import WeeklyTimeGrid from "@/components/vendor/WeeklyTimeGrid";
import { HOURS, DAYS, formatDuration } from "@/data/mockVendors";
import type { TimeSlot } from "@/types/vendor.types";
import { useVendorStore } from "@/stores/vendorStore";

const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

export default function TimeSlotsPage() {
  const { vendor, products, saveTimeSlots, saveProductTimeSlots } = useVendorStore();
  const activeProducts = products.filter(p => p.isActive);

  const [selectedView, setSelectedView] = useState<string>("global");
  const [globalSlots, setGlobalSlots] = useState<TimeSlot[]>(vendor?.timeSlots ?? []);
  const [productSlots, setProductSlots] = useState<Record<string, TimeSlot[]>>(() => {
    const map: Record<string, TimeSlot[]> = {};
    activeProducts.forEach(p => { map[p.id] = [...p.timeSlots]; });
    return map;
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [maxPerSlot, setMaxPerSlot] = useState(1);

  const isGlobal = selectedView === "global";
  const currentSlots = isGlobal ? globalSlots : (productSlots[selectedView] || []);
  const currentProduct = activeProducts.find(p => p.id === selectedView);

  const availableCount = currentSlots.filter(s => s.available).length;
  const totalSlots = HOURS.length * DAYS.length;

  const handleSave = async () => {
    setSaving(true);
    let success: boolean;
    if (isGlobal) {
      success = await saveTimeSlots(globalSlots);
    } else {
      success = await saveProductTimeSlots(selectedView, productSlots[selectedView] || []);
    }
    setSaving(false);
    if (success) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };
  const handleReset = () => {
    if (isGlobal) setGlobalSlots(vendor?.timeSlots ?? []);
    else {
      const p = products.find(pr => pr.id === selectedView);
      if (p) setProductSlots({ ...productSlots, [selectedView]: [...p.timeSlots] });
    }
  };
  const handleAllOn = () => {
    const turned = currentSlots.map(s => ({ ...s, available: true }));
    if (isGlobal) setGlobalSlots(turned);
    else setProductSlots({ ...productSlots, [selectedView]: turned });
  };
  const handleAllOff = () => {
    const turned = currentSlots.map(s => ({ ...s, available: false }));
    if (isGlobal) setGlobalSlots(turned);
    else setProductSlots({ ...productSlots, [selectedView]: turned });
  };
  const handleSlotsChange = (newSlots: TimeSlot[]) => {
    if (isGlobal) setGlobalSlots(newSlots);
    else setProductSlots({ ...productSlots, [selectedView]: newSlots });
  };

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* 상품별 탭 */}
      {activeProducts.length > 0 && (
        <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Package className="w-4 h-4 text-taupe-400" />
            <p className="text-[13px] font-medium text-noir-800">상품별 시간 관리</p>
            <span className="text-[11px] text-taupe-400 font-light">각 상품마다 개별 예약 시간을 설정할 수 있습니다</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            <button
              onClick={() => setSelectedView("global")}
              className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all border ${
                isGlobal
                  ? "bg-noir-800 text-white border-noir-800"
                  : "bg-white text-charcoal border-black/[0.06] hover:border-rose-500/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5" />
                업체 기본 스케줄
              </div>
            </button>
            {products.map(p => {
              const active = selectedView === p.id;
              const slotCount = (productSlots[p.id] || []).filter(s => s.available).length;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedView(p.id)}
                  className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all border ${
                    active
                      ? "bg-rose-500 text-white border-rose-500"
                      : "bg-white text-charcoal border-black/[0.06] hover:border-rose-500/40"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate max-w-[120px]">{p.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      active ? "bg-white/20" : "bg-ivory-warm text-taupe-500"
                    }`}>
                      {slotCount}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* 현재 선택된 상품 정보 */}
      <AnimatePresence mode="wait">
        {currentProduct && (
          <motion.div
            key={currentProduct.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-6 bg-white rounded-2xl border border-rose-500/20 p-5 flex items-center gap-4"
          >
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
              <Timer className="w-5 h-5 text-rose-500" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-medium text-noir-800 truncate">{currentProduct.name}</h3>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-[12px] text-taupe-400">소요 {formatDuration(currentProduct.duration)}</span>
                <span className="text-[12px] text-taupe-400">
                  {currentProduct.price >= 10000
                    ? `${(currentProduct.price / 10000).toFixed(0)}만원`
                    : `${currentProduct.price.toLocaleString()}원`}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 통계 카드 */}
      <div className="grid grid-cols-3 gap-4 mb-6 max-md:grid-cols-1">
        <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.05 }} className="bg-white rounded-2xl p-5 border border-black/[0.04]">
          <div className="flex items-center gap-2 mb-2"><Calendar className="w-4 h-4 text-rose-500" /><p className="text-[12px] text-taupe-500">예약 가능 슬롯</p></div>
          <p className="font-display text-[28px] font-light text-noir-800">{availableCount}<span className="text-[14px] text-taupe-400">/{totalSlots}</span></p>
        </motion.div>
        <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.1 }} className="bg-white rounded-2xl p-5 border border-black/[0.04]">
          <div className="flex items-center gap-2 mb-2"><Clock className="w-4 h-4 text-gold" /><p className="text-[12px] text-taupe-500">주당 운영 시간</p></div>
          <p className="font-display text-[28px] font-light text-noir-800">{availableCount}<span className="text-[14px] text-taupe-400">시간</span></p>
        </motion.div>
        <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.15 }} className="bg-white rounded-2xl p-5 border border-black/[0.04]">
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

      {/* 그리드 */}
      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.2 }} className="bg-white rounded-2xl border border-black/[0.04] p-6">
        <div className="flex items-center justify-between mb-5 max-md:flex-col max-md:gap-3">
          <h3 className="font-serif-kr text-[17px] font-normal text-noir-800">
            {isGlobal ? "기본 주간 스케줄" : `${currentProduct?.name} 시간 설정`}
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={handleAllOn} className="px-3 py-1.5 rounded-lg text-[12px] text-charcoal border border-platinum hover:border-rose-500 hover:text-rose-500 transition-colors">전체 열기</button>
            <button onClick={handleAllOff} className="px-3 py-1.5 rounded-lg text-[12px] text-charcoal border border-platinum hover:border-rose-500 hover:text-rose-500 transition-colors">전체 닫기</button>
            <button onClick={handleReset} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] text-taupe-400 border border-platinum hover:border-taupe-400 transition-colors"><RotateCcw className="w-3 h-3" />초기화</button>
          </div>
        </div>
        <WeeklyTimeGrid slots={currentSlots} onChange={handleSlotsChange} />

        {/* 안내 */}
        <div className="mt-5 bg-ivory-warm rounded-xl p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-taupe-400 flex-shrink-0 mt-0.5" />
          <div>
            {isGlobal ? (
              <>
                <p className="text-[13px] text-noir-800 font-medium mb-1">업체 기본 스케줄</p>
                <p className="text-[12px] text-taupe-500 font-light">
                  상품별 시간이 설정되지 않은 경우 이 기본 스케줄이 적용됩니다.
                  각 상품에 개별 시간을 설정하려면 위 탭에서 상품을 선택하세요.
                </p>
              </>
            ) : (
              <>
                <p className="text-[13px] text-noir-800 font-medium mb-1">{currentProduct?.name} 전용 시간</p>
                <p className="text-[12px] text-taupe-500 font-light">
                  이 상품만의 예약 가능 시간입니다. 고객이 이 상품을 선택하면 여기서 설정한 시간만 표시됩니다.
                  {currentProduct?.duration && ` 소요 시간: ${formatDuration(currentProduct.duration)}`}
                </p>
              </>
            )}
          </div>
        </div>
      </motion.div>

      {/* 상품별 요약 (전체 보기) */}
      {isGlobal && products.length > 0 && (
        <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.25 }} className="mt-6 bg-white rounded-2xl border border-black/[0.04] p-6">
          <h3 className="font-serif-kr text-[17px] font-normal text-noir-800 mb-4">상품별 시간 현황</h3>
          <div className="space-y-3">
            {products.map(p => {
              const pSlots = productSlots[p.id] || [];
              const pAvailable = pSlots.filter(s => s.available).length;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedView(p.id)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-black/[0.04] hover:border-rose-500/30 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center flex-shrink-0">
                    <Timer className="w-4 h-4 text-rose-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-noir-800 truncate">{p.name}</p>
                    <p className="text-[12px] text-taupe-400">{formatDuration(p.duration)}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-[14px] font-medium text-noir-800">{pAvailable}</p>
                      <p className="text-[10px] text-taupe-400">활성 슬롯</p>
                    </div>
                    <div className={`w-2 h-2 rounded-full ${pAvailable > 0 ? "bg-[#2E7D5A]" : "bg-taupe-400/30"}`} />
                  </div>
                </button>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* 저장 버튼 */}
      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.3 }} className="mt-6">
        <button onClick={handleSave} disabled={saving} className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-[14px] font-medium transition-all ${saved ? "bg-[#2E7D5A] text-white" : "bg-noir-800 text-white hover:bg-noir-soft"} ${saving ? "opacity-70 cursor-not-allowed" : ""}`}>
          <Save className="w-4 h-4" />{saving ? "저장 중..." : saved ? "저장되었습니다!" : "스케줄 저장"}
        </button>
      </motion.div>
    </div>
  );
}
