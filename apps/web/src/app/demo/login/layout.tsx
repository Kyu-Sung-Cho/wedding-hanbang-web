import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "예시 앱 체험 · 웨딩한방",
  description: "계정 없이 예시 데이터로 웨딩한방의 일정, 예산과 아모라 상담 화면을 둘러보세요.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DemoLoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
