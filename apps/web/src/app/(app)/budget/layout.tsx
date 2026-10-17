import type { Metadata } from "next";

// 탭 제목과 화면낭독기의 쪽 이동 안내가 이 제목을 읽는다. 루트 제목 하나로는 화면을 옮겨도 안내가 없다.
export const metadata: Metadata = { title: "예산 | 웨딩한방" };

export default function BudgetLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
