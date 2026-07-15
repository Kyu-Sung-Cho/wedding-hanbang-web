import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "견적 체크 신규 제공 종료 | 웨딩한방",
  description:
    "견적 체크는 현재 신규 제공하지 않습니다. 일정·예산을 직접 기록하고, 업체 견적서와 계약서 원문에서 확인할 질문은 아모라와 정리해 주세요.",
  robots: { index: false, follow: false },
};

export default function QuoteCheckLayout({ children }: { children: React.ReactNode }) {
  return children;
}
