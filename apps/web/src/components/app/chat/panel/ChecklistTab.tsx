"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getJourneyProgressCounts } from "@hanbang/shared";
import {
  Users, Building2, Camera, Shirt, Palette, Gem, Flower2, Plane, Home, Key,
  Mail, Gift, Video, Package, Sparkles, Flower, Heart, Mic, Box, CheckCircle2,
  ChevronRight, Circle,
} from "lucide-react";
import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import { mergeChecklist, getChecklistCounts } from "@/utils/checklist";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem, ChecklistItem } from "@/types/database.types";
import CollapsibleSection from "./CollapsibleSection";

const ICON_MAP: Record<string, React.ElementType> = {
  Users, Building2, Camera, Shirt, Palette, Video, Gem, Package,
  Flower2, Plane, Home, Key, Mail, Gift,
  Sparkles, Flower, Heart, Mic, Box,
};

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-[#2E7D5A]",
  in_progress: "bg-rose-500",
  not_started: "bg-taupe-400",
};

const STATUS_LABELS: Record<string, string> = {
  completed: "완료",
  in_progress: "진행중",
  not_started: "미정",
};

interface CategoryCheckItem {
  key: string;
  label: string;
  icon: string;
  status: ProgressItem["status"];
  done: number;
  total: number;
  checklist: ChecklistItem[];
}

export default function ChecklistTab() {
  const { journey } = useAuthStore();
  const progress = (journey?.progress ?? {}) as Record<string, ProgressItem>;
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const categories: CategoryCheckItem[] = CATEGORY_CHECKLISTS.map((cat) => {
    const item = progress[cat.key];
    const status: ProgressItem["status"] = item?.status ?? "not_started";
    const template = CHECKLIST_MAP[cat.key];
    const merged = template
      ? mergeChecklist(template.items, item?.checklist, status)
      : [];
    const { done, total } = getChecklistCounts(merged);
    return { key: cat.key, label: cat.label, icon: cat.icon, status, done, total, checklist: merged };
  });

  const activeIncomplete = categories.filter(
    (c) => c.status !== "completed" && (c.status === "in_progress" || c.done > 0),
  );
  const reference = categories.filter((c) => c.status === "not_started" && c.done === 0);
  const completed = categories.filter((c) => c.status === "completed");
  const { done: totalDone, total: totalItems } = getJourneyProgressCounts(progress);
  const overallPercent = totalItems > 0 ? Math.round((totalDone / totalItems) * 100) : 0;

  const renderCategoryRow = (cat: CategoryCheckItem, dimmed?: boolean) => {
    const IconComp = ICON_MAP[cat.icon] ?? CheckCircle2;
    const pct = cat.total > 0 ? Math.round((cat.done / cat.total) * 100) : 0;
    const isExpanded = expandedKeys.has(cat.key);

    return (
      <div key={cat.key}>
        <button
          onClick={() => toggleExpand(cat.key)}
          className={`w-full flex items-center gap-3 py-2 hover:bg-ivory-50 rounded-lg transition-colors ${dimmed ? "opacity-60" : ""}`}
        >
          {/* 펼침 화살표 */}
          <motion.div
            animate={{ rotate: isExpanded ? 90 : 0 }}
            transition={{ duration: 0.15 }}
            className="flex-shrink-0"
          >
            <ChevronRight className="w-4 h-4 text-taupe-400" />
          </motion.div>

          <div className="w-8 h-8 rounded-md bg-ivory-warm flex items-center justify-center flex-shrink-0">
            <IconComp className={`w-4 h-4 ${cat.status === "completed" ? "text-[#2E7D5A]" : "text-taupe-500"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-base text-noir-800 truncate text-left">{cat.label}</span>
              <span className="text-sm text-taupe-400 ml-1">{cat.done}/{cat.total}</span>
            </div>
            {cat.status !== "completed" && (
              <div className="h-1.5 bg-ivory-warm rounded-full overflow-hidden mt-1.5">
                <div
                  className="h-full bg-rose-500 rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full text-white font-medium flex-shrink-0 ${STATUS_COLORS[cat.status]}`}>
            {STATUS_LABELS[cat.status]}
          </span>
        </button>

        {/* 개별 항목 목록 */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="ml-[26px] pl-3.5 border-l border-black/[0.04] py-1">
                {cat.checklist.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 py-1.5">
                    {item.done ? (
                      <CheckCircle2 className="w-5 h-5 text-[#2E7D5A] flex-shrink-0" />
                    ) : (
                      <Circle className="w-5 h-5 text-taupe-400 flex-shrink-0" />
                    )}
                    <span
                      className={`text-sm leading-tight ${
                        item.done
                          ? "text-taupe-400 line-through"
                          : "text-noir-800"
                      }`}
                    >
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* 사용자가 실제로 시작한 항목만 계산 */}
      <div className="px-4 py-3.5 border-b border-black/[0.04]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-taupe-400">시작한 항목 완료율</span>
          <span className="text-base font-medium text-noir-800">
            {totalItems > 0 ? `${overallPercent}%` : "기록 없음"}
          </span>
        </div>
        <div className="h-2.5 bg-ivory-warm rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-rose-500 to-gold rounded-full transition-all"
            style={{ width: `${overallPercent}%` }}
          />
        </div>
        <p className="text-xs text-taupe-400 mt-1.5 text-right">
          {totalItems > 0
            ? `${totalDone}/${totalItems} 항목 완료`
            : "아래 목록은 선택 가능한 준비 참고이며 모두 해야 하는 일이 아니에요."}
        </p>
      </div>

      {/* 직접 시작한 항목 */}
      <CollapsibleSection title="진행 중" count={activeIncomplete.length} defaultOpen>
        <div className="flex flex-col gap-1">
          {activeIncomplete.map((cat) => renderCategoryRow(cat))}
          {activeIncomplete.length === 0 && (
            <p className="text-sm text-taupe-400 py-2 text-center">직접 시작한 항목이 없어요.</p>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="준비 항목 참고" count={reference.length}>
        <div className="flex flex-col gap-1">
          {reference.map((cat) => renderCategoryRow(cat, true))}
        </div>
      </CollapsibleSection>

      {/* 완료 */}
      <CollapsibleSection title="완료" count={completed.length}>
        <div className="flex flex-col gap-1">
          {completed.map((cat) => renderCategoryRow(cat, true))}
          {completed.length === 0 && (
            <p className="text-sm text-taupe-400 py-2 text-center">아직 완료된 항목이 없습니다</p>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
