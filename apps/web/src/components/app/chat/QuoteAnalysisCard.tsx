"use client";

import { useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  ClipboardCheck,
  HelpCircle,
  Search,
  Shield,
  XCircle,
} from "lucide-react";
import type { ToolExecutionResult } from "@/types/database.types";

interface QuoteAnalysisCardProps {
  result: ToolExecutionResult;
  onSend?: (text: string) => void;
  disabled?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  sdm_package: "스드메 패키지",
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
};

const ITEM_CATEGORY_LABELS: Record<string, string> = {
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  common: "본식·공통",
};

interface ChecklistItem {
  id: string;
  name: string;
  category: string;
  checkQuestion: string;
}

interface UnconfirmedItem {
  name: string;
  category: string;
  checkQuestion: string;
}

export default function QuoteAnalysisCard({ result, onSend, disabled }: QuoteAnalysisCardProps) {
  const data = result.toolOutput as Record<string, unknown>;
  const mode = (data.mode as string) || "analysis";

  if (mode === "checklist") {
    return <ChecklistMode data={data} onSend={onSend} disabled={disabled} />;
  }
  return <AnalysisMode data={data} />;
}

function ChecklistMode({
  data,
  onSend,
  disabled,
}: {
  data: Record<string, unknown>;
  onSend?: (text: string) => void;
  disabled?: boolean;
}) {
  const quotePrice = (data.quotePrice as number) || 0;
  const category = (data.category as string) || "sdm_package";
  const vendorName = (data.vendorName as string) || "";
  const checklistItems = (data.checklistItems as ChecklistItem[]) || [];
  const [submitted, setSubmitted] = useState(false);
  const [itemStates, setItemStates] = useState<
    Record<string, "included" | "excluded" | "unknown">
  >(() => {
    const initial: Record<string, "included" | "excluded" | "unknown"> = {};
    checklistItems.forEach((item) => {
      initial[item.id] = "unknown";
    });
    return initial;
  });

  const groupedItems = checklistItems.reduce<Record<string, ChecklistItem[]>>((groups, item) => {
    (groups[item.category] ??= []).push(item);
    return groups;
  }, {});
  const answeredCount = Object.values(itemStates).filter((state) => state !== "unknown").length;

  const cycleState = (id: string) => {
    setItemStates((previous) => {
      const current = previous[id];
      const next =
        current === "unknown" ? "included" : current === "included" ? "excluded" : "unknown";
      return { ...previous, [id]: next };
    });
  };

  const handleSubmit = () => {
    if (!onSend) return;
    setSubmitted(true);
    const namesFor = (state: "included" | "excluded" | "unknown") =>
      checklistItems.filter((item) => itemStates[item.id] === state).map((item) => item.name);
    const included = namesFor("included");
    const excluded = namesFor("excluded");
    const unknown = namesFor("unknown");

    onSend(
      `[quote_analysis] 견적 ${quotePrice}만원 (${vendorName || CATEGORY_LABELS[category]}) 사용자가 직접 표시한 확인 결과:\n포함: ${included.length ? included.join(", ") : "없음"}\n미포함으로 확인: ${excluded.length ? excluded.join(", ") : "없음"}\n아직 모름: ${unknown.length ? unknown.join(", ") : "없음"}`
    );
  };

  return (
    <div className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
      <div className="bg-gradient-to-r from-[#C4967E] to-[#C9A96E] px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20">
            <Search className="h-6 w-6 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium text-white/70">추가비용 확인 체크리스트</p>
            <p className="text-[1.0625rem] font-semibold text-white">
              {vendorName || CATEGORY_LABELS[category]} · 입력 견적 {quotePrice}만원
            </p>
          </div>
        </div>
      </div>

      <div className="border-b border-black/[0.06] bg-amber-50/60 px-5 py-3.5">
        <p className="text-sm leading-relaxed text-amber-900">
          각 항목을 견적서나 업체 답변으로 확인한 뒤 표시해주세요. 이 목록은 발생률이나
          필수성을 뜻하지 않습니다.
        </p>
      </div>

      {!submitted ? (
        <>
          <div className="max-h-[440px] overflow-y-auto">
            {Object.entries(groupedItems).map(([itemCategory, items]) => (
              <div key={itemCategory} className="border-b border-black/[0.04]">
                <div className="px-5 pb-1.5 pt-3.5">
                  <p className="text-sm font-semibold tracking-wide text-[#928980]">
                    {ITEM_CATEGORY_LABELS[itemCategory] || itemCategory} ({items.length})
                  </p>
                </div>
                {items.map((item) => (
                  <ChecklistItemRow
                    key={item.id}
                    item={item}
                    state={itemStates[item.id]}
                    onToggle={cycleState}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="border-t border-black/[0.06] bg-slate-50/30 px-5 py-3.5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-[#928980]">
                {answeredCount}/{checklistItems.length}개 직접 확인
              </span>
              <div className="flex items-center gap-3 text-xs text-[#B5ADA3]">
                <span className="flex items-center gap-1">
                  <Check className="h-4 w-4 text-emerald-500" />포함
                </span>
                <span className="flex items-center gap-1">
                  <XCircle className="h-4 w-4 text-red-400" />미포함
                </span>
                <span className="flex items-center gap-1">
                  <Circle className="h-4 w-4 text-slate-400" />모름
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={disabled || answeredCount === 0}
              className="w-full rounded-xl bg-gradient-to-r from-[#1A1A1F] to-[#2a2a32] py-3.5 text-base font-semibold text-white transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
            >
              확인 결과 정리하기
            </button>
          </div>
        </>
      ) : (
        <div className="px-5 py-7 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          </div>
          <p className="text-base font-medium text-[#1A1A1F]">표시한 내용을 정리하고 있어요</p>
          <p className="mt-1 text-sm text-[#928980]">계약 판단이나 가격 판정은 하지 않아요.</p>
        </div>
      )}
    </div>
  );
}

function ChecklistItemRow({
  item,
  state,
  onToggle,
}: {
  item: ChecklistItem;
  state: "included" | "excluded" | "unknown";
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(item.id)}
      aria-label={`${item.name}: ${state === "included" ? "포함" : state === "excluded" ? "미포함" : "모름"}`}
      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50/50"
    >
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          state === "included"
            ? "bg-emerald-100"
            : state === "excluded"
              ? "bg-red-100"
              : "bg-slate-100"
        }`}
      >
        {state === "included" ? (
          <Check className="h-4 w-4 text-emerald-600" />
        ) : state === "excluded" ? (
          <XCircle className="h-4 w-4 text-red-500" />
        ) : (
          <Circle className="h-4 w-4 text-slate-400" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-base text-[#1A1A1F]">{item.name}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[#928980]">{item.checkQuestion}</p>
      </div>
    </button>
  );
}

function AnalysisMode({ data }: { data: Record<string, unknown> }) {
  const [expandedSection, setExpandedSection] = useState<string | null>("unconfirmed");
  const quotePrice = (data.quotePrice as number) || 0;
  const category = (data.category as string) || "sdm_package";
  const unconfirmedItems = (data.unconfirmedItems as UnconfirmedItem[]) || [];
  const includedItems = (data.includedItems as { name: string; category: string }[]) || [];
  const statsNote = (data.statsNote as string) || "";
  const sourceUrl = (data.sourceUrl as string) || "";
  const vendorName = (data.vendorName as string) || "";

  const toggleSection = (section: string) => {
    setExpandedSection((previous) => (previous === section ? null : section));
  };

  return (
    <div className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
      <div className="bg-gradient-to-r from-[#1A1A1F] to-[#2a2a32] px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium tracking-wider text-white/50">추가비용 확인</p>
            <p className="mt-1 text-[1.0625rem] font-medium text-white">
              {vendorName || CATEGORY_LABELS[category] || "스드메"} · 입력 견적 {quotePrice}만원
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 px-3 py-2 text-center">
            <p className="text-xl font-bold text-white">{unconfirmedItems.length}</p>
            <p className="-mt-0.5 text-xs text-white/60">확인 필요</p>
          </div>
        </div>
      </div>

      <div className="border-b border-black/[0.06] bg-[#fffdf7] px-5 py-3.5">
        <p className="text-sm leading-relaxed text-[#635b51]">
          체크하지 않은 항목은 미포함 판정이 아니라 아직 확인되지 않은 항목이에요.
        </p>
      </div>

      <div className="border-b border-black/[0.06]">
        <button
          type="button"
          onClick={() => toggleSection("unconfirmed")}
          className="flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-slate-50/50"
        >
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-amber-600" />
            <span className="text-base font-semibold text-[#1A1A1F]">
              포함 여부 확인 {unconfirmedItems.length}개
            </span>
          </div>
          {expandedSection === "unconfirmed" ? (
            <ChevronUp className="h-5 w-5 text-[#B5ADA3]" />
          ) : (
            <ChevronDown className="h-5 w-5 text-[#B5ADA3]" />
          )}
        </button>
        {expandedSection === "unconfirmed" && (
          <div className="space-y-2 px-5 pb-3.5">
            {unconfirmedItems.map((item) => (
              <div
                key={`${item.category}:${item.name}`}
                className="rounded-xl border border-[#e5d8ca] bg-[#fbf8f2] px-3.5 py-3"
              >
                <p className="text-xs font-medium text-[#928980]">
                  {ITEM_CATEGORY_LABELS[item.category] || item.category}
                </p>
                <p className="mt-0.5 text-sm font-medium text-[#1A1A1F]">{item.name}</p>
                <div className="mt-2 flex items-start gap-2">
                  <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#C4967E]" />
                  <p className="text-xs leading-relaxed text-[#635b51]">{item.checkQuestion}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {includedItems.length > 0 && (
        <div className="border-b border-black/[0.06]">
          <button
            type="button"
            onClick={() => toggleSection("included")}
            className="flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-slate-50/50"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <span className="text-base font-semibold text-[#1A1A1F]">
                사용자가 포함으로 표시 {includedItems.length}개
              </span>
            </div>
            {expandedSection === "included" ? (
              <ChevronUp className="h-5 w-5 text-[#B5ADA3]" />
            ) : (
              <ChevronDown className="h-5 w-5 text-[#B5ADA3]" />
            )}
          </button>
          {expandedSection === "included" && (
            <div className="flex flex-wrap gap-2 px-5 pb-3.5">
              {includedItems.map((item) => (
                <span
                  key={`${item.category}:${item.name}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200/60 bg-emerald-50 px-2.5 py-1 text-sm text-emerald-700"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {item.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-slate-50/50 px-5 py-3.5">
        <p className="text-xs leading-relaxed text-[#928980]">{statsNote}</p>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex text-xs font-medium text-[#36534E] underline-offset-2 hover:underline"
          >
            공식 조사 원문 보기
          </a>
        )}
        <div className="mt-2 flex items-center gap-1.5">
          <Shield className="h-4 w-4 text-[#C4967E]" />
          <p className="text-xs font-medium text-[#C4967E]">
            해당하는 항목만 업체 답변과 계약서로 확인하세요
          </p>
        </div>
      </div>
    </div>
  );
}
