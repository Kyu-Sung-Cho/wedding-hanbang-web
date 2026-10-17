import type { Metadata } from "next";

export const metadata: Metadata = { title: "아모라가 기억하는 것 | 웨딩한방" };

export default function AmoraMemoryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
