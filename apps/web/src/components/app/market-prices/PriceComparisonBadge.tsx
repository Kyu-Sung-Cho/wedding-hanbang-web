"use client";

interface PriceComparisonBadgeProps {
  userBudget: number;    // 원 단위
  marketPrice: number;   // 만원 단위
}

export default function PriceComparisonBadge({ userBudget, marketPrice }: PriceComparisonBadgeProps) {
  if (userBudget <= 0 || marketPrice <= 0) return null;

  const budgetMan = Math.round(userBudget / 10000);
  const diff = budgetMan - marketPrice;
  const percent = Math.round((diff / marketPrice) * 100);

  if (Math.abs(percent) < 10) {
    return (
      <span
        aria-label="공식 참고값과의 차이가 10퍼센트 미만"
        className="inline-flex items-center rounded-full bg-taupe-400/10 px-2 py-1 text-xs font-medium text-taupe-600"
      >
        참고값 ±10% 안
      </span>
    );
  }

  if (percent > 0) {
    return (
      <span
        aria-label={`공식 참고값보다 ${percent}퍼센트 높음`}
        className="inline-flex items-center rounded-full bg-[#C4967E]/10 px-2 py-1 text-xs font-medium text-[#7A4F3B]"
      >
        참고값보다 +{percent}%
      </span>
    );
  }

  return (
    <span
      aria-label={`공식 참고값보다 ${Math.abs(percent)}퍼센트 낮음`}
      className="inline-flex items-center rounded-full bg-[#2E7D5A]/10 px-2 py-1 text-xs font-medium text-[#245F47]"
    >
      참고값보다 {percent}%
    </span>
  );
}
