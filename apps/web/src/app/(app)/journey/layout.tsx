import type { Metadata } from "next";

export const metadata: Metadata = { title: "준비 순서 | 웨딩한방" };

export default function JourneyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
