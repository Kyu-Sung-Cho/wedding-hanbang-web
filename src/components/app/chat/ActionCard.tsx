"use client";

import type { ToolExecutionResult } from "@/types/database.types";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem } from "@/types/database.types";
import {
  Wallet,
  Calendar,
  CheckCircle2,
  MapPin,
  BarChart3,
  ListChecks,
  Info,
  XCircle,
  Check,
} from "lucide-react";

interface ActionCardProps {
  result: ToolExecutionResult;
}

function getIcon(toolName: string) {
  switch (toolName) {
    case "update_budget":
      return <Wallet className="w-4 h-4" />;
    case "update_wedding_date":
      return <Calendar className="w-4 h-4" />;
    case "update_task_status":
      return <CheckCircle2 className="w-4 h-4" />;
    case "update_venue":
      return <MapPin className="w-4 h-4" />;
    case "get_budget_summary":
      return <BarChart3 className="w-4 h-4" />;
    case "get_schedule_summary":
      return <ListChecks className="w-4 h-4" />;
    case "get_wedding_info":
      return <Info className="w-4 h-4" />;
    default:
      return <Info className="w-4 h-4" />;
  }
}

function getTitle(toolName: string) {
  switch (toolName) {
    case "update_budget":
      return "예산 변경";
    case "update_wedding_date":
      return "날짜 변경";
    case "update_task_status":
      return "일정 업데이트";
    case "update_venue":
      return "예식장 설정";
    case "get_budget_summary":
      return "예산 현황";
    case "get_schedule_summary":
      return "진행 현황";
    case "get_wedding_info":
      return "웨딩 정보";
    case "toggle_checklist_item":
      return "체크리스트 변경";
    case "update_category_budget":
      return "카테고리 예산 변경";
    default:
      return "작업 완료";
  }
}

function getAccentColor(toolName: string) {
  if (toolName.startsWith("update_") || toolName === "toggle_checklist_item") {
    return "border-[#C4967E]/30 bg-[#C4967E]/5";
  }
  return "border-[#C9A96E]/30 bg-[#C9A96E]/5";
}

const CATEGORY_LABELS: Record<string, string> = {
  meeting: "상견례", venue: "예식장", studio: "스튜디오", dress: "드레스/턱시도",
  makeup: "메이크업", snap: "스냅/영상", ring: "예물", yedan: "예단",
  hanbok: "한복", shoes: "웨딩구두", bouquet: "부케", honeymoon: "신혼여행",
  houseware: "혼수", housing: "신혼집", invitation: "청첩장", gift: "답례품",
  mc: "사회/축가", ham: "함", pyebaek: "폐백", reserve: "예비비",
};

const CATEGORY_RATIOS: Record<string, number> = {
  meeting: 0.01, venue: 0.20, studio: 0.10, dress: 0.07, makeup: 0.05,
  snap: 0.04, ring: 0.12, yedan: 0.05, hanbok: 0.03, shoes: 0.01,
  bouquet: 0.01, honeymoon: 0.12, houseware: 0.07, housing: 0.00,
  invitation: 0.02, gift: 0.02, mc: 0.01, ham: 0.01, pyebaek: 0.01, reserve: 0.05,
};

function formatWon(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
  if (n >= 10000) return `${Math.round(n / 10000).toLocaleString()}만`;
  return n.toLocaleString();
}

