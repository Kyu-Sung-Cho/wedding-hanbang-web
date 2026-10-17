import type { Metadata } from "next";

export const metadata: Metadata = { title: "아모라 도움 방식 | 웨딩한방" };

export default function AmoraStyleLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
