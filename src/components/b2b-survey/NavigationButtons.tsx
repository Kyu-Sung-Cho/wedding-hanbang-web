"use client";

interface Props {
  onPrev: () => void;
  onNext: () => void;
  isFirst: boolean;
  isLast: boolean;
  isSubmitting: boolean;
}

export default function NavigationButtons({
  onPrev,
  onNext,
  isFirst,
  isLast,
  isSubmitting,
}: Props) {
  return (
    <div className="flex gap-3 mt-10">
      {!isFirst && (
        <button
          type="button"
          onClick={onPrev}
          className="flex-1 py-3.5 rounded-full border border-platinum text-[53px] text-charcoal font-medium hover:border-taupe-400 transition-colors"
        >
          이전
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={isSubmitting}
        className={`flex-1 py-3.5 rounded-full text-[53px] font-medium transition-all ${
          isLast
            ? "bg-rose-500 text-white hover:bg-rose-600"
            : "bg-noir-800 text-white hover:bg-noir-soft"
        } ${isSubmitting ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        {isSubmitting ? "제출 중..." : isLast ? "설문 제출하기" : "다음"}
      </button>
    </div>
  );
}
