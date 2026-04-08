"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, HelpCircle, Shield, TrendingDown, TrendingUp, XCircle, Search, Circle, Check } from "lucide-react";
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
  common: "본식/공통",
};

const SEVERITY_STYLES = {
  critical: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", badge: "bg-red-100 text-red-700", label: "필수" },
  high: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", badge: "bg-amber-100 text-amber-700", label: "높음" },
  medium: { bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-600", badge: "bg-slate-100 text-slate-600", label: "선택" },
};

const GRADE_STYLES: Record<string, { bg: string; text: string }> = {
  A: { bg: "bg-emerald-50", text: "text-emerald-700" },
  B: { bg: "bg-blue-50", text: "text-blue-700" },
  C: { bg: "bg-amber-50", text: "text-amber-700" },
  D: { bg: "bg-orange-50", text: "text-orange-700" },
  F: { bg: "bg-red-50", text: "text-red-700" },
};

interface ChecklistItem {
  id: string;
  name: string;
  category: string;
  severity: "critical" | "high" | "medium";
  price: number;
  usageRate: number;
  checkQuestion: string;
}

interface MissingItem {
  name: string;
  category: string;
  severity: "critical" | "high" | "medium";
  price: number;
  usageRate: number;
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

  // 3가지 상태: included(포함) / excluded(미포함) / unknown(모름)
  const [itemStates, setItemStates] = useState<Record<string, "included" | "excluded" | "unknown">>(() => {
    const init: Record<string, "included" | "excluded" | "unknown"> = {};
    checklistItems.forEach((item) => { init[item.id] = "unknown"; });
    return init;
  });

  const cycleState = (id: string) => {
    setItemStates((prev) => {
      const current = prev[id];
      const next = current === "unknown" ? "included" : current === "included" ? "excluded" : "unknown";
      return { ...prev, [id]: next };
    });
  };

  const handleSubmit = () => {
    if (!onSend) return;
    setSubmitted(true);

    const included = checklistItems.filter((i) => itemStates[i.id] === "included").map((i) => i.name);
    const excluded = checklistItems.filter((i) => itemStates[i.id] === "excluded").map((i) => i.name);

    // AI에게 체크 결과를 보냄
    const msg = `[quote_analysis] 견적 ${quotePrice}만원 (${vendorName || CATEGORY_LABELS[category]}) 포함 항목 확인 결과:\n포함: ${included.length > 0 ? included.join(", ") : "없음"}\n미포함: ${excluded.length > 0 ? excluded.join(", ") : "없음"}`;
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
  const visibleCount = criticalItems.length + highItems.length + (showMore ? mediumItems.length : 0);
  const answeredCount = Object.values(itemStates).filter((s) => s !== "unknown").length;

  return (
    <div className="w-full max-w-[400px] rounded-2xl border border-black/[0.06] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.04)] overflow-hidden">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-[#C4967E] to-[#C9A96E] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
            <Search className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-[11px] text-white/70 font-medium">AI 견적 체크</p>
            <p className="text-[15px] text-white font-semibold">
              {vendorName || CATEGORY_LABELS[category]} — {quotePrice}만원
            </p>
          </div>
        </div>
      </div>

      {/* 안내 */}
      <div className="px-4 py-3 bg-amber-50/60 border-b border-black/[0.06]">
        <p className="text-[12px] text-amber-800 leading-relaxed">
          아래 항목이 견적에 <b>포함</b>인지 확인해주세요.
          탭하면 포함 → 미포함 → 모름 순으로 바뀝니다.
        </p>
      </div>

      {/* 체크리스트 */}
      {!submitted ? (
        <>
          <div className="max-h-[400px] overflow-y-auto">
            {/* 🚨 필수급 항목 (critical) — 항상 표시 */}
            {criticalItems.length > 0 && (
              <div className="border-b border-black/[0.04]">
                <div className="px-4 pt-3 pb-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-red-500" />
                  <p className="text-[11px] font-semibold text-red-600">
                    꼭 확인하세요 ({criticalItems.length})
                  </p>
                </div>
                {criticalItems.map((item) => (
                  <ChecklistItemRow key={item.id} item={item} state={itemStates[item.id]} onToggle={cycleState} />
                ))}
              </div>
            )}

            {/* ⚠️ 높은 이용률 항목 (high) — 카테고리별 그룹 */}
            {Object.entries(highGrouped).map(([cat, items]) => (
              <div key={cat} className="border-b border-black/[0.04]">
                <div className="px-4 pt-3 pb-1">
                  <p className="text-[11px] font-semibold text-[#928980] tracking-wider">
                    {ITEM_CATEGORY_LABELS[cat] || cat} ({items.length})
                  </p>
                </div>
                {items.map((item) => (
                  <ChecklistItemRow key={item.id} item={item} state={itemStates[item.id]} onToggle={cycleState} />
                ))}
              </div>
            ))}

            {/* 선택적 항목 (medium) — 더보기 토글 */}
            {mediumItems.length > 0 && (
              <div className="border-b border-black/[0.04]">
                <button
                  onClick={() => setShowMore(!showMore)}
                  className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
                >
                  <span className="text-[11px] text-[#928980]">
                    선택 항목 {mediumItems.length}개 {showMore ? "접기" : "더보기"}
                  </span>
                  {showMore ? <ChevronUp className="w-3.5 h-3.5 text-[#B5ADA3]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#B5ADA3]" />}
                </button>
                {showMore && mediumItems.map((item) => (
                  <ChecklistItemRow key={item.id} item={item} state={itemStates[item.id]} onToggle={cycleState} />
                ))}
              </div>
            )}
          </div>

          {/* 제출 버튼 */}
          <div className="px-4 py-3 border-t border-black/[0.06] bg-slate-50/30">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] text-[#928980]">
                {answeredCount}/{visibleCount}개 확인됨
              </span>
              <div className="flex items-center gap-3 text-[10px] text-[#B5ADA3]">
                <span className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-500" />포함</span>
                <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-red-400" />미포함</span>
                <span className="flex items-center gap-1"><Circle className="w-3 h-3 text-slate-400" />모름</span>
              </div>
            </div>
            <button
              onClick={handleSubmit}
              disabled={disabled || answeredCount === 0}
              className="w-full py-3 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-r from-[#1A1A1F] to-[#2a2a32] hover:shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              견적 분석하기
            </button>
          </div>
        </>
      ) : (
        <div className="px-4 py-6 text-center">
          <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-emerald-50 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-[13px] text-[#1A1A1F] font-medium">체크 완료!</p>
          <p className="text-[11px] text-[#928980] mt-1">분석 결과를 준비하고 있어요...</p>
        </div>
      )}
    </div>
  );
}

// ===== 체크리스트 아이템 행 =====
function ChecklistItemRow({ item, state, onToggle }: { item: ChecklistItem; state: "included" | "excluded" | "unknown"; onToggle: (id: string) => void }) {
  const severity = SEVERITY_STYLES[item.severity];
  return (
    <button
      onClick={() => onToggle(item.id)}
      className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/50 transition-colors text-left"
    >
      <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${
        state === "included" ? "bg-emerald-100" :
        state === "excluded" ? "bg-red-100" :
        "bg-slate-100"
      }`}>
        {state === "included" ? (
          <Check className="w-3.5 h-3.5 text-emerald-600" />
        ) : state === "excluded" ? (
          <XCircle className="w-3.5 h-3.5 text-red-500" />
        ) : (
          <Circle className="w-3.5 h-3.5 text-slate-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium ${severity.badge}`}>
            {severity.label}
          </span>
          <span className="text-[12px] text-[#1A1A1F] truncate">{item.name}</span>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[11px] font-medium text-[#1A1A1F]">~{item.price}만</p>
        <p className="text-[9px] text-[#B5ADA3]">이용률 {item.usageRate}%</p>
      </div>
    </button>
  );
}

// ===== 분석 모드 =====
function AnalysisMode({ data }: { data: Record<string, unknown> }) {
  const [expandedSection, setExpandedSection] = useState<string | null>("missing");

  const quotePrice = (data.quotePrice as number) || 0;
  const category = (data.category as string) || "sdm_package";
  const grade = (data.grade as string) || "C";
  const score = (data.transparencyScore as number) || 0;
  const marketMedian = (data.marketMedian as number) || 0;
  const priceDiffPercent = (data.priceDiffPercent as number) || 0;
  const estimatedHiddenMin = (data.estimatedHiddenMin as number) || 0;
  const estimatedHiddenMax = (data.estimatedHiddenMax as number) || 0;
  const estimatedTotalMin = (data.estimatedTotalMin as number) || 0;
  const estimatedTotalMax = (data.estimatedTotalMax as number) || 0;
  const missingItems = (data.missingItems as MissingItem[]) || [];
  const includedItems = (data.includedItems as { name: string; category: string; severity: string }[]) || [];
  const redFlags = (data.redFlags as { id: string; name: string; description: string }[]) || [];
  const dataSource = (data.dataSource as string) || "";
  const statsNote = (data.statsNote as string) || "";
  const vendorName = (data.vendorName as string) || "";

  const gradeStyle = GRADE_STYLES[grade] || GRADE_STYLES.C;
  const missingCritical = missingItems.filter((i) => i.severity === "critical");
  const missingHigh = missingItems.filter((i) => i.severity === "high");
  const missingMedium = missingItems.filter((i) => i.severity === "medium");

  const toggleSection = (section: string) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  return (
    <div className="w-full max-w-[400px] rounded-2xl border border-black/[0.06] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.04)] overflow-hidden">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-[#1A1A1F] to-[#2a2a32] px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-white/50 font-medium tracking-wider uppercase">AI 견적 분석 리포트</p>
            <p className="text-[15px] text-white font-medium mt-0.5">
              {vendorName || CATEGORY_LABELS[category] || "스드메"} 견적
            </p>
          </div>
          <div className={`w-14 h-14 rounded-2xl ${gradeStyle.bg} flex flex-col items-center justify-center`}>
            <span className={`text-[20px] font-bold ${gradeStyle.text}`}>{grade}</span>
            <span className={`text-[9px] ${gradeStyle.text} -mt-0.5`}>{score}점</span>
          </div>
        </div>
      </div>

      {/* 핵심 수치 3개 */}
      <div className="grid grid-cols-3 divide-x divide-black/[0.06] border-b border-black/[0.06]">
        <div className="px-3 py-3 text-center">
          <p className="text-[10px] text-[#B5ADA3]">견적가</p>
          <p className="text-[16px] font-semibold text-[#1A1A1F] mt-0.5">{quotePrice}만</p>
        </div>
        <div className="px-3 py-3 text-center">
          <p className="text-[10px] text-[#B5ADA3]">예상 추가금</p>
          <p className="text-[16px] font-semibold text-red-600 mt-0.5">
            +{estimatedHiddenMin}~{estimatedHiddenMax}만
          </p>
        </div>
        <div className="px-3 py-3 text-center">
          <p className="text-[10px] text-[#B5ADA3]">예상 실제 비용</p>
          <p className="text-[16px] font-semibold text-[#1A1A1F] mt-0.5">
            {estimatedTotalMin}~{estimatedTotalMax}만
          </p>
        </div>
      </div>

      {/* 시세 비교 */}
      <div className="px-4 py-3 border-b border-black/[0.06]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-[#928980]">시세 대비</span>
          <span className="text-[10px] text-[#B5ADA3]">{dataSource}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${priceDiffPercent > 20 ? "bg-red-400" : priceDiffPercent < -30 ? "bg-amber-400" : "bg-emerald-400"}`}
              style={{ width: `${Math.max(10, Math.min(100, 50 + priceDiffPercent))}%` }}
            />
          </div>
          <span className={`text-[12px] font-semibold ${
            priceDiffPercent > 20 ? "text-red-600" : priceDiffPercent < -30 ? "text-amber-600" : "text-emerald-600"
          }`}>
            {priceDiffPercent > 0 ? "+" : ""}{priceDiffPercent}%
          </span>
        </div>
        <p className="text-[10px] text-[#B5ADA3] mt-1">
          시세 중위값 {marketMedian}만원 기준
          {priceDiffPercent < -30 && " · ⚠️ 기본가가 지나치게 낮을 수 있음"}
        </p>
      </div>

      {/* 레드플래그 */}
      {redFlags.length > 0 && (
        <div className="px-4 py-3 border-b border-black/[0.06] bg-red-50/50">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
            <span className="text-[12px] font-semibold text-red-700">레드플래그 {redFlags.length}건</span>
          </div>
          <div className="space-y-1.5">
            {redFlags.map((flag) => (
              <div key={flag.id} className="flex items-start gap-2">
                <XCircle className="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[11px] font-medium text-red-700">{flag.name}</p>
                  <p className="text-[10px] text-red-600/70">{flag.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 빠진 항목 */}
      <div className="border-b border-black/[0.06]">
        <button
          onClick={() => toggleSection("missing")}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[12px] font-semibold text-[#1A1A1F]">빠진 항목 {missingItems.length}개</span>
            {missingCritical.length > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">필수 {missingCritical.length}</span>
            )}
          </div>
          {expandedSection === "missing" ? <ChevronUp className="w-4 h-4 text-[#B5ADA3]" /> : <ChevronDown className="w-4 h-4 text-[#B5ADA3]" />}
        </button>

        {expandedSection === "missing" && (
          <div className="px-4 pb-3 space-y-2">
            {[
              { label: "필수급 — 미포함 시 거의 확실히 추가", items: missingCritical },
              { label: "높은 이용률 — 대부분 추가하게 됨", items: missingHigh },
              { label: "선택적", items: missingMedium },
            ].map(({ label, items }) =>
              items.length > 0 ? (
                <div key={label}>
                  <p className="text-[10px] text-[#928980] font-medium mb-1">{label}</p>
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
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-[12px] font-semibold text-[#1A1A1F]">포함 확인된 항목 {includedItems.length}개</span>
            </div>
            {expandedSection === "included" ? <ChevronUp className="w-4 h-4 text-[#B5ADA3]" /> : <ChevronDown className="w-4 h-4 text-[#B5ADA3]" />}
          </button>
          {expandedSection === "included" && (
            <div className="px-4 pb-3">
              <div className="flex flex-wrap gap-1.5">
                {includedItems.map((item) => (
                  <span key={item.name} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                    <CheckCircle2 className="w-3 h-3" />{item.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 하단 */}
      <div className="px-4 py-3 bg-slate-50/50">
        <p className="text-[10px] text-[#B5ADA3] leading-relaxed">{statsNote}</p>
        <div className="flex items-center gap-1 mt-1.5">
          <Shield className="w-3 h-3 text-[#C4967E]" />
          <p className="text-[10px] text-[#C4967E] font-medium">계약 전 빠진 항목을 업체에 반드시 확인하세요</p>
        </div>
      </div>
    </div>
  );
}

// 빠진 항목 행
function MissingItemRow({ item, style }: { item: MissingItem; style: typeof SEVERITY_STYLES.critical }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} mb-1.5 overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium flex-shrink-0 ${style.badge}`}>{style.label}</span>
          <span className="text-[11px] text-[#1A1A1F] truncate">
            {ITEM_CATEGORY_LABELS[item.category] ? `[${ITEM_CATEGORY_LABELS[item.category]}] ` : ""}{item.name}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[12px] font-semibold ${style.text}`}>~{item.price}만</span>
          <span className="text-[9px] text-[#B5ADA3]">{item.usageRate}%</span>
          {expanded ? <ChevronUp className="w-3 h-3 text-[#B5ADA3]" /> : <ChevronDown className="w-3 h-3 text-[#B5ADA3]" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 space-y-1.5 border-t border-black/[0.04]">
          <div className="flex items-start gap-1.5 mt-2">
            <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-[10px] text-[#928980] leading-relaxed">{item.disguise}</p>
          </div>
          <div className="flex items-start gap-1.5">
            <HelpCircle className="w-3 h-3 text-blue-400 mt-0.5 flex-shrink-0" />
            <p className="text-[10px] text-[#1A1A1F] leading-relaxed">{item.reason}</p>
          </div>
          <div className="bg-white rounded-lg px-2.5 py-2 border border-black/[0.04]">
            <p className="text-[9px] text-[#C4967E] font-medium mb-0.5">계약 전 확인 질문</p>
            <p className="text-[11px] text-[#1A1A1F] leading-relaxed">&ldquo;{item.checkQuestion}&rdquo;</p>
          </div>
        </div>
      )}
    </div>
  );
}
