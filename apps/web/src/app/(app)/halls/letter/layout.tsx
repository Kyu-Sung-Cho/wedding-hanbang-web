import type { Metadata } from "next";

export const metadata: Metadata = { title: "보내기 전 확인 | 웨딩한방" };

export default function HallsLetterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
