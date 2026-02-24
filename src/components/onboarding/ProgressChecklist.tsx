"use client";

import type { ProgressChecklistItem } from "@/types/onboarding.types";

interface ProgressChecklistProps {
  items: ProgressChecklistItem[];
  onToggle: (key: string) => void;
  onCostChange: (key: string, cost: number | undefined) => void;
}

export default function ProgressChecklist({ items, onToggle, onCostChange }: ProgressChecklistProps) {
  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-[22px] font-semibold text-noir-800 mb-2">
          준비 현황
        </h2>
        <p className="text-[14px] text-taupe-400">
          현재까지 진행한 항목을 체크해주세요
        </p>
      </div>

      {/* 진행률 */}
      <div className="bg-ivory-100 rounded-2xl p-4 text-center">
        <div className="text-[24px] font-bold text-noir-800">
          {doneCount} / {items.length}
        </div>
        <div className="text-[12px] text-taupe-400 mt-1">
          {doneCount === 0
            ? "아직 시작 전이시군요! 함께 준비해요"
            : `${items.length - doneCount}개 항목이 남았어요`}
        </div>
        <div className="w-full bg-black/[0.06] rounded-full h-1.5 mt-3">
          <div
            className="bg-rose-500 h-1.5 rounded-full transition-all"
            style={{ width: `${(doneCount / items.length) * 100}%` }}
          />
        </div>
      </div>

      {/* 체크리스트 */}
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <div key={item.key} className="flex flex-col">
            <button
              onClick={() => onToggle(item.key)}
              className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all ${
                item.done
                  ? "border-rose-500 bg-rose-500/5"
                  : "border-black/[0.06] bg-white hover:border-black/[0.12]"
              }`}
            >
              <div
                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                  item.done
                    ? "bg-rose-500 border-rose-500"
                    : "border-black/[0.15]"
                }`}
              >
                {item.done && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <span
                className={`text-[13px] font-medium ${
                  item.done ? "text-noir-800" : "text-taupe-500"
                }`}
              >
                {item.label}
              </span>
            </button>
            {item.done && (
              <div className="flex items-center gap-1.5 mt-1.5 px-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={item.cost ? String(item.cost) : ""}
                  onChange={(e) => {
                    const num = e.target.value.replace(/[^\d]/g, "");
                    onCostChange(item.key, num ? Number(num) : undefined);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="비용"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-black/[0.06] bg-white text-[12px] text-noir-800 outline-none focus:border-rose-500 transition-colors placeholder:text-taupe-400"
                />
                <span className="text-[11px] text-taupe-400 whitespace-nowrap">만원</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-[12px] text-taupe-400 text-center">
        체크하지 않은 항목은 AI가 우선 안내해드립니다
      </p>
    </div>
  );
}
