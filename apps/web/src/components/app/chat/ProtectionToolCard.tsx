"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import type { ToolExecutionResult } from "@/types/database.types";
import { weddingLinkProps } from "@/lib/weddingPaths";
import {
  CalendarClock,
  Clipboard,
  ClipboardCheck,
  MessageSquareText,
  TrendingDown,
  Users,
  Utensils,
} from "lucide-react";

// 계약 점검 카드는 2026-08-18 계약 개입 금지 결정으로 제거했다.
export const PROTECTION_TOOL_NAMES = new Set([
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
  if (typeof value !== "number") return "-";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";
  return `${amount.toLocaleString("ko-KR", { maximumFractionDigits: 4 })}만원`;
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
      className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#D8C7BB] bg-white px-3 py-1.5 text-xs font-medium text-[#2F5F51] hover:border-[#2F5F51]/40 hover:bg-[#F6FAF7] transition-colors"
    >
      {copied ? <ClipboardCheck className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
      {copied ? "복사됨" : "문구 복사"}
    </button>
  );
}

export default function ProtectionToolCard({ result }: ProtectionToolCardProps) {
  if (result.toolName === "simulate_guest_guarantee") {
    return <GuestGuaranteeCard result={result} />;
  }
  return null;
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
    noShowRatePercent?: number | null;
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
      <div className="w-full max-w-[460px] overflow-hidden rounded-[6px] border border-black/[0.06] bg-white shadow-[var(--shadow-raised)]">
        <div className="bg-[#2F5F51] px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[0.16em] text-white/80">GUEST GUARANTEE</p>
              <p className="mt-1 text-lg font-semibold leading-snug text-white">
                {data.venueName || "하객·식대·보증 인원"}
              </p>
            </div>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[6px] bg-white/10">
              <Users className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className={`rounded-[6px] border px-4 py-3 ${risk.bg} ${risk.border}`}>
            <div className="flex items-start gap-2">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${risk.dot}`} />
              <div>
                <p className={`text-sm font-semibold ${risk.text}`}>{data.summaryTitle}</p>
                <p className="mt-1 text-sm leading-relaxed text-[var(--hb-text-body)]">{data.summaryText}</p>
              </div>
            </div>
          </div>

          {isInputNeeded ? (
            <div className="mt-4 rounded-[6px] border border-[#EFE5DA] bg-[#FAF8F5] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--hb-text-strong)]">추가로 확인할 것</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--hb-text-body)]">{data.recommendation}</p>
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
                <section className="mt-4 overflow-hidden rounded-[6px] border border-[#EFE5DA]">
                  <div className="grid grid-cols-4 bg-[#FAF8F5] px-3 py-2 text-xs font-semibold text-[var(--hb-text-muted)]">
                    <span>상황</span>
                    <span className="text-right">참석</span>
                    <span className="text-right">정산</span>
                    <span className="text-right">식대</span>
                  </div>
                  {scenarios.map((scenario) => (
                    <div key={scenario.id} className="grid grid-cols-4 border-t border-[#EFE5DA] px-3 py-2 text-sm text-[var(--hb-text-body)]">
                      <span className="font-medium text-[var(--hb-text-strong)]">{scenario.label}</span>
                      <span className="text-right">{scenario.attendanceGuests}명</span>
                      <span className="text-right">{scenario.payableGuests}명</span>
                      <span className="text-right">{formatManwon(scenario.mealTotalManwon)}</span>
                    </div>
                  ))}
                </section>
              )}

              {data.recommendation && (
                <section className="mt-4 rounded-[6px] border border-[#D8C7BB] bg-white px-3 py-3">
                  <p className="mb-1 text-sm font-semibold text-[var(--hb-text-strong)]">아모라 판단</p>
                  <p className="text-sm leading-relaxed text-[var(--hb-text-body)]">{data.recommendation}</p>
                </section>
              )}
            </>
          )}

          {questions.length > 0 && (
            <section className="mt-4">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--hb-text-strong)]">
                <MessageSquareText className="h-4 w-4 text-[#2F5F51]" />
                결혼식장에 확인할 것
              </div>
              <ol className="space-y-1.5">
                {questions.slice(0, 5).map((question, index) => (
                  <li key={`${question}-${index}`} className="flex gap-2 text-sm leading-relaxed text-[var(--hb-text-body)]">
                    <span className="font-semibold text-[#2F5F51]">{index + 1}.</span>
                    <span>{question}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {data.venueMessage && (
            <section className="mt-4 rounded-[6px] border border-[#D8C7BB] bg-white px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--hb-text-strong)]">복사해서 보낼 확인 문구</p>
                <CopyButton text={data.venueMessage} />
              </div>
              <p className="whitespace-pre-line text-xs leading-relaxed text-[var(--hb-text-body)]">{data.venueMessage}</p>
            </section>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#EFE5DA] pt-3">
            <Link
              {...weddingLinkProps("/budget")}
              className="inline-flex min-h-8 items-center rounded-[6px] border border-[#D8C7BB] bg-[#FAF8F5] px-2.5 py-1 text-xs font-medium text-[#2F5F51] hover:bg-[#F0F7F4] transition-colors"
            >
              예산 관리 열기
            </Link>
            <Link
              {...weddingLinkProps("/schedule")}
              className="inline-flex min-h-8 items-center rounded-[6px] border border-[#D8C7BB] bg-[#FAF8F5] px-2.5 py-1 text-xs font-medium text-[#2F5F51] hover:bg-[#F0F7F4] transition-colors"
            >
              일정 관리 열기
            </Link>
          </div>

          <p className="mt-3 text-[0.6875rem] leading-relaxed text-[var(--hb-text-muted)]">{data.sourceNote}</p>
        </div>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-[#EFE5DA] bg-[#FAF8F5] px-3 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-[var(--hb-text-muted)]">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-base font-semibold text-[var(--hb-text-strong)]">{value}</p>
    </div>
  );
}
