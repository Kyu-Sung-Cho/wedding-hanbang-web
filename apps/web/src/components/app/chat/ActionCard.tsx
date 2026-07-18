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
  Sparkles,
} from "lucide-react";
import { getActionPriorityLabel, getActionStatusLabel, type AmoraActionItem } from "@/lib/amora/actions";

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
    case "add_amora_action":
    case "get_amora_actions":
    case "update_amora_action":
      return <Sparkles className="w-4 h-4" />;
    case "get_wedding_info":
      return <Info className="w-4 h-4" />;
    default:
      return <Info className="w-4 h-4" />;
  }
}

function getTitle(result: ToolExecutionResult) {
  switch (result.toolName) {
    case "update_budget":
      return "예산 변경";
    case "apply_budget_plan":
      return "예산안 적용";
    case "add_custom_category":
      return "예산 항목 추가";
    case "delete_category":
      return "예산 항목 삭제";
    case "reset_category":
      return "예산 항목 초기화";
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
    case "add_schedule_event":
      return "일정 추가";
    case "update_schedule_event":
      return "일정 변경";
    case "delete_schedule_event":
      return "일정 삭제";
    case "get_schedule_events":
      return "등록 일정";
    case "log_wedding_event":
      return "웨딩 일정 기록";
    case "get_my_bookings":
      return "예약 현황";
    case "get_market_price":
      return "결혼 비용 시세";
    case "get_wedding_info":
      return "웨딩 정보";
    case "toggle_checklist_item":
      return "체크리스트 변경";
    case "update_category_budget": {
      const hasBudget = result.toolInput.budget !== undefined;
      const hasSpent = result.toolInput.spent !== undefined;
      if (hasBudget && hasSpent) return "카테고리 예산·지출 변경";
      if (hasSpent) return "카테고리 지출 변경";
      return "카테고리 예산 변경";
    }
    case "add_amora_action":
      return "아모라 행동 저장";
    case "get_amora_actions":
      return "아모라 행동 목록";
    case "update_amora_action":
      return "아모라 행동 변경";
    default:
      return "작업 완료";
  }
}

