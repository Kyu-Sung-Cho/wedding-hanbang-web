"use client";

import { ymdInKst } from "@/lib/utils/kstDate";

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
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-[22px] font-semibold text-[var(--hb-text-strong)] mb-2">
          웨딩 정보
        </h2>
        <p className="text-[14px] text-[var(--hb-text-muted)]">
          {isPartnerData
            ? "파트너가 설정한 정보입니다. 수정할 수 있어요."
            : "아직 정하지 않은 항목은 '미정'을 선택하세요"}
        </p>
      </div>

      {/* 결혼 날짜 */}
      <div className="space-y-2">
        <label className="text-[14px] font-medium text-[var(--hb-text-strong)]">결혼 예정일</label>
        <div className="flex gap-2">
          <input
            type="date"
            value={weddingDate ?? ""}
            onChange={(e) => onDateChange(e.target.value || null)}
            disabled={weddingDateUndecided}
            min={ymdInKst()}
            className="flex-1 px-4 py-3 rounded-[6px] border border-black/[0.06] bg-white text-[14px] text-[var(--hb-text-strong)] outline-none focus:border-rose-500 transition-colors disabled:opacity-40"
          />
          <button
            onClick={() => {
              onDateUndecidedChange(!weddingDateUndecided);
              if (!weddingDateUndecided) onDateChange(null);
            }}
            className={`px-4 py-3 rounded-[6px] text-[13px] font-medium transition-all ${
              weddingDateUndecided
                ? "bg-[var(--hb-primary)] text-white"
                : "bg-black/[0.04] text-[var(--hb-text-body)] hover:bg-black/[0.08]"
            }`}
          >
            미정
          </button>
        </div>
      </div>

      {/* 두 가족이 처음 만나는 날짜 */}
      <div className="space-y-2">
        <label className="text-[14px] font-medium text-[var(--hb-text-strong)]">
          상견례 (양가 첫 만남) 예정일
        </label>
        <div className="flex gap-2">
          <input
            type="date"
            value={sanggyeonryeDate ?? ""}
            onChange={(e) => onSanggyeonryeDateChange(e.target.value || null)}
            disabled={sanggyeonryeUndecided}
            className="flex-1 px-4 py-3 rounded-[6px] border border-black/[0.06] bg-white text-[14px] text-[var(--hb-text-strong)] outline-none focus:border-rose-500 transition-colors disabled:opacity-40"
          />
          <button
            onClick={() => {
              onSanggyeonryeUndecidedChange(!sanggyeonryeUndecided);
              if (!sanggyeonryeUndecided) onSanggyeonryeDateChange(null);
            }}
            className={`px-4 py-3 rounded-[6px] text-[13px] font-medium transition-all ${
              sanggyeonryeUndecided
                ? "bg-[var(--hb-primary)] text-white"
                : "bg-black/[0.04] text-[var(--hb-text-body)] hover:bg-black/[0.08]"
            }`}
          >
            미정
          </button>
        </div>
        <p className="text-[12px] text-[var(--hb-text-muted)] leading-relaxed">
          날짜를 입력하면 준비 일정에 반영돼요. 알림은 기능 제공 상태와 수신 설정에 따라 별도로 안내합니다.
        </p>
      </div>

      {/* 결혼식장 */}
      <div className="space-y-2">
        <label className="text-[14px] font-medium text-[var(--hb-text-strong)]">결혼식장</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={venue ?? ""}
            onChange={(e) => onVenueChange(e.target.value || null)}
            disabled={venueUndecided}
            placeholder="예: 희망 지역(서울 강남, 경기 분당 등) 또는 식장 이름"
            className="flex-1 px-4 py-3 rounded-[6px] border border-black/[0.06] bg-white text-[14px] text-[var(--hb-text-strong)] outline-none focus:border-rose-500 transition-colors placeholder:text-[var(--hb-text-muted)] disabled:opacity-40"
          />
          <button
            onClick={() => {
              onVenueUndecidedChange(!venueUndecided);
              if (!venueUndecided) onVenueChange(null);
            }}
            className={`px-4 py-3 rounded-[6px] text-[13px] font-medium transition-all ${
              venueUndecided
                ? "bg-[var(--hb-primary)] text-white"
                : "bg-black/[0.04] text-[var(--hb-text-body)] hover:bg-black/[0.08]"
            }`}
          >
            미정
          </button>
        </div>
      </div>

      {/* 예산 */}
      <div className="space-y-2">
        <label className="text-[14px] font-medium text-[var(--hb-text-strong)]">
          결혼 준비에 쓸 총 예산
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={budget > 0 ? String(Math.round(budget / 10000)) : ""}
            onChange={(event) => {
              const digits = event.target.value.replace(/[^\d]/g, "");
              onBudgetChange(digits ? Number(digits) * 10000 : 0);
            }}
            placeholder="직접 입력"
            aria-label="총 예산 금액"
            className="flex-1 px-4 py-3 rounded-[6px] border border-black/[0.06] bg-white text-[14px] text-[var(--hb-text-strong)] outline-none focus:border-rose-500 transition-colors placeholder:text-[var(--hb-text-muted)]"
          />
          <span className="text-[13px] text-[var(--hb-text-body)] whitespace-nowrap">만원</span>
          <button
            type="button"
            onClick={() => onBudgetChange(0)}
            className={`px-4 py-3 rounded-[6px] text-[13px] font-medium transition-all ${
              budget === 0
                ? "bg-[var(--hb-primary)] text-white"
                : "bg-black/[0.04] text-[var(--hb-text-body)] hover:bg-black/[0.08]"
            }`}
          >
            아직 미정
          </button>
        </div>
        <p className="text-[12px] text-[var(--hb-text-muted)] leading-relaxed">
          정한 금액이 있을 때만 입력하세요. 비워 두면 아모라가 금액을 대신 정하지 않습니다.
        </p>
      </div>
    </div>
  );
}
