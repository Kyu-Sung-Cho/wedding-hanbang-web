"use client";

import {
  MapPin,
  Users,
  CalendarDays,
  Wallet,
  ThumbsDown,
  ThumbsUp,
  MessageSquareText,
} from "lucide-react";
import type { CostShareData, CostShareCategory } from "@/types/community.types";

interface CostShareDisplayProps {
  data: CostShareData;
}

// 가격 포맷 (만원 단위)
function formatCost(costInManwon: number): string {
  if (costInManwon >= 10000) {
    return `${(costInManwon / 10000).toFixed(1)}억원`;
  }
  return `${costInManwon.toLocaleString()}만원`;
}

// 카테고리별 비율 계산해서 바 너비 반환
function getBarWidth(cost: number, maxCost: number): string {
  if (maxCost === 0) return "0%";
  const pct = Math.min((cost / maxCost) * 100, 100);
  return `${Math.max(pct, 4)}%`;
}

export default function CostShareDisplay({ data }: CostShareDisplayProps) {
  const maxCost =
    data.categories.length > 0
      ? Math.max(...data.categories.map((c) => c.cost))
      : 0;

  return (
    <div className="bg-white border border-black/[0.04] rounded-[6px] overflow-hidden">
      {/* 요약 바 */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-50 to-white border-b border-[#F5F2ED]">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-[6px] bg-emerald-100 flex items-center justify-center text-noir-800 shrink-0">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[12px] text-[var(--hb-text-muted)] leading-none mb-0.5">
                총 비용
              </p>
              <p className="text-sm font-medium text-[var(--hb-text-strong)]">
                {formatCost(data.totalCost)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-[6px] bg-sky-100 flex items-center justify-center text-[var(--hb-accent)] shrink-0">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[12px] text-[var(--hb-text-muted)] leading-none mb-0.5">
                지역
              </p>
              <p className="text-sm font-medium text-[var(--hb-text-strong)]">
                {data.region}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-[6px] bg-amber-100 flex items-center justify-center text-[var(--color-paper-tape-ink)] shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[12px] text-[var(--hb-text-muted)] leading-none mb-0.5">
                하객 수
              </p>
              <p className="text-sm font-medium text-[var(--hb-text-strong)]">
                {data.guestCount}명
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-[6px] bg-violet-100 flex items-center justify-center text-violet-600 shrink-0">
              <CalendarDays className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[12px] text-[var(--hb-text-muted)] leading-none mb-0.5">
                결혼 시기
              </p>
              <p className="text-sm font-medium text-[var(--hb-text-strong)]">
                {data.weddingDate}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 카테고리별 내역 */}
      {data.categories.length > 0 && (
        <div className="p-4 sm:p-5">
          <h4 className="hb-h-sm text-[var(--hb-text-strong)] mb-3">
            항목별 비용
          </h4>
          <div className="space-y-3">
            {data.categories.map((cat: CostShareCategory) => (
              <div key={cat.key}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-[var(--hb-text-strong)] font-medium">
                      {cat.label}
                    </span>
                    {cat.vendor && (
                      <span className="text-xs text-[var(--hb-text-muted)] truncate">
                        {cat.vendor}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {cat.contractCost != null && cat.extraCost != null && (
                      <span className="text-[11px] text-[var(--hb-text-muted)]">
                        계약 {cat.contractCost.toLocaleString()} + 추가{" "}
                        {cat.extraCost.toLocaleString()}
                      </span>
                    )}
                    <span className="text-sm font-medium text-[var(--hb-text-strong)]">
                      {formatCost(cat.cost)}
                    </span>
                  </div>
                </div>

                {/* 비율 바 */}
                <div className="h-2 bg-[#F5F2ED] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 rounded-full transition-all duration-500"
                    style={{ width: getBarWidth(cat.cost, maxCost) }}
                  />
                </div>

                {cat.notes && (
                  <p className="mt-1 text-xs text-[var(--hb-text-muted)]">{cat.notes}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 후회/잘한/조언 */}
      {(data.regretPoints || data.goodPoints || data.advice) && (
        <div className="p-4 sm:p-5 border-t border-[#F5F2ED] space-y-4">
          {data.regretPoints && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <ThumbsDown className="w-3.5 h-3.5 text-danger-700" />
                <span className="text-xs font-medium text-danger-700">
                  후회한 점
                </span>
              </div>
              <p className="text-sm text-[var(--hb-text-strong)] leading-relaxed whitespace-pre-wrap">
                {data.regretPoints}
              </p>
            </div>
          )}

          {data.goodPoints && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <ThumbsUp className="w-3.5 h-3.5 text-[var(--hb-success)]" />
                <span className="text-xs font-medium text-[var(--hb-success)]">
                  잘한 점
                </span>
              </div>
              <p className="text-sm text-[var(--hb-text-strong)] leading-relaxed whitespace-pre-wrap">
                {data.goodPoints}
              </p>
            </div>
          )}

          {data.advice && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <MessageSquareText className="w-3.5 h-3.5 text-[var(--color-paper-tape-ink)]" />
                <span className="text-xs font-medium text-[var(--color-paper-tape-ink)]">
                  조언
                </span>
              </div>
              <p className="text-sm text-[var(--hb-text-strong)] leading-relaxed whitespace-pre-wrap">
                {data.advice}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
