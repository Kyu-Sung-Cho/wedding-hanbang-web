"use client";

import { useState } from "react";

interface WeddingDetailsProps {
  weddingDate: string | null;
  weddingDateUndecided: boolean;
  venue: string | null;
  venueUndecided: boolean;
  sanggyeonryeDate: string | null;
  sanggyeonryeUndecided: boolean;
  budget: number;
  onDateChange: (date: string | null) => void;
  onDateUndecidedChange: (value: boolean) => void;
  onVenueChange: (venue: string | null) => void;
  onVenueUndecidedChange: (value: boolean) => void;
  onSanggyeonryeDateChange: (date: string | null) => void;
  onSanggyeonryeUndecidedChange: (value: boolean) => void;
  onBudgetChange: (budget: number) => void;
  isPartnerData?: boolean;
}

const BUDGET_OPTIONS = [
  { value: 10000000, label: "1,000만원" },
  { value: 15000000, label: "1,500만원" },
  { value: 20000000, label: "2,000만원" },
  { value: 25000000, label: "2,500만원" },
  { value: 30000000, label: "3,000만원" },
  { value: 40000000, label: "4,000만원" },
  { value: 50000000, label: "5,000만원 이상" },
];

export default function WeddingDetails({
  weddingDate,
  weddingDateUndecided,
  venue,
  venueUndecided,
  sanggyeonryeDate,
  sanggyeonryeUndecided,
  budget,
  onDateChange,
  onDateUndecidedChange,
  onVenueChange,
  onVenueUndecidedChange,
  onSanggyeonryeDateChange,
  onSanggyeonryeUndecidedChange,
  onBudgetChange,
  isPartnerData,
}: WeddingDetailsProps) {
  const [showCustomBudget, setShowCustomBudget] = useState(
    budget > 50000000 || (budget >= 50000000 && !BUDGET_OPTIONS.some((o) => o.value === budget))
  );
  const [customBudgetText, setCustomBudgetText] = useState(
    budget > 50000000 ? String(budget / 10000) : ""
  );

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-[22px] font-semibold text-noir-800 mb-2">
          웨딩 정보
        </h2>
        <p className="text-[14px] text-taupe-400">
          {isPartnerData
            ? "파트너가 설정한 정보입니다. 수정할 수 있어요."
            : "아직 정하지 않은 항목은 '미정'을 선택하세요"}
        </p>
      </div>

      {/* 결혼 날짜 */}
      <div className="space-y-2">
        <label className="text-[14px] font-medium text-noir-800">결혼 예정일</label>
        <div className="flex gap-2">
          <input
            type="date"
            value={weddingDate ?? ""}
            onChange={(e) => onDateChange(e.target.value || null)}
            disabled={weddingDateUndecided}
            min={new Date().toISOString().split("T")[0]}
            className="flex-1 px-4 py-3 rounded-xl border border-black/[0.06] bg-white text-[14px] text-noir-800 outline-none focus:border-rose-500 transition-colors disabled:opacity-40"
          />
          <button
            onClick={() => {
              onDateUndecidedChange(!weddingDateUndecided);
              if (!weddingDateUndecided) onDateChange(null);
            }}
            className={`px-4 py-3 rounded-xl text-[13px] font-medium transition-all ${
              weddingDateUndecided
                ? "bg-[#795252] text-white"
                : "bg-black/[0.04] text-taupe-500 hover:bg-black/[0.08]"
            }`}
          >
            미정
          </button>
        </div>
      </div>

      {/* 상견례 날짜 — 모멘트 루프 연료(친언니가 먼저 챙기는 첫 순간) */}
      <div className="space-y-2">
        <label className="text-[14px] font-medium text-noir-800">상견례 날짜</label>
        <div className="flex gap-2">
          <input
            type="date"
            value={sanggyeonryeDate ?? ""}
            onChange={(e) => onSanggyeonryeDateChange(e.target.value || null)}
            disabled={sanggyeonryeUndecided}
            className="flex-1 px-4 py-3 rounded-xl border border-black/[0.06] bg-white text-[14px] text-noir-800 outline-none focus:border-rose-500 transition-colors disabled:opacity-40"
          />
          <button
            onClick={() => {
              onSanggyeonryeUndecidedChange(!sanggyeonryeUndecided);
              if (!sanggyeonryeUndecided) onSanggyeonryeDateChange(null);
            }}
            className={`px-4 py-3 rounded-xl text-[13px] font-medium transition-all ${
              sanggyeonryeUndecided
                ? "bg-[#795252] text-white"
                : "bg-black/[0.04] text-taupe-500 hover:bg-black/[0.08]"
            }`}
          >
            미정
          </button>
        </div>
        <p className="text-[12px] text-taupe-400 leading-relaxed">
          날짜를 입력하면 이번 주 카드와 일정 화면에서 준비 항목을 확인할 수 있어요. 이메일·문자 선제 알림은 아직 제공하지 않습니다.
        </p>
      </div>

      {/* 예식장 */}
      <div className="space-y-2">
        <label className="text-[14px] font-medium text-noir-800">예식장</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={venue ?? ""}
            onChange={(e) => onVenueChange(e.target.value || null)}
            disabled={venueUndecided}
            placeholder="예: 더 라움, 호텔 A 등"
            className="flex-1 px-4 py-3 rounded-xl border border-black/[0.06] bg-white text-[14px] text-noir-800 outline-none focus:border-rose-500 transition-colors placeholder:text-taupe-400 disabled:opacity-40"
          />
          <button
            onClick={() => {
              onVenueUndecidedChange(!venueUndecided);
              if (!venueUndecided) onVenueChange(null);
            }}
            className={`px-4 py-3 rounded-xl text-[13px] font-medium transition-all ${
              venueUndecided
                ? "bg-[#795252] text-white"
                : "bg-black/[0.04] text-taupe-500 hover:bg-black/[0.08]"
            }`}
          >
            미정
          </button>
        </div>
      </div>

      {/* 예산 */}
      <div className="space-y-2">
        <label className="text-[14px] font-medium text-noir-800">
          총 예산 (대략적으로)
        </label>
        <div className="grid grid-cols-2 gap-2">
          {BUDGET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                if (opt.value === 50000000) {
                  setShowCustomBudget(true);
                  onBudgetChange(opt.value);
                } else {
                  setShowCustomBudget(false);
                  setCustomBudgetText("");
                  onBudgetChange(opt.value);
                }
              }}
              className={`px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all ${
                opt.value === 50000000
                  ? showCustomBudget
                    ? "bg-[#795252] text-white"
                    : "bg-black/[0.04] text-taupe-500 hover:bg-black/[0.08]"
                  : budget === opt.value && !showCustomBudget
                    ? "bg-[#795252] text-white"
                    : "bg-black/[0.04] text-taupe-500 hover:bg-black/[0.08]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {showCustomBudget && (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={customBudgetText}
              onChange={(e) => {
                const num = e.target.value.replace(/[^\d]/g, "");
                setCustomBudgetText(num);
                if (num) {
                  onBudgetChange(Number(num) * 10000);
                }
              }}
              placeholder="예: 7000"
              className="flex-1 px-4 py-3 rounded-xl border border-black/[0.06] bg-white text-[14px] text-noir-800 outline-none focus:border-rose-500 transition-colors placeholder:text-taupe-400"
            />
            <span className="text-[13px] text-taupe-500 whitespace-nowrap">만원</span>
          </div>
        )}
      </div>
    </div>
  );
}
