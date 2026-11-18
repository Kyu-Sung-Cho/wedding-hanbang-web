import type { Metadata } from "next";

export const metadata: Metadata = { title: "답장과 상담 확정 | 웨딩한방" };

export default function HallsConsultationLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
