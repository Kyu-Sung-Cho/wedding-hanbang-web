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
    <div className="bg-white border border-black/[0.04] rounded-2xl overflow-hidden">
      {/* 요약 바 */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-50 to-white border-b border-[#F5F2ED]">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[21px] text-[#928980] leading-none mb-0.5">
                총 비용
              </p>
              <p className="text-sm font-medium text-[#1A1A1F]">
                {formatCost(data.totalCost)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sky-600 shrink-0">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[21px] text-[#928980] leading-none mb-0.5">
                지역
              </p>
              <p className="text-sm font-medium text-[#1A1A1F]">
                {data.region}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[21px] text-[#928980] leading-none mb-0.5">
                하객 수
              </p>
              <p className="text-sm font-medium text-[#1A1A1F]">
                {data.guestCount}명
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center text-violet-600 shrink-0">
              <CalendarDays className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[21px] text-[#928980] leading-none mb-0.5">
                결혼 시기
              </p>
              <p className="text-sm font-medium text-[#1A1A1F]">
                {data.weddingDate}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 카테고리별 내역 */}
      {data.categories.length > 0 && (
        <div className="p-4 sm:p-5">
          <h4 className="text-sm font-medium text-[#1A1A1F] mb-3">
            항목별 비용
          </h4>
          <div className="space-y-3">
            {data.categories.map((cat: CostShareCategory) => (
              <div key={cat.key}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-[#1A1A1F] font-medium">
                      {cat.label}
                    </span>
                    {cat.vendor && (
                      <span className="text-xs text-[#928980] truncate">
                        {cat.vendor}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {cat.contractCost != null && cat.extraCost != null && (
                      <span className="text-[21px] text-[#B5ADA3]">
                        계약 {cat.contractCost.toLocaleString()} + 추가{" "}
                        {cat.extraCost.toLocaleString()}
                      </span>
                    )}
                    <span className="text-sm font-medium text-[#1A1A1F]">
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
                  <p className="mt-1 text-xs text-[#928980]">{cat.notes}</p>
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
                <ThumbsDown className="w-3.5 h-3.5 text-red-400" />
                <span className="text-xs font-medium text-red-500">
                  후회한 점
                </span>
              </div>
              <p className="text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap">
                {data.regretPoints}
              </p>
            </div>
          )}

          {data.goodPoints && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <ThumbsUp className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-xs font-medium text-emerald-600">
                  잘한 점
                </span>
              </div>
              <p className="text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap">
                {data.goodPoints}
              </p>
            </div>
          )}

          {data.advice && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <MessageSquareText className="w-3.5 h-3.5 text-[#C9A96E]" />
                <span className="text-xs font-medium text-[#C9A96E]">
                  조언
                </span>
              </div>
              <p className="text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap">
                {data.advice}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
