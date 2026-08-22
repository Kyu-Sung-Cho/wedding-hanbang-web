"use client";

import {
  PREPARATION_STAGE_OPTIONS,
  type PreparationStageValue,
} from "@hanbang/shared";

interface PreparationStageSelectProps {
  selected: PreparationStageValue | null;
  onSelect: (stage: PreparationStageValue) => void;
}

/**
 * 준비 현황을 19줄 대신 한 줄로 먼저 받는 화면.
 *
 * 아직 아무것도 정하지 않은 사람에게 19개 항목을 먼저 내밀면, 첫 화면부터
 * "나는 준비가 안 됐다"를 확인시키는 셈이 된다. 그래서 단계만 필수로 받고
 * 세부 항목은 다음 화면으로 미룬다.
 */
export default function PreparationStageSelect({
  selected,
  onSelect,
}: PreparationStageSelectProps) {
  return (
    <section className="space-y-6" aria-labelledby="preparation-stage-heading">
      <div className="text-center">
        <h2
          id="preparation-stage-heading"
          className="text-[22px] font-semibold text-noir-800 mb-2"
        >
          지금 어디까지 오셨나요?
        </h2>
        <p className="text-[14px] text-taupe-400">
          가장 가까운 하나만 골라주세요
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {PREPARATION_STAGE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
            aria-pressed={selected === option.value}
            className={`w-full px-5 py-4 rounded-2xl border-2 transition-all hover:-translate-y-0.5 text-left ${
              selected === option.value
                ? "border-rose-500 bg-rose-500/5 shadow-[0_4px_16px_rgba(121,82,82,0.15)]"
                : "border-black/[0.06] bg-white hover:border-black/[0.12]"
            }`}
          >
            <div className="text-[15px] font-semibold text-noir-800">
              {option.label}
            </div>
            <div className="text-[12px] text-taupe-400 mt-1">{option.hint}</div>
          </button>
        ))}
      </div>

      {/* 확인되지 않은 기능("나중에 어디서 바꿀 수 있다")을 약속하지 않는다.
          지금 화면에서 사실인 것만 적는다. */}
      <p className="text-[12px] text-taupe-400 text-center leading-relaxed">
        정확하지 않아도 괜찮아요. 다음 화면에서 항목별로 확인할 수 있어요
      </p>
    </section>
  );
}
