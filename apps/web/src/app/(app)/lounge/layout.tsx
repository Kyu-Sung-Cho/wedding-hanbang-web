import type { Metadata } from "next";

export const metadata: Metadata = { title: "웨딩 라운지 | 웨딩한방" };

export default function LoungeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
