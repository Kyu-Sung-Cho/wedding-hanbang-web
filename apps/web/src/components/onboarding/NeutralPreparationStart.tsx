"use client";

import {
  COUPLE_INVITE_CODE_MAX_LENGTH,
  COUPLE_INVITE_CODE_PLACEHOLDER,
  normalizeCoupleInviteCode,
} from "@hanbang/shared";

type NeutralPreparationStartProps = Readonly<{
  coupleAction: "join" | null;
  partnerCode: string;
  loading: boolean;
  onCreate: () => void;
  onSelectJoin: () => void;
  onPartnerCodeChange: (code: string) => void;
  onJoin: () => void;
}>;

export default function NeutralPreparationStart({
  coupleAction,
  partnerCode,
  loading,
  onCreate,
  onSelectJoin,
  onPartnerCodeChange,
  onJoin,
}: NeutralPreparationStartProps) {
  return (
    <section aria-labelledby="neutral-preparation-title" className="space-y-6">
      <div className="text-center">
        <h1
          id="neutral-preparation-title"
          className="text-[22px] font-semibold text-noir-800"
        >
          역할을 정하지 않아도 시작할 수 있어요
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-taupe-500">
          예식일·장소·예산은 나중에 채우고, 지금 상황에 맞는 한 가지부터
          아모라와 정리해요.
        </p>
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
