"use client";

import {
  Users, Building2, Camera, Shirt, Palette, Gem, Flower2, Plane, Home, Key,
  Mail, Gift, Video, Package, Sparkles, Flower, Heart, Mic, Box, CheckCircle2,
} from "lucide-react";
import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import { mergeChecklist, getChecklistCounts } from "@/utils/checklist";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem } from "@/types/database.types";
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
  not_started: "시작전",
};

interface CategoryCheckItem {
  key: string;
  label: string;
  icon: string;
  status: ProgressItem["status"];
  done: number;
  total: number;
}

export default function ChecklistTab() {
  const { journey } = useAuthStore();
  const progress = (journey?.progress ?? {}) as Record<string, ProgressItem>;

  const categories: CategoryCheckItem[] = CATEGORY_CHECKLISTS.map((cat) => {
    const item = progress[cat.key];
    const status: ProgressItem["status"] = item?.status ?? "not_started";
    const template = CHECKLIST_MAP[cat.key];
    const merged = template
      ? mergeChecklist(template.items, item?.checklist, status)
      : [];
    const { done, total } = getChecklistCounts(merged);
    return { key: cat.key, label: cat.label, icon: cat.icon, status, done, total };
  });

  const incomplete = categories.filter((c) => c.status !== "completed");
  const completed = categories.filter((c) => c.status === "completed");
  const totalDone = categories.reduce((s, c) => s + c.done, 0);
  const totalItems = categories.reduce((s, c) => s + c.total, 0);
  const overallPercent = totalItems > 0 ? Math.round((totalDone / totalItems) * 100) : 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* 전체 진행률 */}
      <div className="px-4 py-3 border-b border-black/[0.04]">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-taupe-400">전체 진행률</span>
          <span className="text-[13px] font-medium text-noir-800">{overallPercent}%</span>
        </div>
        <div className="h-2 bg-ivory-warm rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-rose-500 to-gold rounded-full transition-all"
            style={{ width: `${overallPercent}%` }}
          />
        </div>
        <p className="text-[10px] text-taupe-400 mt-1 text-right">
          {totalDone}/{totalItems} 항목 완료
        </p>
      </div>

      {/* 미완료 */}
      <CollapsibleSection title="미완료" count={incomplete.length} defaultOpen>
        <div className="flex flex-col gap-1">
          {incomplete.map((cat) => {
            const IconComp = ICON_MAP[cat.icon] ?? CheckCircle2;
            const pct = cat.total > 0 ? Math.round((cat.done / cat.total) * 100) : 0;
            return (
              <div key={cat.key} className="flex items-center gap-2.5 py-1.5">
                <div className="w-6 h-6 rounded-md bg-ivory-warm flex items-center justify-center flex-shrink-0">
                  <IconComp className="w-3 h-3 text-taupe-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-noir-800 truncate">{cat.label}</span>
                    <span className="text-[10px] text-taupe-400 ml-1">{cat.done}/{cat.total}</span>
                  </div>
                  <div className="h-1 bg-ivory-warm rounded-full overflow-hidden mt-1">
                    <div
                      className="h-full bg-rose-500 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full text-white font-medium flex-shrink-0 ${STATUS_COLORS[cat.status]}`}>
                  {STATUS_LABELS[cat.status]}
                </span>
              </div>
            );
          })}
          {incomplete.length === 0 && (
            <p className="text-[11px] text-taupe-400 py-2 text-center">모든 항목이 완료되었습니다</p>
          )}
        </div>
      </CollapsibleSection>

      {/* 완료 */}
      <CollapsibleSection title="완료" count={completed.length}>
        <div className="flex flex-col gap-1">
          {completed.map((cat) => {
            const IconComp = ICON_MAP[cat.icon] ?? CheckCircle2;
            return (
              <div key={cat.key} className="flex items-center gap-2.5 py-1.5 opacity-60">
                <div className="w-6 h-6 rounded-md bg-ivory-warm flex items-center justify-center flex-shrink-0">
                  <IconComp className="w-3 h-3 text-[#2E7D5A]" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] text-noir-800 truncate block">{cat.label}</span>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full text-white font-medium flex-shrink-0 bg-[#2E7D5A]">
                  완료
                </span>
              </div>
            );
          })}
          {completed.length === 0 && (
            <p className="text-[11px] text-taupe-400 py-2 text-center">아직 완료된 항목이 없습니다</p>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
