import type { Metadata } from "next";

// 클라이언트 페이지라 여기(서버 레이아웃)에서 메타데이터 제공 — 검색 결과·링크 미리보기용
export const metadata: Metadata = {
  title: "웨딩 견적 확인 질문 체크리스트 | 웨딩한방",
  description:
    "사용자가 입력한 견적에서 포함 여부를 다시 확인할 항목과 계약 전 업체에 물어볼 질문을 정리합니다. 가격 적정성이나 법적 판단을 대신하지 않습니다.",
  alternates: { canonical: "/wedding/community/quote-check" },
  openGraph: {
    title: "웨딩 견적 확인 질문 체크리스트",
    description: "포함 여부 확인 항목과 계약 전 질문을 정리하는 체크리스트.",
    url: "/wedding/community/quote-check",
    siteName: "웨딩한방",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/images/og-image.png", width: 1200, height: 630, alt: "웨딩한방 견적 체크리스트" }],
  },
};

export default function QuoteCheckLayout({ children }: { children: React.ReactNode }) {
  return children;
}
