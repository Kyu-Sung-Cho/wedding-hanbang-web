"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { ToolExecutionResult } from "@/types/database.types";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clipboard,
  ClipboardCheck,
  FileCheck2,
  MessageSquareText,
  ShieldCheck,
  TrendingDown,
  Users,
  Utensils,
} from "lucide-react";

export const PROTECTION_TOOL_NAMES = new Set([
  "analyze_contract_readiness",
  "simulate_guest_guarantee",
]);

type RiskLevel = "low" | "medium" | "high";

const RISK_STYLES: Record<RiskLevel, { bg: string; text: string; border: string; dot: string }> = {
  low: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
  },
  medium: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
  high: {
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    dot: "bg-red-500",
  },
};

interface ProtectionToolCardProps {
  result: ToolExecutionResult;
}

function formatManwon(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";
  return `${amount.toLocaleString()}만원`;
}

function getRiskStyle(value: unknown) {
  const risk = value === "low" || value === "medium" || value === "high" ? value : "medium";
  return RISK_STYLES[risk];
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-full border border-[#D8C7BB] bg-white px-3 py-1.5 text-xs font-medium text-[#2F5F51] hover:border-[#2F5F51]/40 hover:bg-[#F6FAF7] transition-colors"
    >
      {copied ? <ClipboardCheck className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
      {copied ? "복사됨" : "문구 복사"}
    </button>
  );
}

export default function ProtectionToolCard({ result }: ProtectionToolCardProps) {
  if (result.toolName === "analyze_contract_readiness") {
    return <ContractReadinessCard result={result} />;
  }
  if (result.toolName === "simulate_guest_guarantee") {
    return <GuestGuaranteeCard result={result} />;
  }
  return null;
}

function ContractReadinessCard({ result }: { result: ToolExecutionResult }) {
  const data = result.toolOutput as {
    categoryLabel?: string;
    vendorName?: string | null;
    riskLevel?: RiskLevel;
    riskLabel?: string;
    summaryTitle?: string;
    summaryText?: string;
    blockers?: Array<{ id: string; label: string; reason: string; question: string; severity: string }>;
    warnings?: Array<{ id: string; label: string; reason: string; question: string; severity: string }>;
    confirmed?: Array<{ id: string; label: string }>;
    vendorQuestions?: string[];
    evidenceToSave?: string[];
    clausesToRequest?: string[];
    messageToVendor?: string;
    sourceNote?: string;
    disclaimer?: string;
  };
  const risk = getRiskStyle(data.riskLevel);
  const blockers = data.blockers ?? [];
  const warnings = data.warnings ?? [];
  const confirmed = data.confirmed ?? [];
  const questions = data.vendorQuestions ?? [];
  const evidence = data.evidenceToSave ?? [];
  const title = data.summaryTitle ?? "계약 전 확인 결과";
  const target = data.vendorName || data.categoryLabel || "계약";

  return (
    <div className="flex justify-start ml-11 my-2">
      <div className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <div className="bg-[#1A1A1F] px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[0.16em] text-white/50">CONTRACT SHIELD</p>
              <p className="mt-1 text-lg font-semibold leading-snug text-white">{target}</p>
            </div>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <ShieldCheck className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 divide-x divide-black/[0.06] border-b border-black/[0.06]">
          <div className="px-3 py-3 text-center">
            <p className="text-xs text-[#928980]">문서 확인 상태</p>
            <p className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${risk.bg} ${risk.text}`}>
              {data.riskLabel ?? "확인 필요 항목 있음"}
            </p>
          </div>
          <div className="px-3 py-3 text-center">
            <p className="text-xs text-[#928980]">필수 미확인</p>
            <p className="mt-1 text-lg font-semibold text-[#1A1A1F]">{blockers.length}개</p>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className={`rounded-xl border px-4 py-3 ${risk.bg} ${risk.border}`}>
            <div className="flex items-start gap-2">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${risk.dot}`} />
              <div>
                <p className={`text-sm font-semibold ${risk.text}`}>{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-[#504444]">{data.summaryText}</p>
              </div>
            </div>
          </div>

          {blockers.length > 0 && (
            <section className="mt-4">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[#1A1A1F]">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                계약 전 먼저 막을 것
              </div>
              <div className="space-y-2">
                {blockers.slice(0, 4).map((item) => (
                  <div key={item.id} className="rounded-xl border border-red-100 bg-red-50/50 px-3 py-2.5">
                    <p className="text-sm font-semibold text-red-700">{item.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[#504444]">{item.reason}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {warnings.length > 0 && (
            <section className="mt-4">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[#1A1A1F]">
                <FileCheck2 className="h-4 w-4 text-amber-600" />
                추가로 확인하면 좋은 것
              </div>
              <div className="flex flex-wrap gap-1.5">
                {warnings.slice(0, 6).map((item) => (
                  <span key={item.id} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                    {item.label}
                  </span>
                ))}
              </div>
            </section>
          )}

          {confirmed.length > 0 && (
            <section className="mt-4">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[#1A1A1F]">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                확인된 항목
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {confirmed.slice(0, 6).map((item) => (
                  <div key={item.id} className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700">
                    {item.label}
                  </div>
                ))}
              </div>
            </section>
          )}

          {questions.length > 0 && (
            <section className="mt-4">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[#1A1A1F]">
                <MessageSquareText className="h-4 w-4 text-[#2F5F51]" />
                업체에 바로 물어볼 문장
              </div>
              <ol className="space-y-1.5">
                {questions.slice(0, 5).map((question, index) => (
                  <li key={`${question}-${index}`} className="flex gap-2 text-sm leading-relaxed text-[#504444]">
                    <span className="font-semibold text-[#2F5F51]">{index + 1}.</span>
                    <span>{question}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {evidence.length > 0 && (
            <section className="mt-4 rounded-xl border border-[#EFE5DA] bg-[#FAF8F5] px-3 py-3">
              <p className="mb-2 text-sm font-semibold text-[#1A1A1F]">저장할 증빙</p>
              <div className="flex flex-wrap gap-1.5">
                {evidence.map((item) => (
                  <span key={item} className="rounded-full bg-white px-2.5 py-1 text-xs text-[#504444] shadow-sm">
                    {item}
                  </span>
                ))}
              </div>
            </section>
          )}

          {data.messageToVendor && (
            <section className="mt-4 rounded-xl border border-[#D8C7BB] bg-white px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[#1A1A1F]">복사해서 보낼 확인 문구</p>
                <CopyButton text={data.messageToVendor} />
              </div>
              <p className="whitespace-pre-line text-xs leading-relaxed text-[#504444]">{data.messageToVendor}</p>
            </section>
          )}

          <p className="mt-3 text-[0.6875rem] leading-relaxed text-[#928980]">
            {data.sourceNote} {data.disclaimer}
          </p>
        </div>
      </div>
    </div>
  );
}

function GuestGuaranteeCard({ result }: { result: ToolExecutionResult }) {
  const data = result.toolOutput as {
    mode?: "input_needed" | "analysis";
    riskLevel?: RiskLevel;
    riskLabel?: string;
    summaryTitle?: string;
    summaryText?: string;
    venueName?: string | null;
    estimatedGuests?: number | null;
    confirmedRsvpGuests?: number | null;
    guaranteedGuests?: number | null;
    mealPriceManwon?: number | null;
    noShowRatePercent?: number;
    expectedAttendanceGuests?: number | null;
    payableGuests?: number | null;
    expectedMealTotalManwon?: number | null;
    emptySeats?: number | null;
    emptySeatLossManwon?: number | null;
    scenarios?: Array<{
      id: string;
      label: string;
      attendanceGuests: number;
      payableGuests: number;
      mealTotalManwon: number;
      emptySeats: number;
      emptySeatLossManwon: number;
    }>;
    missingFields?: string[];
    recommendation?: string;
    vendorQuestions?: string[];
    venueMessage?: string;
    sourceNote?: string;
  };
  const risk = getRiskStyle(data.riskLevel);
  const scenarios = data.scenarios ?? [];
  const questions = data.vendorQuestions ?? [];
  const isInputNeeded = data.mode === "input_needed";

  return (
    <div className="flex justify-start ml-11 my-2">
      <div className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <div className="bg-[#2F5F51] px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[0.16em] text-white/60">GUEST GUARANTEE</p>
              <p className="mt-1 text-lg font-semibold leading-snug text-white">
                {data.venueName || "하객·식대·보증 인원"}
              </p>
            </div>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <Users className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className={`rounded-xl border px-4 py-3 ${risk.bg} ${risk.border}`}>
            <div className="flex items-start gap-2">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${risk.dot}`} />
              <div>
                <p className={`text-sm font-semibold ${risk.text}`}>{data.summaryTitle}</p>
                <p className="mt-1 text-sm leading-relaxed text-[#504444]">{data.summaryText}</p>
              </div>
            </div>
          </div>

          {isInputNeeded ? (
            <div className="mt-4 rounded-xl border border-[#EFE5DA] bg-[#FAF8F5] px-4 py-3">
              <p className="text-sm font-semibold text-[#1A1A1F]">한 번에 필요한 정보</p>
              <p className="mt-1 text-sm leading-relaxed text-[#504444]">{data.recommendation}</p>
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric icon={<Users className="h-4 w-4" />} label="참석 예상" value={`${data.expectedAttendanceGuests ?? "-"}명`} />
                <Metric icon={<Utensils className="h-4 w-4" />} label="보증 인원" value={`${data.guaranteedGuests ?? "-"}명`} />
                <Metric icon={<TrendingDown className="h-4 w-4" />} label="빈 자리" value={`${data.emptySeats ?? 0}명`} />
                <Metric icon={<CalendarClock className="h-4 w-4" />} label="손실 후보" value={formatManwon(data.emptySeatLossManwon)} />
              </div>

              {scenarios.length > 0 && (
                <section className="mt-4 overflow-hidden rounded-xl border border-[#EFE5DA]">
                  <div className="grid grid-cols-4 bg-[#FAF8F5] px-3 py-2 text-xs font-semibold text-[#928980]">
                    <span>상황</span>
                    <span className="text-right">참석</span>
                    <span className="text-right">정산</span>
                    <span className="text-right">식대</span>
                  </div>
                  {scenarios.map((scenario) => (
                    <div key={scenario.id} className="grid grid-cols-4 border-t border-[#EFE5DA] px-3 py-2 text-sm text-[#504444]">
                      <span className="font-medium text-[#1A1A1F]">{scenario.label}</span>
                      <span className="text-right">{scenario.attendanceGuests}명</span>
                      <span className="text-right">{scenario.payableGuests}명</span>
                      <span className="text-right">{formatManwon(scenario.mealTotalManwon)}</span>
                    </div>
                  ))}
                </section>
              )}

              {data.recommendation && (
                <section className="mt-4 rounded-xl border border-[#D8C7BB] bg-white px-3 py-3">
                  <p className="mb-1 text-sm font-semibold text-[#1A1A1F]">아모라 판단</p>
                  <p className="text-sm leading-relaxed text-[#504444]">{data.recommendation}</p>
                </section>
              )}
            </>
          )}

          {questions.length > 0 && (
            <section className="mt-4">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[#1A1A1F]">
                <MessageSquareText className="h-4 w-4 text-[#2F5F51]" />
                예식장에 확인할 것
              </div>
              <ol className="space-y-1.5">
                {questions.slice(0, 5).map((question, index) => (
                  <li key={`${question}-${index}`} className="flex gap-2 text-sm leading-relaxed text-[#504444]">
                    <span className="font-semibold text-[#2F5F51]">{index + 1}.</span>
                    <span>{question}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {data.venueMessage && (
            <section className="mt-4 rounded-xl border border-[#D8C7BB] bg-white px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[#1A1A1F]">복사해서 보낼 확인 문구</p>
                <CopyButton text={data.venueMessage} />
              </div>
              <p className="whitespace-pre-line text-xs leading-relaxed text-[#504444]">{data.venueMessage}</p>
            </section>
          )}

          <p className="mt-3 text-[0.6875rem] leading-relaxed text-[#928980]">{data.sourceNote}</p>
        </div>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#EFE5DA] bg-[#FAF8F5] px-3 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-[#928980]">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-base font-semibold text-[#1A1A1F]">{value}</p>
    </div>
  );
}