// 예산 현황 미니 카드
function BudgetMiniCard() {
  const { journey } = useAuthStore();
  const totalBudget = journey?.total_budget ?? 0;
  const progress = (journey?.progress ?? {}) as Record<string, ProgressItem>;

  if (!totalBudget) return null;

  const topCategories = ["venue", "studio", "dress", "makeup", "ring", "honeymoon"];
  const items = topCategories.map((key) => {
    const item = progress[key];
    const budget = item?.budget ?? Math.round(totalBudget * (CATEGORY_RATIOS[key] ?? 0));
    const spent = item?.spent ?? (item?.cost ? (item.cost < 100000 ? item.cost * 10000 : item.cost) : 0);
    const pct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
    return { key, label: CATEGORY_LABELS[key], budget, spent, pct };
  });

  const totalSpent = Object.keys(CATEGORY_LABELS).reduce((s, key) => {
    const item = progress[key];
    const spent = item?.spent ?? (item?.cost ? (item.cost < 100000 ? item.cost * 10000 : item.cost) : 0);
    return s + spent;
  }, 0);
  const totalPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  return (
    <div className="mt-2 pt-2 border-t border-black/[0.06]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[23px] text-[#928980]">총 {formatWon(totalSpent)}원 / {formatWon(totalBudget)}원</span>
        <span className={`text-[23px] font-medium ${totalPct >= 100 ? "text-red-400" : "text-[#C4967E]"}`}>{totalPct}%</span>
      </div>
      <div className="space-y-1">
        {items.map((cat) => (
          <div key={cat.key} className="flex items-center gap-2 text-[23px]">
            <span className="text-[#928980] w-[52px] flex-shrink-0 truncate">{cat.label}</span>
            <div className="flex-1 h-1 bg-black/[0.04] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${cat.pct >= 100 ? "bg-red-400" : "bg-[#C4967E]"}`}
                style={{ width: `${Math.min(cat.pct, 100)}%` }}
              />
            </div>
            <span className="text-[#1A1A1F] w-[36px] text-right flex-shrink-0">{formatWon(cat.spent)}</span>
            <span className={`w-[28px] text-right flex-shrink-0 font-medium ${cat.pct >= 100 ? "text-red-400" : "text-[#928980]"}`}>{cat.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 진행 현황 미니 카드
function ScheduleMiniCard() {
  const { journey, updateJourney } = useAuthStore();
  const progress = (journey?.progress ?? {}) as Record<string, ProgressItem>;

  const categories = ["meeting", "venue", "studio", "dress", "makeup", "ring", "honeymoon", "houseware"];
  const items = categories.map((key) => {
    const item = progress[key];
    const status = item?.status ?? "not_started";
    const checklist = item?.checklist ?? [];
    const done = checklist.filter((c: { done?: boolean }) => c.done).length;
    const total = checklist.length;
    return { key, label: CATEGORY_LABELS[key], status, done, total };
  }).filter(c => c.total > 0);

  const handleToggle = async (catKey: string, itemId: string) => {
    const existing = progress[catKey];
    if (!existing?.checklist) return;
    const newChecklist = existing.checklist.map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item
    );
    const doneCount = newChecklist.filter((c) => c.done).length;
    const totalCount = newChecklist.length;
    const newStatus = doneCount === 0 ? "not_started" : doneCount === totalCount ? "completed" : "in_progress";
    await updateJourney({
      progress: {
        ...progress,
        [catKey]: { ...existing, checklist: newChecklist, status: newStatus },
      },
    });
  };

  if (items.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-black/[0.06] space-y-1.5">
      {items.map((cat) => (
        <div key={cat.key}>
          <div className="flex items-center gap-2 text-[23px] mb-0.5">
            <span className="text-[#928980] flex-shrink-0">{cat.label}</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[23px] font-medium ${
              cat.status === "completed" ? "bg-[#2E7D5A]/10 text-[#2E7D5A]" :
              cat.status === "in_progress" ? "bg-[#C4967E]/10 text-[#C4967E]" :
              "bg-black/[0.04] text-[#928980]"
            }`}>
              {cat.done}/{cat.total}
            </span>
          </div>
          {/* 체크리스트 항목 (최대 3개만 표시) */}
          {progress[cat.key]?.checklist?.slice(0, 3).map((item: { id: string; label: string; done?: boolean }) => (
            <div
              key={item.id}
              onClick={() => handleToggle(cat.key, item.id)}
              className="flex items-center gap-1.5 py-0.5 pl-2 cursor-pointer hover:bg-black/[0.02] rounded"
            >
              <div className="flex-shrink-0">
                {item.done ? (
                  <div className="w-3.5 h-3.5 rounded-full bg-[#2E7D5A] flex items-center justify-center">
                    <Check className="w-2 h-2 text-white" />
                  </div>
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border border-[#B5ADA3]" />
                )}
              </div>
              <span className={`text-[23px] ${item.done ? "text-[#B5ADA3] line-through" : "text-[#1A1A1F]"}`}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function ActionCard({ result }: ActionCardProps) {
  // get_wedding_info는 AI가 텍스트로 안내하므로 카드 불필요
  if (result.toolName === "get_wedding_info") return null;

  const icon = getIcon(result.toolName);
  const title = getTitle(result.toolName);
  const accentColor = getAccentColor(result.toolName);

  const isBudgetTool = result.toolName === "get_budget_summary" || result.toolName === "update_budget" || result.toolName === "update_category_budget";
  const isScheduleTool = result.toolName === "get_schedule_summary" || result.toolName === "update_task_status" || result.toolName === "toggle_checklist_item";

  return (
    <div className="flex justify-start ml-12 my-2">
      <div
        className={`rounded-xl border ${accentColor} px-4 py-3 max-w-[360px] w-full shadow-sm`}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[#C4967E]">{icon}</span>
          <span className="text-xs font-semibold text-[#1A1A1F]">{title}</span>
          {result.success ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 ml-auto" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-red-400 ml-auto" />
          )}
        </div>
        <p className="text-xs text-[#928980] leading-relaxed">
          {result.displayMessage}
        </p>

        {isBudgetTool && <BudgetMiniCard />}
        {isScheduleTool && <ScheduleMiniCard />}
      </div>
    </div>
  );
}
