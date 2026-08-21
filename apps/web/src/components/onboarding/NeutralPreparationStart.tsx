"use client";

import {
  COUPLE_INVITE_CODE_MAX_LENGTH,
  COUPLE_INVITE_CODE_PLACEHOLDER,
  WEDDING_PRIORITY_OPTIONS,
  normalizeCoupleInviteCode,
  type WeddingPriorityValue,
} from "@hanbang/shared";

type NeutralPreparationStartProps = Readonly<{
  coupleAction: "join" | null;
  partnerCode: string;
  loading: boolean;
  onCreate: () => void;
  onSelectJoin: () => void;
  onPartnerCodeChange: (code: string) => void;
  onJoin: () => void;
  /** 실패 문구. 없으면 사용자는 버튼이 원상복귀하는 것만 보고 이유를 모른다. */
  error?: string;
  /** 예식일. 비워 두고 시작해도 되고, 나중에 설정에서 넣을 수 있다. */
  weddingDate: string;
  onWeddingDateChange: (value: string) => void;
  /** 지금 신경 쓰이는 것 하나. 첫 대화 초안을 만드는 데만 쓴다. */
  focusPriority: WeddingPriorityValue | null;
  onFocusPriorityChange: (value: WeddingPriorityValue | null) => void;
}>;

/** 오늘 이전 날짜를 고르지 못하게 한다. 지난 날짜는 예식일이 아니다. */
function todayIsoDate(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

export default function NeutralPreparationStart({
  coupleAction,
  partnerCode,
  loading,
  onCreate,
  onSelectJoin,
  onPartnerCodeChange,
  onJoin,
  error = "",
  weddingDate,
  onWeddingDateChange,
  focusPriority,
  onFocusPriorityChange,
}: NeutralPreparationStartProps) {
  return (
    <section aria-labelledby="neutral-preparation-title" className="space-y-6">
      {error ? (
        <p role="alert" className="text-center text-[13px] text-rose-600">
          {error}
        </p>
      ) : null}
      <div className="text-center">
        <h1
          id="neutral-preparation-title"
          className="text-[22px] font-semibold text-noir-800"
        >
          역할을 정하지 않아도 시작할 수 있어요
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-taupe-500">
          지금 아는 것만 알려주세요. 장소·예산은 나중에 채워도 돼요.
        </p>
      </div>

      {/* 예식일 — 아모라가 대신 받아낼 수 없는 유일한 값이라 여기서 묻는다.
          비워 두고 시작해도 막지 않는다. */}
      <div className="space-y-2">
        <label
          htmlFor="neutral-wedding-date"
          className="block text-[14px] font-medium text-noir-800"
        >
          결혼식 날짜, 정하셨어요?
        </label>
        <input
          id="neutral-wedding-date"
          type="date"
          value={weddingDate}
          disabled={loading}
          min={todayIsoDate()}
          onChange={(event) => onWeddingDateChange(event.target.value)}
          className="w-full rounded-2xl border border-black/[0.06] bg-white px-5 py-3.5 text-[16px] text-noir-800 outline-none transition-colors focus:border-rose-500 disabled:opacity-50"
        />
        <p className="text-[12px] text-taupe-400">
          아직이면 비워 두세요. 나중에 언제든 바꿀 수 있어요.
        </p>
      </div>

      {/* 지금 신경 쓰이는 것 — 저장은 곁가지이고, 첫 대화를 여는 게 목적이다.
          첫 인사는 저장된 정보를 먼저 꺼내지 못하므로 초안으로 넘긴다. */}
      <div className="space-y-2">
        <p className="text-[14px] font-medium text-noir-800">
          지금 제일 신경 쓰이는 건 뭐예요?{" "}
          <span className="font-normal text-taupe-400">(선택)</span>
        </p>
        <div className="grid grid-cols-2 gap-2">
          {WEDDING_PRIORITY_OPTIONS.map((option) => {
            const selected = focusPriority === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={loading}
                aria-pressed={selected}
                onClick={() =>
                  onFocusPriorityChange(selected ? null : option.value)
                }
                className={`min-h-11 rounded-2xl border px-3 py-2.5 text-[13px] leading-snug transition-colors disabled:opacity-50 ${
                  selected
                    ? "border-[#795252] bg-[#795252]/[0.08] font-medium text-[#795252]"
                    : "border-black/[0.08] bg-white text-taupe-500 hover:bg-black/[0.02]"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <button
          type="button"
          disabled={loading}
          onClick={onCreate}
          className="w-full rounded-2xl bg-gradient-to-br from-[#795252] to-[#946a6a] px-5 py-4 text-[15px] font-semibold text-white shadow-[0_4px_14px_rgba(121,82,82,0.2)] transition-all hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] disabled:cursor-wait disabled:opacity-50"
        >
          {loading && coupleAction === null ? "준비 중..." : "아모라와 지금 시작하기"}
        </button>
        <button
          type="button"
          disabled={loading}
          aria-expanded={coupleAction === "join"}
          onClick={onSelectJoin}
          className="w-full rounded-2xl border border-black/[0.08] bg-white px-5 py-3.5 text-[14px] font-medium text-noir-800 transition-colors hover:bg-black/[0.02] disabled:opacity-50"
        >
          초대 코드로 함께 시작하기
        </button>
      </div>

      {coupleAction === "join" && (
        <div className="space-y-3 rounded-2xl bg-ivory-100 p-4">
          <label
            htmlFor="neutral-partner-code"
            className="block text-center text-[13px] font-medium text-taupe-500"
          >
            상대방에게 받은 초대 코드
          </label>
          <input
            id="neutral-partner-code"
            type="text"
            value={partnerCode}
            disabled={loading}
            maxLength={COUPLE_INVITE_CODE_MAX_LENGTH}
            placeholder={COUPLE_INVITE_CODE_PLACEHOLDER}
            onChange={(event) => onPartnerCodeChange(
              normalizeCoupleInviteCode(event.target.value),
            )}
            className="w-full rounded-2xl border border-black/[0.06] bg-white px-5 py-3.5 text-center font-mono text-[16px] tracking-[0.2em] text-noir-800 outline-none transition-colors placeholder:text-taupe-400 focus:border-rose-500 disabled:opacity-50"
          />
          <button
            type="button"
            disabled={loading || partnerCode.length === 0}
            onClick={onJoin}
            className="w-full rounded-2xl bg-[#36534E] py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[#243832] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "연결 중..." : "이 코드로 함께 시작하기"}
          </button>
        </div>
      )}

      <p className="text-center text-[12px] leading-relaxed text-taupe-400">
        이 선택만으로 상담 문장이나 준비 완료 기록을 만들지 않아요. 필요한
        변경은 아모라가 먼저 보여주고 확인을 받은 뒤 반영해요.
      </p>
    </section>
  );
}
