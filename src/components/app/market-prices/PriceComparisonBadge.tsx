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
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[25px] font-medium bg-taupe-400/10 text-taupe-500">
        적정
      </span>
    );
  }

  if (percent > 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[25px] font-medium bg-[#C4967E]/10 text-[#C4967E]">
        +{percent}%
      </span>
    );
  }

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[25px] font-medium bg-[#2E7D5A]/10 text-[#2E7D5A]">
      {percent}%
    </span>
  );
}
