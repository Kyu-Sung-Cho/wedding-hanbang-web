"use client";

import {
  Users, Building2, Camera, Shirt, Palette, Gem, Flower2, Plane, Home, Key,
  Mail, Gift, Wallet, Video, Package, Sparkles, Flower, Heart, Mic, Box,
} from "lucide-react";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem } from "@/types/database.types";
import CollapsibleSection from "./CollapsibleSection";

const ICON_MAP: Record<string, React.ElementType> = {
  Users, Building2, Camera, Shirt, Palette, Video, Gem, Package,
  Flower2, Plane, Home, Key, Mail, Gift, Wallet,
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

function formatWon(n: number): string {
  return `${Math.round(n / 10000).toLocaleString()}만원`;
}

interface CategoryBudgetItem {
  key: string;
  label: string;
  icon: string;
  status: ProgressItem["status"];
  budget: number;
  spent: number;
}

export default function BudgetTab() {
  const { journey } = useAuthStore();
  const totalBudget = journey?.total_budget ?? 0;
  const progress = (journey?.progress ?? {}) as Record<string, ProgressItem>;

  const categories: CategoryBudgetItem[] = CATEGORY_CHECKLISTS.map((cat) => {
    const item = progress[cat.key];
    return {
      key: cat.key,
      label: cat.label,
      icon: cat.icon,
      status: item?.status ?? "not_started",
      budget: item?.budget ?? 0,
      spent: item?.spent ?? 0,
    };
  });

  const incomplete = categories.filter((c) => c.status !== "completed");
  const completed = categories.filter((c) => c.status === "completed");
  const totalSpent = categories.reduce((sum, c) => sum + c.spent, 0);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* 총 예산 카드 */}
      <div className="px-4 py-3.5 border-b border-black/[0.04]">
        <div className="flex items-center justify-between">
          <span className="text-sm text-taupe-400">총 예산</span>
          <span className="text-lg font-medium text-noir-800">
            {totalBudget > 0 ? formatWon(totalBudget) : "미설정"}
          </span>
        </div>
        {totalBudget > 0 && (
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="text-taupe-400">지출</span>
              <span className="text-rose-500">{formatWon(totalSpent)}</span>
            </div>
            <div className="h-2.5 bg-ivory-warm rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-rose-500 to-gold rounded-full transition-all"
                style={{ width: `${Math.min(100, totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 미완료 */}
      <CollapsibleSection title="미완료" count={incomplete.length} defaultOpen>
        <div className="flex flex-col gap-1.5">
          {incomplete.map((cat) => {
            const IconComp = ICON_MAP[cat.icon] ?? Wallet;
            return (
              <div key={cat.key} className="flex items-center gap-3 py-2">
                <div className="w-8 h-8 rounded-md bg-ivory-warm flex items-center justify-center flex-shrink-0">
                  <IconComp className="w-4 h-4 text-taupe-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-base text-noir-800 truncate block">{cat.label}</span>
                </div>
                {cat.budget > 0 && (
                  <span className="text-sm text-taupe-400 flex-shrink-0">{formatWon(cat.budget)}</span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded-full text-white font-medium flex-shrink-0 ${STATUS_COLORS[cat.status]}`}>
                  {STATUS_LABELS[cat.status]}
                </span>
              </div>
            );
          })}
          {incomplete.length === 0 && (
            <p className="text-sm text-taupe-400 py-2 text-center">모든 항목이 완료되었습니다</p>
          )}
        </div>
      </CollapsibleSection>

      {/* 완료 */}
      <CollapsibleSection title="완료" count={completed.length}>
        <div className="flex flex-col gap-1.5">
          {completed.map((cat) => {
            const IconComp = ICON_MAP[cat.icon] ?? Wallet;
            return (
              <div key={cat.key} className="flex items-center gap-3 py-2 opacity-60">
                <div className="w-8 h-8 rounded-md bg-ivory-warm flex items-center justify-center flex-shrink-0">
                  <IconComp className="w-4 h-4 text-[#2E7D5A]" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-base text-noir-800 truncate block">{cat.label}</span>
                </div>
                {cat.spent > 0 && (
                  <span className="text-sm text-taupe-400 flex-shrink-0">{formatWon(cat.spent)}</span>
                )}
                <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium flex-shrink-0 bg-[#2E7D5A]">
                  완료
                </span>
              </div>
            );
          })}
          {completed.length === 0 && (
            <p className="text-sm text-taupe-400 py-2 text-center">아직 완료된 항목이 없습니다</p>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
