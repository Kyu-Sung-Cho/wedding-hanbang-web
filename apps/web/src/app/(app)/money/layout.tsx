import type { Metadata } from "next";

export const metadata: Metadata = { title: "축의금 관리 | 웨딩한방" };

export default function MoneyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
