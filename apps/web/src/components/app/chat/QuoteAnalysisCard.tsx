"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Minus,
  Search,
  Shield,
} from "lucide-react";
import type { ToolExecutionResult } from "@/types/database.types";
import { weddingLinkProps } from "@/lib/weddingPaths";

interface QuoteAnalysisCardProps {
  result: ToolExecutionResult;
  onSend?: (text: string) => void;
  disabled?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  sdm_package: "사진 촬영·드레스·메이크업 묶음 견적",
  studio: "사진 촬영",
  dress: "웨딩드레스",
  makeup: "헤어·메이크업",
};

const ITEM_CATEGORY_LABELS: Record<string, string> = {
  studio: "사진 촬영",
  dress: "웨딩드레스",
  makeup: "헤어·메이크업",
  common: "결혼식 당일",
};

const SEVERITY_STYLES = {
  critical: { bg: "bg-[#F3F7F1]", border: "border-[#C7D1C2]", text: "text-[var(--hb-text-strong)]", badge: "bg-[#E8EFE5] text-[var(--hb-text-strong)]", label: "먼저" },
  high: { bg: "bg-[var(--hb-surface-page)]", border: "border-[#E2D3C8]", text: "text-[var(--hb-text-body)]", badge: "bg-[var(--hb-surface-hover)] text-[var(--hb-text-body)]", label: "함께" },
  medium: { bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-600", badge: "bg-slate-100 text-slate-600", label: "해당 시" },
};

interface ChecklistItem {
  id: string;
  name: string;
  category: string;
  severity: "critical" | "high" | "medium";
  checkQuestion: string;
}

interface MissingItem {
  name: string;
  category: string;
  severity: "critical" | "high" | "medium";
  reason: string;
  checkQuestion: string;
  disguise: string;
}

export default function QuoteAnalysisCard({ result, onSend, disabled }: QuoteAnalysisCardProps) {
  const data = result.toolOutput as Record<string, unknown>;
  const mode = (data.mode as string) || "analysis";

  if (mode === "checklist") {
    return <ChecklistMode data={data} onSend={onSend} disabled={disabled} />;
  }
  return <AnalysisMode data={data} />;
}

// ===== 체크리스트 모드 =====
function ChecklistMode({ data, onSend, disabled }: { data: Record<string, unknown>; onSend?: (text: string) => void; disabled?: boolean }) {
  const quotePrice = (data.quotePrice as number) || 0;
  const category = (data.category as string) || "sdm_package";
  const vendorName = (data.vendorName as string) || "";
  const checklistItems = (data.checklistItems as ChecklistItem[]) || [];
  const [submitted, setSubmitted] = useState(false);

  // 3가지 상태: included(포함) / not_needed(이용 안 함) / unknown(확인 필요)
  const [itemStates, setItemStates] = useState<Record<string, "included" | "not_needed" | "unknown">>(() => {
    const init: Record<string, "included" | "not_needed" | "unknown"> = {};
    checklistItems.forEach((item) => { init[item.id] = "unknown"; });
    return init;
  });

  const setItemState = (id: string, state: "included" | "not_needed" | "unknown") => {
    setItemStates((previous) => ({ ...previous, [id]: state }));
  };

  const handleSubmit = () => {
    if (!onSend) return;
    setSubmitted(true);

    const included = checklistItems.filter((i) => itemStates[i.id] === "included").map((i) => i.name);
    const notNeeded = checklistItems.filter((i) => itemStates[i.id] === "not_needed").map((i) => i.name);
    const unknown = checklistItems.filter((i) => itemStates[i.id] === "unknown").map((i) => i.name);

    // AI에게 체크 결과를 보냄
    const msg = `[quote_analysis] 견적 ${quotePrice}만원 (${vendorName || CATEGORY_LABELS[category]}) 항목 상태:\n포함: ${included.length > 0 ? included.join(", ") : "없음"}\n이용 안 함: ${notNeeded.length > 0 ? notNeeded.join(", ") : "없음"}\n확인 필요: ${unknown.length > 0 ? unknown.join(", ") : "없음"}`;
    onSend(msg);
  };

  const [showMore, setShowMore] = useState(false);

  // 심각도별 분류
  const criticalItems = checklistItems.filter((i) => i.severity === "critical");
  const highItems = checklistItems.filter((i) => i.severity === "high");
  const mediumItems = checklistItems.filter((i) => i.severity === "medium");

  // high 항목은 카테고리별 그룹핑
  const highGrouped: Record<string, ChecklistItem[]> = {};
  for (const item of highItems) {
    const cat = item.category;
    if (!highGrouped[cat]) highGrouped[cat] = [];
    highGrouped[cat].push(item);
  }

  // 기본 표시: critical + high, 더보기 시 medium 추가
  const answeredCount = Object.values(itemStates).filter((s) => s !== "unknown").length;

  return (
    <div className="w-full max-w-[440px] rounded-[6px] border border-black/[0.06] bg-white shadow-[var(--shadow-raised)] overflow-hidden">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-[var(--hb-primary)] to-[var(--hb-primary-hover)] px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-[6px] bg-white/20 flex items-center justify-center">
            <Search className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="text-sm text-white font-medium">견적 항목 체크</p>
            <p className="text-[1.0625rem] text-white font-semibold">
              {vendorName || CATEGORY_LABELS[category]} — {quotePrice}만원
            </p>
          </div>
        </div>
      </div>

      {/* 안내 */}
      <div className="px-5 py-3.5 bg-amber-50/60 border-b border-black/[0.06]">
        <p className="text-sm text-amber-800 leading-relaxed">
          견적서에 적힌 내용과 이용 계획에 맞춰 <b>포함</b>, <b>이용 안 함</b>,
          <b>확인 필요</b> 중 하나를 골라주세요.
        </p>
      </div>

      {/* 체크리스트 */}
      {!submitted ? (
        <>
          <div className="max-h-[440px] overflow-y-auto">
            {/* 먼저 확인할 항목(critical)은 항상 표시 */}
            {criticalItems.length > 0 && (
              <div className="border-b border-black/[0.04]">
                <div className="px-5 pt-3.5 pb-1.5 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <p className="text-sm font-semibold text-[var(--hb-text-strong)]">
                    먼저 확인 ({criticalItems.length})
                  </p>
                </div>
                {criticalItems.map((item) => (
                  <ChecklistItemRow key={item.id} item={item} state={itemStates[item.id]} onChange={setItemState} />
                ))}
              </div>
            )}

            {/* 함께 확인할 항목(high) — 카테고리별 그룹 */}
            {Object.entries(highGrouped).map(([cat, items]) => (
              <div key={cat} className="border-b border-black/[0.04]">
                <div className="px-5 pt-3.5 pb-1.5">
                  <p className="text-sm font-semibold text-[var(--hb-text-muted)]">
                    {ITEM_CATEGORY_LABELS[cat] || cat} ({items.length})
                  </p>
                </div>
                {items.map((item) => (
                  <ChecklistItemRow key={item.id} item={item} state={itemStates[item.id]} onChange={setItemState} />
                ))}
              </div>
            ))}

            {/* 선택적 항목 (medium) — 더보기 토글 */}
            {mediumItems.length > 0 && (
              <div className="border-b border-black/[0.04]">
                <button
                  onClick={() => setShowMore(!showMore)}
                  className="w-full px-5 py-3 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
                >
                  <span className="text-sm text-[var(--hb-text-muted)]">
                    선택 항목 {mediumItems.length}개 {showMore ? "접기" : "더보기"}
                  </span>
                  {showMore ? <ChevronUp className="w-5 h-5 text-[var(--hb-text-muted)]" /> : <ChevronDown className="w-5 h-5 text-[var(--hb-text-muted)]" />}
                </button>
                {showMore && mediumItems.map((item) => (
                  <ChecklistItemRow key={item.id} item={item} state={itemStates[item.id]} onChange={setItemState} />
                ))}
              </div>
            )}
          </div>

          {/* 제출 버튼 */}
          <div className="px-5 py-3.5 border-t border-black/[0.06] bg-slate-50/30">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-[var(--hb-text-muted)]">
                {answeredCount}/{checklistItems.length}개 상태 변경
              </span>
              <div className="flex items-center gap-3 text-xs text-[var(--hb-text-muted)]">
                <span className="flex items-center gap-1"><Check className="w-4 h-4 text-emerald-600" />포함</span>
                <span className="flex items-center gap-1"><Minus className="w-4 h-4 text-[#8F6662]" />이용 안 함</span>
                <span className="flex items-center gap-1"><HelpCircle className="w-4 h-4 text-slate-500" />확인 필요</span>
              </div>
            </div>
            <button
              onClick={handleSubmit}
              disabled={disabled}
              className="w-full py-3.5 rounded-[6px] text-base font-semibold text-white bg-gradient-to-r from-[#1A1A1F] to-[#2a2a32] hover:shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              확인 질문 정리하기
            </button>
          </div>
        </>
      ) : (
        <div className="px-5 py-7 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-[6px] bg-emerald-50 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
          </div>
          <p className="text-base text-[var(--hb-text-strong)] font-medium">상태를 정리했어요</p>
          <p className="text-sm text-[var(--hb-text-muted)] mt-1">확인 질문을 준비하고 있어요...</p>
        </div>
      )}
    </div>
  );
}

// ===== 체크리스트 아이템 행 =====
function ChecklistItemRow({
  item,
  state,
  onChange,
}: {
  item: ChecklistItem;
  state: "included" | "not_needed" | "unknown";
  onChange: (id: string, state: "included" | "not_needed" | "unknown") => void;
}) {
  const severity = SEVERITY_STYLES[item.severity];
  return (
    <div className="px-5 py-3">
      <div className="flex min-w-0 items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-[6px] font-medium ${severity.badge}`}>
            {severity.label}
          </span>
          <span className="text-sm text-[var(--hb-text-strong)]">{item.name}</span>
      </div>
      <div
        role="group"
        aria-label={`${item.name} 상태`}
        className="mt-2 grid grid-cols-3 overflow-hidden rounded-[6px] border border-black/[0.08]"
      >
        {([
          { value: "included", label: "포함", icon: Check },
          { value: "not_needed", label: "이용 안 함", icon: Minus },
          { value: "unknown", label: "확인 필요", icon: HelpCircle },
        ] as const).map((option) => {
          const Icon = option.icon;
          const active = state === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(item.id, option.value)}
              className={`flex min-h-10 items-center justify-center gap-1 border-r border-black/[0.08] px-1 text-xs last:border-r-0 ${
                active
                  ? "bg-[var(--hb-selected-bg)] font-medium text-[var(--hb-selected-text)] ring-1 ring-inset ring-[var(--hb-selected-line)]"
                  : "bg-white text-[var(--hb-text-body)] hover:bg-[var(--hb-surface-page)]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ===== 분석 모드 =====
function AnalysisMode({ data }: { data: Record<string, unknown> }) {
  const [expandedSection, setExpandedSection] = useState<string | null>("missing");

  const quotePrice = (data.quotePrice as number) || 0;
  const category = (data.category as string) || "sdm_package";
  const missingItems = (data.missingItems as MissingItem[]) || [];
  const includedItems = (data.includedItems as { name: string; category: string; severity: string }[]) || [];
  const notNeededItems = (data.notNeededItems as { name: string; category: string; severity: string }[]) || [];
  const statsNote = "가격 적정성을 판정하지 않습니다. 계약 항목 확인용 체크리스트입니다.";
  const vendorName = (data.vendorName as string) || "";

  const missingCritical = missingItems.filter((i) => i.severity === "critical");
  const missingHigh = missingItems.filter((i) => i.severity === "high");
  const missingMedium = missingItems.filter((i) => i.severity === "medium");

  const toggleSection = (section: string) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  return (
    <div className="w-full max-w-[440px] rounded-[6px] border border-black/[0.06] bg-white shadow-[var(--shadow-raised)] overflow-hidden">
      {/* 헤더 — 판정(점수·등급) 없이 아직 확인하지 않은 항목 수만 */}
      <div className="bg-gradient-to-r from-[#1A1A1F] to-[#2a2a32] px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/50 font-medium">견적 체크리스트</p>
            <p className="text-[1.0625rem] text-white font-medium mt-1">
              {vendorName || CATEGORY_LABELS[category] || "묶음"} 견적
            </p>
          </div>
          <div className="rounded-[6px] bg-white/10 px-3 py-2 text-center">
            <p className="text-xl font-bold text-white">{missingItems.length}</p>
            <p className="text-xs text-white/60 -mt-0.5">확인 필요</p>
          </div>
        </div>
      </div>

      {/* 핵심 수치 — 전부 사실 */}
      <div className="grid grid-cols-3 divide-x divide-black/[0.06] border-b border-black/[0.06]">
        <div className="px-3 py-3.5 text-center">
          <p className="text-sm text-[var(--hb-text-muted)]">견적가</p>
          <p className="text-lg font-semibold text-[var(--hb-text-strong)] mt-1">{quotePrice}만</p>
        </div>
        <div className="px-3 py-3.5 text-center">
          <p className="text-sm text-[var(--hb-text-muted)]">업체 공시가</p>
          <Link
            {...weddingLinkProps("/price")}
            className="mt-1 inline-flex items-center justify-center text-sm font-semibold text-[var(--hb-primary)] underline underline-offset-2 hover:opacity-80"
          >
            공시 가격 보러가기
          </Link>
        </div>
        <div className="px-3 py-3.5 text-center">
          <p className="text-sm text-[var(--hb-text-muted)]">먼저 확인</p>
          <p className={`text-lg font-semibold mt-1 ${missingCritical.length > 0 ? "text-amber-700" : "text-[var(--hb-text-strong)]"}`}>
            {missingCritical.length}개
          </p>
        </div>
      </div>

      {/* 가격 참고 — 과거 고정 평균가가 저장된 채팅에서도 수치를 재노출하지 않는다. */}
      <div className="px-5 py-3.5 border-b border-black/[0.06]">
        <p className="text-sm text-[var(--hb-text-strong)]">
          최신 업체별 공시가는 ‘업체 공시가’에서 출처와 기준 시점을 확인해 주세요.
        </p>
      </div>

      {/* 아직 확인하지 않은 항목 */}
      <div className="border-b border-black/[0.06]">
        <button
          onClick={() => toggleSection("missing")}
          className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-[var(--color-paper-tape-ink)]" />
            <span className="text-base font-semibold text-[var(--hb-text-strong)]">아직 확인하지 않은 항목 {missingItems.length}개</span>
            {missingCritical.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#E8EFE5] text-[var(--hb-text-strong)]">먼저 {missingCritical.length}</span>
            )}
          </div>
          {expandedSection === "missing" ? <ChevronUp className="w-5 h-5 text-[var(--hb-text-muted)]" /> : <ChevronDown className="w-5 h-5 text-[var(--hb-text-muted)]" />}
        </button>

        {expandedSection === "missing" && (
          <div className="px-5 pb-3.5 space-y-2">
            {[
              { label: "먼저 확인할 항목", items: missingCritical },
              { label: "함께 확인할 항목", items: missingHigh },
              { label: "해당하면 확인할 항목", items: missingMedium },
            ].map(({ label, items }) =>
              items.length > 0 ? (
                <div key={label}>
                  <p className="text-xs text-[var(--hb-text-muted)] font-medium mb-1.5">{label}</p>
                  {items.map((item) => (
                    <MissingItemRow key={item.name} item={item} style={SEVERITY_STYLES[item.severity]} />
                  ))}
                </div>
              ) : null
            )}
          </div>
        )}
      </div>

      {/* 포함된 항목 */}
      {includedItems.length > 0 && (
        <div className="border-b border-black/[0.06]">
          <button
            onClick={() => toggleSection("included")}
            className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-[var(--hb-success)]" />
              <span className="text-base font-semibold text-[var(--hb-text-strong)]">포함 확인된 항목 {includedItems.length}개</span>
            </div>
            {expandedSection === "included" ? <ChevronUp className="w-5 h-5 text-[var(--hb-text-muted)]" /> : <ChevronDown className="w-5 h-5 text-[var(--hb-text-muted)]" />}
          </button>
          {expandedSection === "included" && (
            <div className="px-5 pb-3.5">
              <div className="flex flex-wrap gap-2">
                {includedItems.map((item) => (
                  <span key={item.name} className="inline-flex items-center gap-1 text-sm px-2.5 py-1 rounded-[6px] bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                    <CheckCircle2 className="w-4 h-4" />{item.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {notNeededItems.length > 0 && (
        <div className="border-b border-black/[0.06]">
          <button
            onClick={() => toggleSection("not-needed")}
            className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Minus className="w-5 h-5 text-[#8F6662]" />
              <span className="text-base font-semibold text-[var(--hb-text-strong)]">
                이용 안 함 {notNeededItems.length}개
              </span>
            </div>
            {expandedSection === "not-needed"
              ? <ChevronUp className="w-5 h-5 text-[var(--hb-text-muted)]" />
              : <ChevronDown className="w-5 h-5 text-[var(--hb-text-muted)]" />}
          </button>
          {expandedSection === "not-needed" && (
            <div className="px-5 pb-3.5">
              <div className="flex flex-wrap gap-2">
                {notNeededItems.map((item) => (
                  <span
                    key={item.name}
                    className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-2.5 py-1 text-sm text-[var(--hb-text-body)]"
                  >
                    <Minus className="w-4 h-4" />
                    {item.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 하단 */}
      <div className="px-5 py-3.5 bg-slate-50/50">
        <p className="text-xs text-[var(--hb-text-muted)] leading-relaxed">{statsNote}</p>
        <div className="flex items-center gap-1.5 mt-2">
          <Shield className="w-4 h-4 text-rose-700" />
          <p className="text-xs text-rose-700 font-medium">원하는 항목만 포함 여부와 별도 금액을 서면으로 확인하세요</p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            {...weddingLinkProps("/budget")}
            className="inline-flex min-h-9 items-center rounded-[6px] border border-[#D8C7BB] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--hb-text-strong)] hover:bg-[#FAF8F5] transition-colors"
          >
            예산 관리에서 반영하기
          </Link>
        </div>
      </div>
    </div>
  );
}

// 아직 확인하지 않은 항목 행
function MissingItemRow({ item, style }: { item: MissingItem; style: typeof SEVERITY_STYLES.critical }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`rounded-[6px] border ${style.border} ${style.bg} mb-2 overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3.5 py-2.5 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-xs px-2 py-0.5 rounded-[6px] font-medium flex-shrink-0 ${style.badge}`}>{style.label}</span>
          <span className="text-sm text-[var(--hb-text-strong)] truncate">
            {ITEM_CATEGORY_LABELS[item.category] ? `[${ITEM_CATEGORY_LABELS[item.category]}] ` : ""}{item.name}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4 text-[var(--hb-text-muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--hb-text-muted)]" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3.5 pb-3 space-y-2 border-t border-black/[0.04]">
          <div className="flex items-start gap-2 mt-2.5">
            <AlertTriangle className="w-4 h-4 text-[var(--color-paper-tape-ink)] mt-0.5 flex-shrink-0" />
            <p className="text-xs text-[var(--hb-text-muted)] leading-relaxed">{item.disguise}</p>
          </div>
          <div className="flex items-start gap-2">
            <HelpCircle className="w-4 h-4 text-[var(--hb-accent)] mt-0.5 flex-shrink-0" />
            <p className="text-xs text-[var(--hb-text-strong)] leading-relaxed">{item.reason}</p>
          </div>
          <div className="bg-white rounded-[6px] px-3 py-2.5 border border-black/[0.04]">
            <p className="text-xs text-rose-700 font-medium mb-1">계약 전 확인 질문</p>
            <p className="text-sm text-[var(--hb-text-strong)] leading-relaxed">&ldquo;{item.checkQuestion}&rdquo;</p>
          </div>
        </div>
      )}
    </div>
  );
}
