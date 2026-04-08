"use client";

import type { ProgressChecklistItem, ChecklistStatus } from "@/types/onboarding.types";

interface ProgressChecklistProps {
  items: ProgressChecklistItem[];
  onStatusChange: (key: string, status: ChecklistStatus) => void;
  onCostChange: (key: string, cost: number | undefined) => void;
}

const STATUS_OPTIONS: { value: ChecklistStatus; label: string }[] = [
  { value: "not_started", label: "예정" },
  { value: "in_progress", label: "진행중" },
  { value: "completed", label: "완료" },
];

export default function ProgressChecklist({ items, onStatusChange, onCostChange }: ProgressChecklistProps) {
  const completedCount = items.filter((i) => i.status === "completed").length;
  const inProgressCount = items.filter((i) => i.status === "in_progress").length;
  const activeCount = completedCount + inProgressCount;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-[53px] font-semibold text-noir-800 mb-2">
          준비 현황
        </h2>
        <p className="text-[53px] text-taupe-400">
          각 항목의 진행 상태를 선택해주세요
        </p>
      </div>

      {/* 진행률 */}
      <div className="bg-ivory-100 rounded-2xl p-4">
        <div className="flex items-center justify-center gap-6 mb-3">
          <div className="text-center">
            <div className="text-[31px] font-bold text-[#2E7D5A]">{completedCount}</div>
            <div className="text-[25px] text-taupe-400">완료</div>
          </div>
          <div className="text-center">
            <div className="text-[31px] font-bold text-rose-500">{inProgressCount}</div>
            <div className="text-[25px] text-taupe-400">진행중</div>
          </div>
          <div className="text-center">
            <div className="text-[31px] font-bold text-taupe-400">{items.length - activeCount}</div>
            <div className="text-[25px] text-taupe-400">예정</div>
          </div>
        </div>
        <div className="w-full bg-black/[0.06] rounded-full h-1.5">
          <div className="flex h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-[#2E7D5A] transition-all"
              style={{ width: `${(completedCount / items.length) * 100}%` }}
            />
            <div
              className="bg-rose-500 transition-all"
              style={{ width: `${(inProgressCount / items.length) * 100}%` }}
            />
          </div>
        </div>
        <div className="text-[27px] text-taupe-400 mt-2 text-center">
          {activeCount === 0
            ? "아직 시작 전이시군요! 함께 준비해요"
            : `${items.length - activeCount}개 항목이 남았어요`}
        </div>
      </div>

      {/* 체크리스트 */}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.key} className={`rounded-xl border transition-all ${
            item.status === "completed"
              ? "border-[#2E7D5A]/30 bg-[#2E7D5A]/[0.03]"
              : item.status === "in_progress"
                ? "border-rose-500/30 bg-rose-500/[0.03]"
                : "border-black/[0.06] bg-white"
          }`}>
            <div className="flex items-center gap-3 px-4 py-3">
              {/* 항목 이름 */}
              <span className={`text-[31px] font-medium flex-1 min-w-0 ${
                item.status !== "not_started" ? "text-noir-800" : "text-taupe-500"
              }`}>
                {item.label}
              </span>

              {/* 상태 버튼 3개 */}
              <div className="flex gap-1 flex-shrink-0">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => onStatusChange(item.key, opt.value)}
                    className={`px-2.5 py-1 rounded-lg text-[27px] font-medium transition-all ${
                      item.status === opt.value
                        ? opt.value === "completed"
                          ? "bg-[#2E7D5A] text-white"
                          : opt.value === "in_progress"
                            ? "bg-rose-500 text-white"
                            : "bg-taupe-400 text-white"
                        : "bg-black/[0.04] text-taupe-400 hover:bg-black/[0.08]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 완료일 때만 비용 입력 */}
            {item.status === "completed" && (
              <div className="flex items-center gap-1.5 px-4 pb-3">
                <input
                  type="text"
                  inputMode="numeric"
                  value={item.cost ? String(item.cost) : ""}
                  onChange={(e) => {
                    const num = e.target.value.replace(/[^\d]/g, "");
                    onCostChange(item.key, num ? Number(num) : undefined);
                  }}
                  placeholder="사용한 비용"
                  className="flex-1 px-3 py-2 rounded-lg border border-black/[0.06] bg-white text-[47px] text-noir-800 outline-none focus:border-[#2E7D5A] transition-colors placeholder:text-taupe-400"
                />
                <span className="text-[27px] text-taupe-400 whitespace-nowrap">만원</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-[47px] text-taupe-400 text-center">
        체크하지 않은 항목은 AI가 우선 안내해드립니다
      </p>
    </div>
  );
}
