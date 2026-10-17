import type { Metadata } from "next";

export const metadata: Metadata = { title: "웨딩 체크리스트 | 웨딩한방" };

export default function ChecklistLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
