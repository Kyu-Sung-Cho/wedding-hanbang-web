"use client";

import type {
  WeddingStyle,
  PriorityItem,
  BudgetTendency,
  GuestCount,
  WeddingPreferences,
} from "@/types/onboarding.types";
import {
  WEDDING_BUDGET_TENDENCY_OPTIONS,
  WEDDING_GUEST_COUNT_OPTIONS,
  WEDDING_PRIORITY_OPTIONS,
  WEDDING_STYLE_OPTIONS,
} from "@hanbang/shared";

interface WeddingStylePreferencesProps {
  preferences: WeddingPreferences;
  onStyleChange: (style: WeddingStyle) => void;
  onTogglePriority: (item: PriorityItem) => void;
  onBudgetTendencyChange: (tendency: BudgetTendency) => void;
  onGuestCountChange: (count: GuestCount) => void;
}

const STYLE_EMOJI: Record<WeddingStyle, string> = {
  minimal: "\u{1F90D}",
  classic: "\u{1F3DB}\uFE0F",
  fancy: "\u2728",
  natural: "\u{1F33F}",
};

const PRIORITY_EMOJI: Record<PriorityItem, string> = {
  sdm: "\u{1F4F8}",
  venue: "\u{1F3F0}",
  rings: "\u{1F48D}",
  honeymoon: "\u2708\uFE0F",
  ceremony: "\u{1F38A}",
  housing: "\u{1F3E0}",
};

const BUDGET_EMOJI: Record<BudgetTendency, string> = {
  saving: "\u{1F4B0}",
  balanced: "\u2696\uFE0F",
  premium: "\u{1F48E}",
};

const STYLE_OPTIONS = WEDDING_STYLE_OPTIONS.map((option) => ({
  ...option,
  emoji: STYLE_EMOJI[option.value],
  desc: option.description,
}));

const PRIORITY_OPTIONS = WEDDING_PRIORITY_OPTIONS.map((option) => ({
  ...option,
  emoji: PRIORITY_EMOJI[option.value],
}));

const BUDGET_OPTIONS = WEDDING_BUDGET_TENDENCY_OPTIONS.map((option) => ({
  ...option,
  emoji: BUDGET_EMOJI[option.value],
  desc: option.description,
}));

const GUEST_OPTIONS = WEDDING_GUEST_COUNT_OPTIONS;

export default function WeddingStylePreferences({
  preferences,
  onStyleChange,
  onTogglePriority,
  onBudgetTendencyChange,
  onGuestCountChange,
}: WeddingStylePreferencesProps) {
  return (
    <div className="space-y-7">
      <div className="text-center">
        <h2 className="text-[22px] font-semibold text-[var(--hb-text-strong)] mb-2">
          결혼식 선호
        </h2>
        <p className="text-[14px] text-[var(--hb-text-muted)]">
          알고 있는 만큼만 골라도 돼요
        </p>
      </div>

      {/* Q1: 결혼식 분위기 */}
      <div className="space-y-3">
        <p className="text-[14px] font-medium text-[var(--hb-text-strong)]">
          결혼식 공간과 연출에서 원하는 분위기는 무엇인가요?
        </p>
        <div className="grid grid-cols-2 gap-3">
          {STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onStyleChange(opt.value)}
              className={`p-4 rounded-2xl border-2 transition-all hover:-translate-y-0.5 text-center ${
                preferences.weddingStyle === opt.value
                  ? "border-rose-500 bg-rose-500/5 shadow-[var(--shadow-raised)]"
                  : "border-black/[0.06] bg-white hover:border-black/[0.12]"
              }`}
            >
              <div className="text-[28px] mb-1.5">{opt.emoji}</div>
              <div className="text-[15px] font-semibold text-[var(--hb-text-strong)]">
                {opt.label}
              </div>
              <div className="text-[11px] text-[var(--hb-text-muted)] mt-0.5">
                {opt.desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Q2: 가장 중요한 항목 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-medium text-[var(--hb-text-strong)]">
            더 중요하게 생각하는 항목은 무엇인가요?
          </p>
          <span className="text-[11px] text-[var(--hb-text-muted)]">
            최대 3개 선택
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {PRIORITY_OPTIONS.map((opt) => {
            const selected = preferences.priorities.includes(opt.value);
            const disabled =
              !selected && preferences.priorities.length >= 3;
            return (
              <button
                key={opt.value}
                onClick={() => onTogglePriority(opt.value)}
                disabled={disabled}
                className={`relative p-3 rounded-xl border-2 transition-all text-center ${
                  selected
                    ? "border-rose-500 bg-rose-500/5 shadow-[var(--shadow-raised)]"
                    : disabled
                      ? "border-black/[0.04] bg-black/[0.02] opacity-50 cursor-not-allowed"
                      : "border-black/[0.06] bg-white hover:border-black/[0.12]"
                }`}
              >
                {selected && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-rose-500 flex items-center justify-center">
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="3"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
                <div className="text-[22px] mb-1">{opt.emoji}</div>
                <div className="text-[12px] font-medium text-[var(--hb-text-strong)]">
                  {opt.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Q3: 예산 성향 */}
      <div className="space-y-3">
        <p className="text-[14px] font-medium text-[var(--hb-text-strong)]">
          돈을 쓸 때 어떤 기준을 더 중요하게 생각하나요?
        </p>
        <div className="grid grid-cols-3 gap-2.5">
          {BUDGET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onBudgetTendencyChange(opt.value)}
              className={`p-3.5 rounded-xl border-2 transition-all text-center ${
                preferences.budgetTendency === opt.value
                  ? "border-rose-500 bg-rose-500/5 shadow-[var(--shadow-raised)]"
                  : "border-black/[0.06] bg-white hover:border-black/[0.12]"
              }`}
            >
              <div className="text-[22px] mb-1">{opt.emoji}</div>
              <div className="text-[13px] font-semibold text-[var(--hb-text-strong)]">
                {opt.label}
              </div>
              <div className="text-[10px] text-[var(--hb-text-muted)] mt-0.5">
                {opt.desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Q4: 예상 하객 수 */}
      <div className="space-y-3">
        <p className="text-[14px] font-medium text-[var(--hb-text-strong)]">
          예상 하객 수는?
        </p>
        <div className="flex flex-col gap-2">
          {GUEST_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onGuestCountChange(opt.value)}
              className={`w-full px-4 py-3 rounded-xl border-2 transition-all text-left text-[13px] font-medium ${
                preferences.guestCount === opt.value
                  ? "border-rose-500 bg-rose-500/5 text-[var(--hb-text-strong)] shadow-[var(--shadow-raised)]"
                  : "border-black/[0.06] bg-white text-[var(--hb-text-body)] hover:border-black/[0.12]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
