import type { Metadata } from "next";

export const metadata: Metadata = { title: "일정 | 웨딩한방" };

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
