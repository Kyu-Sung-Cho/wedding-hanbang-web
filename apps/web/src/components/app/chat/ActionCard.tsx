"use client";

import type { ToolExecutionResult } from "@/types/database.types";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem } from "@/types/database.types";
import { RETIRED_VENDOR_BOOKING_TOOL_NAMES } from "@/lib/ai/retiredVendorBookingTools";
import {
  RETIRED_AMORA_ACTION_TOOL_NAMES,
  RETIRED_AMORA_MUTATION_TOOL_NAMES,
  RETIRED_EXTERNAL_PLACE_TOOL_NAMES,
  RETIRED_PRODUCT_TOOL_NAMES,
  RETIRED_UNTRUSTED_TOOL_NAMES,
} from "@/lib/ai/tools";
import {
  Calendar,
  CheckCircle2,
  BarChart3,
  ListChecks,
  Info,
  XCircle,
  Check,
  Sparkles,
  ExternalLink,
} from "lucide-react";

interface ActionCardProps {
  result: ToolExecutionResult;
}

function getIcon(toolName: string) {
  switch (toolName) {
    case "get_budget_summary":
      return <BarChart3 className="w-4 h-4" />;
    case "get_schedule_summary":
      return <ListChecks className="w-4 h-4" />;
    case "get_schedule_events":
      return <Calendar className="w-4 h-4" />;
    case "get_wedding_info":
      return <Info className="w-4 h-4" />;
    default:
      return <Info className="w-4 h-4" />;
  }
}

function getTitle(toolName: string) {
  switch (toolName) {
    case "get_budget_summary":
      return "예산 현황";
    case "get_schedule_summary":
      return "진행 현황";
    case "get_schedule_events":
      return "일정 조회";
    case "get_wedding_info":
      return "웨딩 정보";
    default:
      return "정보 조회";
  }
}

function getAccentColor() {
  return "border-[#C9A96E]/30 bg-[#C9A96E]/5";
}

const CATEGORY_LABELS: Record<string, string> = {
  meeting: "상견례", venue: "예식장", studio: "스튜디오", dress: "드레스/턱시도",
  makeup: "메이크업", snap: "스냅/영상", ring: "예물", yedan: "예단",
  hanbok: "한복", shoes: "웨딩구두", bouquet: "부케", honeymoon: "신혼여행",
  houseware: "혼수", housing: "신혼집", invitation: "청첩장", gift: "답례품",
  mc: "사회/축가", ham: "함", pyebaek: "폐백", reserve: "예비비",
};

function formatWon(n: number): string {
  return `${Math.round(n / 10000).toLocaleString()}만원`;
}

