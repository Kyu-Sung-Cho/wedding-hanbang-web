"use client";

import BudgetContent from "@/components/app/budget/BudgetContent";

/**
 * 커뮤니티 안에서 예산 관리를 인플레이스로 사용 — /community/budget.
 * CommunityLayout의 nav + footer는 그대로, 메인 영역에 예산 풀 기능 렌더.
 * 풀페이지(/budget)와는 별도 라우트, 같은 BudgetContent 컴포넌트 공유.
 */
export default function CommunityBudgetPage() {
  return <BudgetContent embedded />;
}
