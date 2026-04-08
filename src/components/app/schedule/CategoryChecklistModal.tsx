"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Check,
  Circle,
  Lightbulb,
  Building2,
  Camera,
  Shirt,
  Palette,
  Gem,
  Flower2,
  Plane,
  Home,
  Mail,
  Gift,
  Users,
  Video,
  Package,
  Sparkles,
  Flower,
  Heart,
  Mic,
  Box,
  Key,
  BookOpen,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { CATEGORY_ETIQUETTE_MAP, ETIQUETTE_PARTS } from "@/constants/etiquetteData";
import { mergeChecklist, calculateStatus, getChecklistCounts } from "@/utils/checklist";
import { useAuthStore } from "@/stores/authStore";
import type { ChecklistItem, ProgressItem } from "@/types/database.types";

const ICON_MAP: Record<string, React.ElementType> = {
  Building2,
  Camera,
  Shirt,
  Palette,
  Gem,
  Flower2,
  Plane,
  Home,
  Mail,
  Gift,
  Users,
  Video,
  Package,
  Sparkles,
  Flower,
  Heart,
  Mic,
  Box,
  Key,
};

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-[#2E7D5A]",
  in_progress: "bg-rose-500",
  not_started: "bg-taupe-400",
};

const STATUS_LABELS: Record<string, string> = {
  completed: "완료",
  in_progress: "진행중",
  not_started: "시작전",
};

interface Props {
  categoryKey: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function CategoryChecklistModal({ categoryKey, isOpen, onClose }: Props) {
  const { journey, updateJourney } = useAuthStore();
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [saving, setSaving] = useState(false);

  const template = CHECKLIST_MAP[categoryKey];
  const progress = journey?.progress ?? {};
  const existing = progress[categoryKey] as ProgressItem | undefined;

  // 모달 열릴 때 체크리스트 초기화
  useEffect(() => {
    if (!isOpen || !template) return;
    const merged = mergeChecklist(template.items, existing?.checklist, existing?.status);
    setChecklist(merged);
  }, [isOpen, categoryKey, template, existing?.checklist]);

  const toggleItem = useCallback(
    async (itemId: string) => {
      if (saving) return;

      const updated = checklist.map((c) =>
        c.id === itemId ? { ...c, done: !c.done } : c
      );
      setChecklist(updated);

      const newStatus = calculateStatus(updated);
      const newProgress: Record<string, ProgressItem> = {
        ...progress,
        [categoryKey]: {
          ...(existing ?? { category: categoryKey }),
          category: categoryKey,
          status: newStatus,
          checklist: updated,
        },
      };

      setSaving(true);
      await updateJourney({ progress: newProgress });
      setSaving(false);
    },
    [checklist, saving, progress, categoryKey, existing, updateJourney]
  );

  if (!template) return null;

  const Icon = ICON_MAP[template.icon] ?? Circle;
  const { done, total } = getChecklistCounts(checklist);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const status = calculateStatus(checklist);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 오버레이 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/30 z-50"
          />

          {/* 모달 */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.97 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-x-4 top-[10%] max-w-[520px] mx-auto bg-white rounded-2xl shadow-xl z-50 max-h-[80vh] flex flex-col overflow-hidden"
          >
            {/* 헤더 */}
            <div className="px-6 pt-6 pb-4 border-b border-black/[0.04]">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center">
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-[25px] font-medium text-[#1A1A1F]">{template.label}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[25px] px-2 py-0.5 rounded-full text-white font-medium ${STATUS_COLORS[status]}`}>
                        {STATUS_LABELS[status]}
                      </span>
                      <span className="text-[38px] text-[#928980]">{done}/{total} 완료</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[#B5ADA3] hover:bg-[#FAF8F5] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 진행률 바 */}
              <div className="w-full h-2 bg-[#FAF7F2] rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-[#C4967E] to-[#C9A96E] rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${percent}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
              <p className="text-[23px] text-[#928980] mt-1.5 text-right">{percent}% 달성</p>
            </div>

            {/* 체크리스트 */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="flex flex-col gap-1">
                {checklist.map((item, i) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => toggleItem(item.id)}
                    className="flex items-center gap-3 py-3 px-3 -mx-3 rounded-xl cursor-pointer hover:bg-[#FDFCFA] transition-colors group"
                  >
                    <div className="flex-shrink-0">
                      {item.done ? (
                        <div className="w-6 h-6 rounded-full bg-[#2E7D5A] flex items-center justify-center">
                          <Check className="w-3.5 h-3.5 text-white" />
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full border-2 border-[#B5ADA3] group-hover:border-[#C4967E] transition-colors" />
                      )}
                    </div>
                    <span
                      className={`text-[25px] leading-snug flex-1 ${
                        item.done
                          ? "text-[#B5ADA3] line-through"
                          : "text-[#1A1A1F]"
                      }`}
                    >
                      {item.label}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* 팁 */}
            <div className="px-6 py-4 border-t border-black/[0.04] bg-[#FDFCFA]">
              <div className="flex items-start gap-2.5">
                <Lightbulb className="w-4 h-4 text-[#C9A96E] flex-shrink-0 mt-0.5" />
                <p className="text-[38px] text-[#928980] font-light leading-relaxed">
                  {template.tip}
                </p>
              </div>

              {/* 관련 예절 가이드 */}
              {(() => {
                const partNums = CATEGORY_ETIQUETTE_MAP[categoryKey] ?? [];
                if (partNums.length === 0) return null;
                return (
                  <div className="mt-3 flex flex-col gap-1.5">
                    {partNums.map((num) => {
                      const part = ETIQUETTE_PARTS.find((p) => p.number === num);
                      if (!part) return null;
                      return (
                        <Link
                          key={num}
                          href={`/etiquette?part=${num}`}
                          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white border border-black/[0.04] hover:border-[#C4967E]/30 transition-colors group"
                        >
                          <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${part.color} flex items-center justify-center flex-shrink-0`}>
                            <BookOpen className="w-3.5 h-3.5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[38px] font-medium text-[#1A1A1F] truncate">{part.title}</p>
                            <p className="text-[25px] text-[#928980]">예절 가이드 보기</p>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-[#B5ADA3] group-hover:text-[#C4967E] transition-colors flex-shrink-0" />
                        </Link>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
