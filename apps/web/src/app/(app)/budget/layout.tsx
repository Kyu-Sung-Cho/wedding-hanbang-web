"use client";

import PostCountGate from "@/components/app/PostCountGate";

export default function BudgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <PostCountGate
      featureName="예산 관리"
      featureDescription="20개 카테고리·숨은 비용 경고·한국소비자원 시세 비교까지 한 번에."
    >
      {children}
    </PostCountGate>
  );
}