// 예산 현황 미니 카드
function BudgetMiniCard() {
  const { journey } = useAuthStore();
  const totalBudget = journey?.total_budget ?? 0;
  const progress = (journey?.progress ?? {}) as Record<string, ProgressItem & {
    contractedTotal?: number;
    paidToDate?: number;
    nextPaymentAmount?: number;
    nextPaymentDate?: string;
  }>;
  const items = Object.entries(progress).flatMap(([key, item]) => {
    if (key.startsWith("__") || !item || typeof item !== "object") return [];
    const hasFinancialFact = ["budget", "contractedTotal", "paidToDate", "nextPaymentAmount", "nextPaymentDate"]
      .some((field) => Object.prototype.hasOwnProperty.call(item, field));
    if (!hasFinancialFact) return [];
    return [{
      key,
      label: CATEGORY_LABELS[key] ?? item.label ?? key,
      budget: item.budget,
      contractedTotal: item.contractedTotal,
      paidToDate: item.paidToDate,
      nextPaymentAmount: item.nextPaymentAmount,
      nextPaymentDate: item.nextPaymentDate,
    }];
  });
  const totalContracted = items.reduce((sum, item) => sum + (item.contractedTotal ?? 0), 0);
  const totalPaid = items.reduce((sum, item) => sum + (item.paidToDate ?? 0), 0);

  if (!totalBudget && items.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-black/[0.06]">
      <div className="grid grid-cols-3 gap-1.5 text-[0.6875rem]">
        <div className="rounded-lg bg-white/70 p-2">
          <p className="text-[#928980]">전체 계획</p>
          <p className="mt-0.5 font-medium text-[#1A1A1F]">{totalBudget > 0 ? formatWon(totalBudget) : "미입력"}</p>
        </div>
        <div className="rounded-lg bg-white/70 p-2">
          <p className="text-[#928980]">계약 총액</p>
          <p className="mt-0.5 font-medium text-[#1A1A1F]">{formatWon(totalContracted)}</p>
        </div>
        <div className="rounded-lg bg-white/70 p-2">
          <p className="text-[#928980]">누적 납부</p>
          <p className="mt-0.5 font-medium text-[#1A1A1F]">{formatWon(totalPaid)}</p>
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        {items.slice(0, 4).map((item) => (
          <div key={item.key} className="rounded-lg bg-white/60 px-2.5 py-2 text-[0.6875rem]">
            <p className="font-medium text-[#1A1A1F]">{item.label}</p>
            <p className="mt-0.5 text-[#928980]">
              계획 {item.budget === undefined ? "미입력" : formatWon(item.budget)} · 계약 {item.contractedTotal === undefined ? "미입력" : formatWon(item.contractedTotal)} · 납부 {item.paidToDate === undefined ? "미입력" : formatWon(item.paidToDate)}
            </p>
            {(item.nextPaymentDate || item.nextPaymentAmount !== undefined) && (
              <p className="mt-0.5 text-[#795252]">다음 납부 {item.nextPaymentDate ?? "날짜 미입력"} · {item.nextPaymentAmount === undefined ? "금액 미입력" : formatWon(item.nextPaymentAmount)}</p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[0.625rem] leading-relaxed text-[#928980]">모두 사용자가 직접 입력한 정리 기록이며 계약 검증이나 증빙이 아닙니다.</p>
    </div>
  );
}

function RetiredActionHistoryCard() {
  return (
    <div className="flex justify-start ml-11 my-1.5">
      <div className="w-full max-w-[24rem] rounded-xl border border-[#eadfc9] bg-[#fff8ec] px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-[#795252]" />
          <span className="text-sm font-semibold text-[#1A1A1F]">이전 기능 기록</span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-[#6F6862]">
          과거 대화에서 생성된 기록입니다. 현재 일정·예산·웨딩 정보의 상태를 증명하거나 변경하지 않습니다. 최신 상태는 각 관리 화면에서 직접 확인해 주세요.
        </p>
      </div>
    </div>
  );
}

function RetiredVendorBookingHistoryCard() {
  return (
    <div className="flex justify-start ml-11 my-1.5">
      <div className="w-full max-w-[24rem] rounded-xl border border-[#eadfc9] bg-[#fff8ec] px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          <Info className="h-4 w-4 text-[#795252]" aria-hidden="true" />
          <span className="text-sm font-semibold text-[#1A1A1F]">과거 업체 탐색·상담·예약 요청 기록</span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-[#6F6862]">
          이 기록은 현재 상태나 업체 수신·예약·취소·계약·결제를 증명하지 않습니다. 아모라에서 다시 실행되지 않으며, 필요한 내용은 업체 공식 채널에서 직접 확인해 주세요.
        </p>
      </div>
    </div>
  );
}

// 진행 현황 미니 카드
function ScheduleMiniCard() {
  const { journey } = useAuthStore();
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
              className="flex items-center gap-2 py-1 pl-2"
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

function MarketReferenceCard({ result }: { result: ToolExecutionResult }) {
  const sourceName = typeof result.toolOutput.sourceName === "string"
    ? result.toolOutput.sourceName
    : "공식 원문";
  const rawSourceUrl = result.toolOutput.sourceUrl;
  const sourceUrl = typeof rawSourceUrl === "string" && rawSourceUrl.startsWith("https://price.go.kr/")
    ? rawSourceUrl
    : null;
  const periodLabel = typeof result.toolOutput.periodLabel === "string"
    ? result.toolOutput.periodLabel
    : null;
  const scopeLabel = typeof result.toolOutput.scopeLabel === "string"
    ? result.toolOutput.scopeLabel
    : null;

  return (
    <div className="flex justify-start ml-11 my-1.5">
      <div className="w-full max-w-[24rem] rounded-xl border border-[#36534E]/20 bg-[#36534E]/5 px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          <Info className="h-4 w-4 text-[#36534E]" />
          <span className="text-sm font-semibold text-[#1A1A1F]">공식 시장 조사 참고</span>
          <span className="ml-auto rounded-full bg-white/70 px-2 py-0.5 text-[0.625rem] font-medium text-[#36534E]">
            {result.success ? "공개 통계" : "자료 없음"}
          </span>
        </div>
        {(periodLabel || scopeLabel) && (
          <p className="mt-1.5 text-[0.6875rem] text-[#6F6862]">
            {[periodLabel, scopeLabel].filter(Boolean).join(" · ")}
          </p>
        )}
        <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-[#504A46]">
          {result.displayMessage}
        </p>
        <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-2 text-[0.6875rem] leading-relaxed text-[#6F6862]">
          개인 견적의 적정성이나 계약 안전성을 판정하지 않습니다. 항목·포함 범위와 업체 원문을 직접 확인하세요.
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[0.6875rem] font-medium">
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[#36534E] underline underline-offset-2"
            >
              {sourceName}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <a href="/wedding/market-prices" className="text-[#795252] underline underline-offset-2">
            조사 범위 자세히 보기
          </a>
        </div>
      </div>
    </div>
  );
}

export default function ActionCard({ result }: ActionCardProps) {
  // get_wedding_info는 AI가 텍스트로 안내하므로 카드 불필요
  if (result.toolName === "get_wedding_info") return null;
  if (
    RETIRED_AMORA_ACTION_TOOL_NAMES.has(result.toolName) ||
    RETIRED_AMORA_MUTATION_TOOL_NAMES.has(result.toolName) ||
    RETIRED_EXTERNAL_PLACE_TOOL_NAMES.has(result.toolName) ||
    RETIRED_PRODUCT_TOOL_NAMES.has(result.toolName) ||
    RETIRED_UNTRUSTED_TOOL_NAMES.has(result.toolName)
  ) {
    return <RetiredActionHistoryCard />;
  }
  if (RETIRED_VENDOR_BOOKING_TOOL_NAMES.has(result.toolName)) {
    return <RetiredVendorBookingHistoryCard />;
  }

  // 의미 없는 결과(실패 + 메시지 없음 / 결과 텅 빔)는 카드를 그리지 않는다.
  // 이전 사고: DB 부족 등으로 AI가 같은 tool 을 6번 호출해 모두 실패하면
  // 빨간 X 카드가 6개 줄줄이 나와 "AI 웨딩플래너인데 깨진 화면"으로 보였음.
  // 정책: 실패 + (메시지 비었거나 ⌜오류⌟·⌜실패⌟ 같은 시스템성 단어) → 안 그림.
  const msg = (result.displayMessage ?? "").trim();
  const outputEmpty =
    !result.toolOutput ||
    (typeof result.toolOutput === "object" && Object.keys(result.toolOutput).length === 0);
  if (!result.success && (msg === "" || outputEmpty)) return null;

  if (result.toolName === "get_market_price") {
    return <MarketReferenceCard result={result} />;
  }

  const icon = getIcon(result.toolName);
  const title = getTitle(result.toolName);
  const accentColor = getAccentColor();

  const isBudgetTool = result.toolName === "get_budget_summary";
  const isScheduleTool = result.toolName === "get_schedule_summary";

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

        {isBudgetTool && <BudgetMiniCard />}
        {isScheduleTool && <ScheduleMiniCard />}
      </div>
    </div>
  );
}
