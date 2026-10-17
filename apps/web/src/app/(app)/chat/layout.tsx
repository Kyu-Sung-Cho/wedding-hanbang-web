import type { Metadata } from "next";

// 아래 결정 보드·나만 보는 할 일 페이지는 자기 제목으로 이 제목을 덮는다.
export const metadata: Metadata = { title: "아모라 | 웨딩한방" };

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