function getAccentColor(toolName: string) {
  if (toolName.includes("amora_action")) {
    return "border-[#795252]/20 bg-[#795252]/5";
  }
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

const STATUS_LABELS: Record<string, string> = {
  not_started: "예정",
  in_progress: "진행 중",
  completed: "완료",
};

function formatWon(n: number): string {
  return `${Math.round(n / 10000).toLocaleString()}만원`;
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
    <div className="mt-3 pt-3 border-t border-black/[0.06]">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-sm text-[#928980]">총 {formatWon(totalSpent)} / {formatWon(totalBudget)}</span>
        <span className={`text-sm font-medium ${totalPct >= 100 ? "text-red-400" : "text-[#C4967E]"}`}>{totalPct}%</span>
      </div>
      <div className="space-y-1.5">
        {items.map((cat) => (
          <div key={cat.key} className="flex items-center gap-2 text-sm">
            <span className="text-[#928980] w-[64px] flex-shrink-0 truncate">{cat.label}</span>
            <div className="flex-1 h-1.5 bg-black/[0.04] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${cat.pct >= 100 ? "bg-red-400" : "bg-[#C4967E]"}`}
                style={{ width: `${Math.min(cat.pct, 100)}%` }}
              />
            </div>
            <span className="w-[64px] flex-shrink-0 text-right text-[#1A1A1F]">{formatWon(cat.spent)}</span>
            <span className={`w-[36px] text-right flex-shrink-0 font-medium ${cat.pct >= 100 ? "text-red-400" : "text-[#928980]"}`}>{cat.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function readWonAmount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function BudgetChangeMiniCard({ result }: { result: ToolExecutionResult }) {
  if (result.toolName === "update_budget") {
    const nextBudget = readWonAmount(
      result.toolOutput.total_budget ?? result.toolInput.total_budget,
    );
    const previousBudget = readWonAmount(result.toolOutput.previous_budget);
    if (nextBudget === null) return null;

    return (
      <div
        aria-label="총 예산 변경 결과"
        className="mt-3 flex items-center justify-between gap-3 border-t border-black/[0.06] pt-3"
      >
        <span className="text-sm text-[#928980]">총 예산</span>
        <div className="flex items-center gap-2 text-right tabular-nums">
          {previousBudget !== null && previousBudget !== nextBudget && (
            <>
              <span className="text-xs text-[#B5ADA3] line-through">
                {formatWon(previousBudget)}
              </span>
              <span aria-hidden="true" className="text-xs text-[#B5ADA3]">→</span>
            </>
          )}
          <strong className="text-sm font-semibold text-[#36534E]">
            {formatWon(nextBudget)}
          </strong>
        </div>
      </div>
    );
  }

  if (
    result.toolName !== "update_category_budget"
    && result.toolName !== "add_custom_category"
  ) return null;

  const category = typeof result.toolOutput.category === "string"
    ? result.toolOutput.category
    : typeof result.toolInput.category === "string"
      ? result.toolInput.category
      : "";
  const outputLabel = typeof result.toolOutput.label === "string"
    ? result.toolOutput.label
    : typeof result.toolInput.label === "string"
      ? result.toolInput.label
      : null;
  const categoryLabel = CATEGORY_LABELS[category] ?? outputLabel ?? "카테고리";
  const changedBudget = Object.prototype.hasOwnProperty.call(result.toolInput, "budget")
    ? readWonAmount(result.toolInput.budget)
    : null;
  const changedSpent = Object.prototype.hasOwnProperty.call(result.toolInput, "spent")
    ? readWonAmount(result.toolInput.spent)
    : null;

  if (changedBudget === null && changedSpent === null) return null;
  const changeLabel = changedBudget !== null && changedSpent !== null
    ? "예산·지출"
    : changedSpent !== null
      ? "지출"
      : "예산";

  return (
    <div
      aria-label={`${categoryLabel} ${changeLabel} 변경 결과`}
      className="mt-3 border-t border-black/[0.06] pt-3"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-[#504444]">{categoryLabel}</span>
        <div className="space-y-1 text-right tabular-nums">
          {changedBudget !== null && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-[#928980]">변경된 예산</span>
              <strong className="text-sm font-semibold text-[#36534E]">
                {formatWon(changedBudget)}
              </strong>
            </div>
          )}
          {changedSpent !== null && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-[#928980]">변경된 지출</span>
              <strong className="text-sm font-semibold text-[#36534E]">
                {formatWon(changedSpent)}
              </strong>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface BudgetAllocation {
  category: string;
  budget: number;
}

function readBudgetAllocations(value: unknown): BudgetAllocation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const allocation = candidate as Record<string, unknown>;
    const budget = readWonAmount(allocation.budget);
    if (typeof allocation.category !== "string" || budget === null) return [];
    return [{ category: allocation.category, budget }];
  });
}

function BudgetPlanMiniCard({ result }: { result: ToolExecutionResult }) {
  const totalBudget = readWonAmount(
    result.toolOutput.total_budget ?? result.toolInput.total_budget,
  );
  const previousBudget = readWonAmount(result.toolOutput.previous_budget);
  const outputAllocations = readBudgetAllocations(result.toolOutput.allocations);
  const allocations = outputAllocations.length > 0
    ? outputAllocations
    : readBudgetAllocations(result.toolInput.allocations);

  if (outputAllocations.length === 0) {
    const remainder = readWonAmount(result.toolOutput.remainder_to_reserve) ?? 0;
    if (remainder > 0) {
      const reserve = allocations.find((allocation) => allocation.category === "reserve");
      if (reserve) reserve.budget += remainder;
      else allocations.push({ category: "reserve", budget: remainder });
    }
  }

  if (totalBudget === null && allocations.length === 0) return null;

  return (
    <div
      aria-label="예산안 적용 결과"
      className="mt-3 border-t border-black/[0.06] pt-3"
    >
      {totalBudget !== null && (
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-sm text-[#928980]">적용된 총 예산</span>
          <div className="flex items-center gap-2 text-right tabular-nums">
            {previousBudget !== null && previousBudget !== totalBudget && (
              <>
                <span className="text-xs text-[#B5ADA3] line-through">
                  {formatWon(previousBudget)}
                </span>
                <span aria-hidden="true" className="text-xs text-[#B5ADA3]">→</span>
              </>
            )}
            <strong className="text-sm font-semibold text-[#36534E]">
              {formatWon(totalBudget)}
            </strong>
          </div>
        </div>
      )}
      {allocations.length > 0 && (
        <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
          {allocations.map((allocation) => (
            <div
              key={allocation.category}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="truncate text-[#504444]">
                {CATEGORY_LABELS[allocation.category] ?? allocation.category}
              </span>
              <span className="shrink-0 font-medium tabular-nums text-[#36534E]">
                {formatWon(allocation.budget)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScheduleChangeMiniCard({ result }: { result: ToolExecutionResult }) {
  const category = typeof result.toolOutput.category === "string"
    ? result.toolOutput.category
    : result.toolInput.category;
  const categoryLabel = typeof category === "string"
    ? CATEGORY_LABELS[category] ?? category
    : "준비 항목";

  if (result.toolName === "update_task_status") {
    const status = typeof result.toolOutput.status === "string"
      ? result.toolOutput.status
      : result.toolInput.status;
    const statusLabel = typeof result.toolOutput.statusLabel === "string"
      ? result.toolOutput.statusLabel
      : typeof status === "string"
        ? STATUS_LABELS[status] ?? status
        : null;
    if (!statusLabel) return null;

    return (
      <div
        aria-label={`${categoryLabel} 상태 변경 결과`}
        className="mt-3 flex items-center justify-between gap-3 border-t border-black/[0.06] pt-3"
      >
        <span className="text-sm font-medium text-[#504444]">{categoryLabel}</span>
        <div className="flex items-center gap-2 text-right">
          <span className="text-xs text-[#928980]">변경된 상태</span>
          <strong className="rounded-full bg-[#2E7D5A]/10 px-2 py-0.5 text-sm font-semibold text-[#2E7D5A]">
            {statusLabel}
          </strong>
        </div>
      </div>
    );
  }

  if (result.toolName === "toggle_checklist_item") {
    const itemLabel = typeof result.toolOutput.item_label === "string"
      ? result.toolOutput.item_label
      : typeof result.toolInput.item_id === "string"
        ? result.toolInput.item_id
        : null;
    const done = typeof result.toolOutput.done === "boolean"
      ? result.toolOutput.done
      : result.toolInput.done;
    if (!itemLabel || typeof done !== "boolean") return null;

    return (
      <div
        aria-label={`${categoryLabel} 체크리스트 변경 결과`}
        className="mt-3 flex items-center justify-between gap-3 border-t border-black/[0.06] pt-3"
      >
        <div className="min-w-0">
          <p className="text-xs text-[#928980]">{categoryLabel}</p>
          <p className="truncate text-sm font-medium text-[#504444]">{itemLabel}</p>
        </div>
        <strong className={`shrink-0 rounded-full px-2 py-0.5 text-sm font-semibold ${
          done
            ? "bg-[#2E7D5A]/10 text-[#2E7D5A]"
            : "bg-black/[0.04] text-[#928980]"
        }`}>
          {done ? "완료" : "미완료"}
        </strong>
      </div>
    );
  }

  return null;
}

function ActionItemsMiniCard({ result }: { result: ToolExecutionResult }) {
  const single = result.toolOutput.action as AmoraActionItem | undefined;
  const list = (result.toolOutput.actions as AmoraActionItem[] | undefined) ?? [];
  const actions = single ? [single] : list.slice(0, 4);

  if (actions.length === 0) return null;

  return (
    <div className="mt-2.5 pt-2.5 border-t border-black/[0.06] space-y-1.5">
      {actions.map((action) => (
        <div key={action.id} className="rounded-lg bg-white/70 border border-black/[0.04] p-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#1A1A1F] leading-snug">{action.title}</p>
              {action.description && (
                <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-[#504444]">{action.description}</p>
              )}
            </div>
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[0.625rem] font-semibold ${
              action.priority === "high"
                ? "bg-red-50 text-red-600"
                : action.priority === "low"
                  ? "bg-[#eef2df] text-[#5a6147]"
                  : "bg-[#f3e7e1] text-[#795252]"
            }`}>
              {getActionPriorityLabel(action.priority)}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.625rem] text-[#928980]">
            <span>{getActionStatusLabel(action.status)}</span>
            {action.dueDate && <span>· {action.dueDate}까지</span>}
          </div>
        </div>
      ))}
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
    <div className="mt-3 pt-3 border-t border-black/[0.06] space-y-2">
      {items.map((cat) => (
        <div key={cat.key}>
          <div className="flex items-center gap-2 text-sm mb-1">
            <span className="text-[#928980] flex-shrink-0">{cat.label}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
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
              className="flex items-center gap-2 py-1 pl-2 cursor-pointer hover:bg-black/[0.02] rounded"
            >
              <div className="flex-shrink-0">
                {item.done ? (
                  <div className="w-4 h-4 rounded-full bg-[#2E7D5A] flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                ) : (
                  <div className="w-4 h-4 rounded-full border border-[#B5ADA3]" />
                )}
              </div>
              <span className={`text-sm ${item.done ? "text-[#B5ADA3] line-through" : "text-[#1A1A1F]"}`}>
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

  // 의미 없는 결과(실패 + 메시지 없음 / 결과 텅 빔)는 카드를 그리지 않는다.
  // 이전 사고: DB 부족 등으로 AI가 같은 tool 을 6번 호출해 모두 실패하면
  // 빨간 X 카드가 6개 줄줄이 나와 "AI 웨딩플래너인데 깨진 화면"으로 보였음.
  // 정책: 실패 + (메시지 비었거나 ⌜오류⌟·⌜실패⌟ 같은 시스템성 단어) → 안 그림.
  const msg = (result.displayMessage ?? "").trim();
  const outputEmpty =
    !result.toolOutput ||
    (typeof result.toolOutput === "object" && Object.keys(result.toolOutput).length === 0);
  if (!result.success && (msg === "" || outputEmpty)) return null;

  const icon = getIcon(result.toolName);
  const title = getTitle(result);
  const accentColor = getAccentColor(result.toolName);

  const isBudgetSummary = result.success && result.toolName === "get_budget_summary";
  const isBudgetChange = result.success && (
    result.toolName === "update_budget"
    || result.toolName === "update_category_budget"
    || result.toolName === "add_custom_category"
  );
  const isBudgetPlan = result.success && result.toolName === "apply_budget_plan";
  const isScheduleSummary = result.success && result.toolName === "get_schedule_summary";
  const isScheduleChange = result.success && (
    result.toolName === "update_task_status"
    || result.toolName === "toggle_checklist_item"
  );
  const isAmoraActionTool = result.toolName === "add_amora_action" || result.toolName === "get_amora_actions" || result.toolName === "update_amora_action";

  return (
    <div className="flex justify-start ml-11 my-1.5">
      <div
        className={`rounded-xl border ${accentColor} px-4 py-3 max-w-[24rem] w-full shadow-sm`}
      >
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[#C4967E]">{icon}</span>
          <span className="text-sm font-semibold text-[#1A1A1F]">{title}</span>
          {result.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-auto" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400 ml-auto" />
          )}
        </div>
        <p className="text-xs text-[#928980] leading-relaxed">
          {result.displayMessage}
        </p>

        {isBudgetSummary && <BudgetMiniCard />}
        {isBudgetChange && <BudgetChangeMiniCard result={result} />}
        {isBudgetPlan && <BudgetPlanMiniCard result={result} />}
        {isScheduleSummary && <ScheduleMiniCard />}
        {isScheduleChange && <ScheduleChangeMiniCard result={result} />}
        {isAmoraActionTool && <ActionItemsMiniCard result={result} />}
      </div>
    </div>
  );
}
