"use client";

import { PREPARATION_PROGRESS_STATUS_LABELS } from "@hanbang/shared";
import { listCountedBudgetEntries, sumRecordedSpend } from "@/lib/budgetTotals";
import { formatWon } from "@/lib/formatWon";
import {
  FileText,
  Users, Building2, Camera, Shirt, Palette, Gem, Flower2, Plane, Home, Key,
  Mail, Gift, Wallet, Video, Package, Sparkles, Flower, Heart, Mic, Box,
} from "lucide-react";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem } from "@/types/database.types";
import CollapsibleSection from "./CollapsibleSection";

const ICON_MAP: Record<string, React.ElementType> = {
  FileText,
  Users, Building2, Camera, Shirt, Palette, Video, Gem, Package,
  Flower2, Plane, Home, Key, Mail, Gift, Wallet,
  Sparkles, Flower, Heart, Mic, Box,
};

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-[#2E7D5A]",
  in_progress: "bg-[var(--hb-primary)]",
  not_started: "bg-taupe-400",
  not_applicable: "bg-[#8b857c]",
};

// 상태 이름은 예산 화면·대시보드·온보딩과 같은 정본을 쓴다(아직·준비 중·완료·안 해요).
// 이 패널만 "진행중·시작전·해당 없음" 으로 적어, 같은 항목이 화면마다 다른 말로 보였다.
const STATUS_LABELS = PREPARATION_PROGRESS_STATUS_LABELS;

const BUDGET_CATEGORIES = [
  ...CATEGORY_CHECKLISTS,
  { key: "reserve", label: PLANNING_CATEGORY_LABELS.reserve, icon: "Wallet" },
];
const BUDGET_KEYS = BUDGET_CATEGORIES.map((category) => category.key);

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

  // 메인 예산 화면은 고정 분야의 숨김만 적용하고 직접 만든 항목은 보존한다.
  const hidden = new Set(Array.isArray(progress.__hidden)
    ? progress.__hidden.filter((key): key is string => typeof key === "string" && BUDGET_KEYS.includes(key))
    : []);
  const countedProgress = { ...progress, __hidden: [...hidden] };
  const counted = listCountedBudgetEntries(countedProgress, BUDGET_KEYS);
  const amounts = new Map(counted.map((entry) => [entry.key, entry]));
  const definitions = [
    ...BUDGET_CATEGORIES.filter((category) => !hidden.has(category.key)),
    ...counted.filter((entry) => entry.key.startsWith("custom_")).map((entry) => ({
      key: entry.key,
      label: typeof progress[entry.key]?.label === "string" && progress[entry.key].label!.trim()
        ? progress[entry.key].label! : "사용자 항목",
      icon: "Wallet",
    })),
  ];
  const categories: CategoryBudgetItem[] = definitions.map((cat) => {
    const item = progress[cat.key];
    return {
      key: cat.key,
      label: cat.label,
      icon: cat.icon,
      status: item?.status ?? "not_started",
      budget: amounts.get(cat.key)?.budget ?? 0,
      spent: amounts.get(cat.key)?.spent ?? 0,
    };
  });

  const incomplete = categories.filter((c) => c.status !== "completed" && c.status !== "not_applicable");
  const completed = categories.filter((c) => c.status === "completed" || c.status === "not_applicable");
  // 예산 화면과 같은 것을 센다 — 지운 항목 제외, 직접 추가한 항목 포함.
  const totalSpent = sumRecordedSpend(countedProgress, BUDGET_KEYS);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* 총 예산 카드 */}
      <div className="px-4 py-3.5 border-b border-black/[0.04]">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--hb-text-muted)]">총 예산</span>
          <span className="text-lg font-medium text-[var(--hb-text-strong)]">
            {totalBudget > 0 ? formatWon(totalBudget) : "미설정"}
          </span>
        </div>
        {totalBudget > 0 && (
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="text-[var(--hb-text-muted)]">기록 지출</span>
              <span className="text-[var(--hb-accent-hover)]">{formatWon(totalSpent)}</span>
            </div>
            <div className="h-2.5 bg-[var(--hb-surface-hover)] rounded-full overflow-hidden">
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
                <div className="w-8 h-8 rounded-[6px] bg-[var(--hb-surface-hover)] flex items-center justify-center flex-shrink-0">
                  <IconComp className="w-4 h-4 text-[var(--hb-text-body)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-base text-[var(--hb-text-strong)] truncate block">{cat.label}</span>
                </div>
                <BudgetAmounts category={cat} />
                <span className={`text-xs px-2 py-0.5 rounded-full text-white font-medium flex-shrink-0 ${STATUS_COLORS[cat.status]}`}>
                  {STATUS_LABELS[cat.status]}
                </span>
              </div>
            );
          })}
          {incomplete.length === 0 && (
            <p className="text-sm text-[var(--hb-text-muted)] py-2 text-center">남은 항목이 없어요</p>
          )}
        </div>
      </CollapsibleSection>

      {/* 완료 */}
      <CollapsibleSection title={`${STATUS_LABELS.completed}·${STATUS_LABELS.not_applicable}`} count={completed.length}>
        <div className="flex flex-col gap-1.5">
          {completed.map((cat) => {
            const IconComp = ICON_MAP[cat.icon] ?? Wallet;
            return (
              <div key={cat.key} className="flex items-center gap-3 py-2 opacity-60">
                <div className="w-8 h-8 rounded-[6px] bg-[var(--hb-surface-hover)] flex items-center justify-center flex-shrink-0">
                  <IconComp className="w-4 h-4 text-[#2E7D5A]" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-base text-[var(--hb-text-strong)] truncate block">{cat.label}</span>
                </div>
                <BudgetAmounts category={cat} />
                <span className={`text-xs px-2 py-0.5 rounded-full text-white font-medium flex-shrink-0 ${STATUS_COLORS[cat.status]}`}>
                  {STATUS_LABELS[cat.status]}
                </span>
              </div>
            );
          })}
          {completed.length === 0 && (
            <p className="text-sm text-[var(--hb-text-muted)] py-2 text-center">아직 완료했거나 안 하기로 한 항목이 없어요</p>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}

function BudgetAmounts({ category }: { category: CategoryBudgetItem }) {
  return (
    <div className="text-right text-sm text-[var(--hb-text-muted)] flex-shrink-0">
      {category.budget > 0 && <span className="block">배정 {formatWon(category.budget)}</span>}
      {category.spent > 0 && <span className="block">기록 {formatWon(category.spent)}</span>}
    </div>
  );
}
