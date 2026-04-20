"use client";

import { useState, useEffect, useCallback } from "react";
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
  completed: "bg-[#5a6147]",
  in_progress: "bg-[#795252]",
  not_started: "bg-[#B5ADA3]",
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

  if (!template || !isOpen) return null;

  const Icon = ICON_MAP[template.icon] ?? Circle;
  const { done, total } = getChecklistCounts(checklist);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const status = calculateStatus(checklist);

  return (
    <>
      {/* 오버레이 */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-[#1A1A1F]/40 backdrop-blur-sm z-50 animate-fade-in"
      />

      {/* 모달 */}
      <div
        className="fixed inset-x-4 top-[8%] max-w-[520px] mx-auto bg-white rounded-xl shadow-[0_20px_60px_rgb(0,0,0,0.15)] z-50 max-h-[84vh] flex flex-col overflow-hidden animate-fade-in"
      >
        {/* 헤더 */}
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#795252]/10 flex items-center justify-center">
                <Icon className="w-5 h-5 text-[#795252]" />
              </div>
              <div>
                <h3 className="font-serif-kr text-2xl font-light text-[#1A1A1F]">{template.label}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-sm px-2 py-0.5 rounded-full text-white font-medium ${STATUS_COLORS[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                  <span className="text-sm text-[#B5ADA3]">{done}/{total} 완료</span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#B5ADA3] hover:bg-[#F6F3F2] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 진행률 바 */}
          <div className="w-full h-2 bg-[#F6F3F2] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#795252] to-[#946a6a] rounded-full transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-sm text-[#B5ADA3] mt-1.5 text-right">{percent}% 달성</p>
        </div>

        {/* 체크리스트 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 bg-[#FAFAF8]">
          <div className="flex flex-col gap-1">
            {checklist.map((item) => (
              <div
                key={item.id}
                onClick={() => toggleItem(item.id)}
                className="flex items-center gap-3 py-3 px-3 rounded-xl cursor-pointer bg-white hover:bg-[#F6F3F2] transition-colors group"
              >
                <div className="flex-shrink-0">
                  {item.done ? (
                    <div className="w-6 h-6 rounded-full bg-[#795252] flex items-center justify-center">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full border-2 border-[#B5ADA3] group-hover:border-[#795252] transition-colors" />
                  )}
                </div>
                <span
                  className={`text-[17px] leading-snug flex-1 ${
                    item.done
                      ? "text-[#B5ADA3] line-through"
                      : "text-[#504444]"
                  }`}
                >
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 팁 */}
        <div className="px-6 py-4 bg-white border-t border-[#F6F3F2]">
          <div className="flex items-start gap-2.5">
            <Lightbulb className="w-5 h-5 text-[#C9A96E] flex-shrink-0 mt-0.5" />
            <p className="text-base text-[#504444] font-light leading-relaxed">
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
                      className="flex items-center gap-2.5 px-3 py-3 rounded-xl bg-[#F6F3F2] hover:bg-[#795252]/5 transition-colors group"
                    >
                      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${part.color} flex items-center justify-center flex-shrink-0`}>
                        <BookOpen className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-serif-kr text-base font-normal text-[#1A1A1F] truncate">{part.title}</p>
                        <p className="text-sm text-[#B5ADA3]">예절 가이드 보기</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#B5ADA3] group-hover:text-[#795252] transition-colors flex-shrink-0" />
                    </Link>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>
    </>
  );
}
