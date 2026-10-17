import type { Metadata } from "next";

export const metadata: Metadata = { title: "예약 관리 | 웨딩한방" };

export default function BookingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
