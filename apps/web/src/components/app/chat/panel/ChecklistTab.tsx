"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Building2, Camera, Shirt, Palette, Gem, Flower2, Plane, Home, Key,
  Mail, Gift, Video, Package, Sparkles, Flower, Heart, Mic, Box, CheckCircle2,
  ChevronRight, Circle,
} from "lucide-react";
import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import { mergeChecklist, getChecklistCounts, summarizePlanningChecklist } from "@/utils/checklist";
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
  not_applicable: "bg-[#8b857c]",
};

const STATUS_LABELS: Record<string, string> = {
  completed: "완료",
  in_progress: "진행중",
  not_started: "시작전",
  not_applicable: "해당 없음",
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

  const incomplete = categories.filter((c) => c.status !== "completed" && c.status !== "not_applicable");
  const completed = categories.filter((c) => c.status === "completed");
  const skipped = categories.filter((c) => c.status === "not_applicable");
  const summary = summarizePlanningChecklist(CATEGORY_CHECKLISTS, progress);
  const totalDone = summary.done;
  const totalItems = summary.total;
  const overallPercent = summary.percent;

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
      {/* 전체 진행률 */}
      <div className="px-4 py-3.5 border-b border-black/[0.04]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-taupe-400">전체 진행률</span>
          <span className="text-base font-medium text-noir-800">{overallPercent}%</span>
        </div>
        <div className="h-2.5 bg-ivory-warm rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-rose-500 to-gold rounded-full transition-all"
            style={{ width: `${overallPercent}%` }}
          />
        </div>
        <p className="text-xs text-taupe-400 mt-1.5 text-right">
          {totalDone}/{totalItems} 항목 완료
        </p>
      </div>

      {/* 미완료 */}
      <CollapsibleSection title="미완료" count={incomplete.length} defaultOpen>
        <div className="flex flex-col gap-1">
          {incomplete.map((cat) => renderCategoryRow(cat))}
          {incomplete.length === 0 && (
            <p className="text-sm text-taupe-400 py-2 text-center">모든 항목이 완료되었습니다</p>
          )}
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

      <CollapsibleSection title="해당 없음" count={skipped.length}>
        <div className="flex flex-col gap-1">
          {skipped.map((cat) => renderCategoryRow(cat, true))}
        </div>
      </CollapsibleSection>
    </div>
  );
}
