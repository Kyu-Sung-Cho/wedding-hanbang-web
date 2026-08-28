"use client";

import { PREPARATION_PROGRESS_STATUS_OPTIONS } from "@hanbang/shared";
import type { ProgressChecklistItem, ChecklistStatus } from "@/types/onboarding.types";

interface ProgressChecklistProps {
  items: ProgressChecklistItem[];
  onStatusChange: (key: string, status: ChecklistStatus) => void;
  onCostChange: (key: string, cost: number | undefined) => void;
  /**
   * 앞 화면에서 고른 단계 때문에 이미 채워져 있다는 사실을 먼저 밝히는 줄.
   * 채워둔 값을 사용자가 직접 말한 것으로 오해하면, 확인 없이 넘어간 상태가
   * 본인 기록으로 남는다. 그래서 화면을 보자마자 읽히는 자리에 둔다.
   */
  stageNotice?: string;
}

export default function ProgressChecklist({ items, onStatusChange, onCostChange, stageNotice }: ProgressChecklistProps) {
  const completedCount = items.filter((i) => i.status === "completed").length;
  const inProgressCount = items.filter((i) => i.status === "in_progress").length;
  const notStartedCount = items.filter((i) => i.status === "not_started").length;
  // "안 해요"도 사용자가 직접 표시한 답이다. 완료·준비 중만 세면 그 답이 없던 일이 된다.
  const answeredCount = items.length - notStartedCount;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-[22px] font-semibold text-[var(--hb-text-strong)] mb-2">
          준비 현황
        </h2>
        <p className="text-[14px] text-[var(--hb-text-muted)]">
          이미 시작한 분야가 있으면 현재 상태만 알려주세요
        </p>
      </div>

      {stageNotice && (
        <p className="rounded-2xl bg-[var(--hb-surface-hover)] px-4 py-3 text-[12px] leading-relaxed text-[var(--hb-text-body)]">
          {stageNotice}
        </p>
      )}

      {/* 진행률 */}
      <div className="bg-[var(--hb-surface-hover)] rounded-2xl p-4">
        <div className="flex items-center justify-center gap-6 mb-3">
          <div className="text-center">
            <div className="text-[20px] font-bold text-[#2E7D5A]">{completedCount}</div>
            <div className="text-[10px] text-[var(--hb-text-muted)]">완료</div>
          </div>
          <div className="text-center">
            <div className="text-[20px] font-bold text-rose-500">{inProgressCount}</div>
            <div className="text-[10px] text-[var(--hb-text-muted)]">준비 중</div>
          </div>
          <div className="text-center">
            {/* "안 해요"로 표시한 항목은 아직 남은 일이 아니므로 여기서 세지 않는다. */}
            <div className="text-[20px] font-bold text-[var(--hb-text-muted)]">{notStartedCount}</div>
            <div className="text-[10px] text-[var(--hb-text-muted)]">아직</div>
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
        <div className="text-[11px] text-[var(--hb-text-muted)] mt-2 text-center">
          {answeredCount === 0
            ? "아직 시작한 분야가 없어도 괜찮아요"
            : `${answeredCount}개 분야의 현재 상태를 입력했어요`}
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
            {/* 상태가 4개로 늘면서 좁은 화면에서는 버튼 줄이 항목 이름 자리를 다
                먹는다. 그래서 자리가 모자라면 버튼 줄이 아래로 내려가게 둔다. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              {/* 항목 이름 */}
              {/* 진행 중이거나 끝낸 항목만 진하게 둔다. "아직"과 "안 해요"는 둘 다
                  지금 신경 쓸 일이 아니라서 같은 무게로 보여야 한다. */}
              <span className={`text-[13px] font-medium flex-1 min-w-[88px] ${
                item.status === "completed" || item.status === "in_progress"
                  ? "text-[var(--hb-text-strong)]"
                  : "text-[var(--hb-text-body)]"
              }`}>
                {item.label}
              </span>

              {/* 상태 버튼은 공유 정본을 따른다. 웹만 3개(예정·준비 중·완료)를 쓰던
                  동안에는 앱에서 "안 해요"로 표시한 항목을 웹에서 되돌릴 수 없었다. */}
              <div className="flex gap-1 flex-shrink-0 ml-auto">
                {PREPARATION_PROGRESS_STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => onStatusChange(item.key, opt.value)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                      item.status === opt.value
                        ? opt.value === "completed"
                          ? "bg-[#2E7D5A] text-white"
                          : opt.value === "in_progress"
                            ? "bg-rose-500 text-white"
                            : "bg-taupe-400 text-white"
                        : "bg-black/[0.04] text-[var(--hb-text-muted)] hover:bg-black/[0.08]"
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
                  className="flex-1 px-3 py-2 rounded-lg border border-black/[0.06] bg-white text-[12px] text-[var(--hb-text-strong)] outline-none focus:border-[#2E7D5A] transition-colors placeholder:text-[var(--hb-text-muted)]"
                />
                <span className="text-[11px] text-[var(--hb-text-muted)] whitespace-nowrap">만원</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-[12px] text-[var(--hb-text-muted)] text-center">
        여기서는 분야별 상태만 저장하며, 세부 할 일은 다음 화면에서 직접 확인해요
      </p>
    </div>
  );
}
