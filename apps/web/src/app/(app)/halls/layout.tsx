import type { Metadata } from "next";

// 아래 편지·상담 화면은 자기 layout 의 제목으로 이 제목을 덮는다.
export const metadata: Metadata = { title: "웨딩홀 비교 | 웨딩한방" };

export default function HallsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
