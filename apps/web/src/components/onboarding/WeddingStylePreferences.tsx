"use client";

import type {
  WeddingStyle,
  PriorityItem,
  BudgetTendency,
  GuestCount,
  WeddingPreferences,
} from "@/types/onboarding.types";

interface WeddingStylePreferencesProps {
  preferences: WeddingPreferences;
  onStyleChange: (style: WeddingStyle) => void;
  onTogglePriority: (item: PriorityItem) => void;
  onBudgetTendencyChange: (tendency: BudgetTendency) => void;
  onGuestCountChange: (count: GuestCount) => void;
}

const STYLE_OPTIONS: {
  value: WeddingStyle;
  emoji: string;
  label: string;
  desc: string;
}[] = [
  { value: "minimal", emoji: "\u{1F90D}", label: "\uBBF8\uB2C8\uBA40", desc: "\uAE54\uB054\uD558\uACE0 \uC2EC\uD50C\uD558\uAC8C" },
  { value: "classic", emoji: "\u{1F3DB}\uFE0F", label: "\uD074\uB798\uC2DD", desc: "\uC804\uD1B5\uC801\uC774\uACE0 \uACA9\uC2DD\uC788\uAC8C" },
  { value: "fancy", emoji: "\u2728", label: "\uD654\uB824\uD55C", desc: "\uD654\uB824\uD558\uACE0 \uD2B9\uBCC4\uD558\uAC8C" },
  { value: "natural", emoji: "\u{1F33F}", label: "\uC790\uC5F0\uC2A4\uB7EC\uC6B4", desc: "\uD3B8\uC548\uD558\uACE0 \uC790\uC720\uB86D\uAC8C" },
];

const PRIORITY_OPTIONS: {
  value: PriorityItem;
  emoji: string;
  label: string;
}[] = [
  { value: "sdm", emoji: "\u{1F4F8}", label: "\uC2A4\uB4DC\uBA54" },
  { value: "venue", emoji: "\u{1F3F0}", label: "\uC608\uC2DD\uC7A5" },
  { value: "rings", emoji: "\u{1F48D}", label: "\uC608\uBB3C/\uC608\uB2E8" },
  { value: "honeymoon", emoji: "\u2708\uFE0F", label: "\uC2E0\uD63C\uC5EC\uD589" },
  { value: "ceremony", emoji: "\u{1F38A}", label: "\uBCF8\uC2DD \uC5F0\uCD9C" },
  { value: "housing", emoji: "\u{1F3E0}", label: "\uC2E0\uD63C\uC9D1/\uD63C\uC218" },
];

const BUDGET_OPTIONS: {
  value: BudgetTendency;
  emoji: string;
  label: string;
  desc: string;
}[] = [
  { value: "saving", emoji: "\u{1F4B0}", label: "\uC808\uC57D\uD615", desc: "\uCD5C\uC18C\uD55C\uC73C\uB85C \uD569\uB9AC\uC801\uC73C\uB85C" },
  { value: "balanced", emoji: "\u2696\uFE0F", label: "\uAC00\uC131\uBE44", desc: "\uAF2D \uD544\uC694\uD55C \uACF3\uC5D0 \uD22C\uC790" },
  { value: "premium", emoji: "\u{1F48E}", label: "\uD504\uB9AC\uBBF8\uC5C4", desc: "\uCD5C\uACE0\uC758 \uD000\uB9AC\uD2F0\uB97C \uC6D0\uD574\uC694" },
];

const GUEST_OPTIONS: {
  value: GuestCount;
  label: string;
}[] = [
  { value: "under50", label: "50\uBA85 \uC774\uD558 (\uC2A4\uBAB0\uC6E8\uB529)" },
  { value: "50to100", label: "50~100\uBA85" },
  { value: "100to200", label: "100~200\uBA85" },
  { value: "200to300", label: "200~300\uBA85" },
  { value: "over300", label: "300\uBA85 \uC774\uC0C1" },
];

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
        <h2 className="text-[22px] font-semibold text-noir-800 mb-2">
          웨딩 스타일
        </h2>
        <p className="text-[14px] text-taupe-400">
          취향에 맞는 추천을 위해 알려주세요
        </p>
      </div>

      {/* Q1: 웨딩 스타일 */}
      <div className="space-y-3">
        <p className="text-[14px] font-medium text-noir-800">
          원하는 웨딩 스타일은?
        </p>
        <div className="grid grid-cols-2 gap-3">
          {STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onStyleChange(opt.value)}
              className={`p-4 rounded-2xl border-2 transition-all hover:-translate-y-0.5 text-center ${
                preferences.weddingStyle === opt.value
                  ? "border-rose-500 bg-rose-500/5 shadow-[0_4px_16px_rgba(196,150,126,0.15)]"
                  : "border-black/[0.06] bg-white hover:border-black/[0.12]"
              }`}
            >
              <div className="text-[28px] mb-1.5">{opt.emoji}</div>
              <div className="text-[15px] font-semibold text-noir-800">
                {opt.label}
              </div>
              <div className="text-[11px] text-taupe-400 mt-0.5">
                {opt.desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Q2: 가장 중요한 항목 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-medium text-noir-800">
            가장 중요한 항목은?
          </p>
          <span className="text-[11px] text-taupe-400">
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
                    ? "border-rose-500 bg-rose-500/5 shadow-[0_2px_12px_rgba(196,150,126,0.12)]"
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
                <div className="text-[12px] font-medium text-noir-800">
                  {opt.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Q3: 예산 성향 */}
      <div className="space-y-3">
        <p className="text-[14px] font-medium text-noir-800">
          예산 성향은?
        </p>
        <div className="grid grid-cols-3 gap-2.5">
          {BUDGET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onBudgetTendencyChange(opt.value)}
              className={`p-3.5 rounded-xl border-2 transition-all text-center ${
                preferences.budgetTendency === opt.value
                  ? "border-rose-500 bg-rose-500/5 shadow-[0_2px_12px_rgba(196,150,126,0.12)]"
                  : "border-black/[0.06] bg-white hover:border-black/[0.12]"
              }`}
            >
              <div className="text-[22px] mb-1">{opt.emoji}</div>
              <div className="text-[13px] font-semibold text-noir-800">
                {opt.label}
              </div>
              <div className="text-[10px] text-taupe-400 mt-0.5">
                {opt.desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Q4: 예상 하객 수 */}
      <div className="space-y-3">
        <p className="text-[14px] font-medium text-noir-800">
          예상 하객 수는?
        </p>
        <div className="flex flex-col gap-2">
          {GUEST_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onGuestCountChange(opt.value)}
              className={`w-full px-4 py-3 rounded-xl border-2 transition-all text-left text-[13px] font-medium ${
                preferences.guestCount === opt.value
                  ? "border-rose-500 bg-rose-500/5 text-noir-800 shadow-[0_2px_12px_rgba(196,150,126,0.12)]"
                  : "border-black/[0.06] bg-white text-taupe-500 hover:border-black/[0.12]"
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
