import type { Metadata } from "next";

// 아래 아모라 도움 방식·기억 페이지는 자기 제목으로 이 제목을 덮는다.
export const metadata: Metadata = { title: "설정 | 웨딩한방" };

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
