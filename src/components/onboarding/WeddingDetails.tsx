"use client";

interface WeddingDetailsProps {
  weddingDate: string | null;
  weddingDateUndecided: boolean;
  venue: string | null;
  venueUndecided: boolean;
  budget: number;
  onDateChange: (date: string | null) => void;
  onDateUndecidedChange: (value: boolean) => void;
  onVenueChange: (venue: string | null) => void;
  onVenueUndecidedChange: (value: boolean) => void;
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
  budget,
  onDateChange,
  onDateUndecidedChange,
  onVenueChange,
  onVenueUndecidedChange,
  onBudgetChange,
  isPartnerData,
}: WeddingDetailsProps) {
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
                ? "bg-noir-800 text-white"
                : "bg-black/[0.04] text-taupe-500 hover:bg-black/[0.08]"
            }`}
          >
            미정
          </button>
        </div>
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
                ? "bg-noir-800 text-white"
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
              onClick={() => onBudgetChange(opt.value)}
              className={`px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all ${
                budget === opt.value
                  ? "bg-noir-800 text-white"
                  : "bg-black/[0.04] text-taupe-500 hover:bg-black/[0.08]"
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
