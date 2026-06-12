import type { Metadata } from "next";

// 클라이언트 페이지라 여기(서버 레이아웃)에서 메타데이터 제공 — 검색 결과·링크 미리보기용
export const metadata: Metadata = {
  title: "스드메 견적 체크리스트 — 계약 전 빠진 항목 확인 | 웨딩한방",
  description:
    "견적서에 빠지기 쉬운 항목(원본비·헬퍼비·피팅비)과 한국소비자원 평균가, 계약 전 업체에 물어볼 질문을 정리해 드립니다. 로그인 없이 무료.",
  alternates: { canonical: "/wedding/community/quote-check" },
  openGraph: {
    title: "스드메 견적 체크리스트 — 계약 전 빠진 항목 확인",
    description: "빠진 항목 + 소비자원 평균가 + 계약 전 질문. 로그인 없이 무료.",
    url: "/wedding/community/quote-check",
    siteName: "웨딩한방",
    locale: "ko_KR",
    type: "article",
    images: [{ url: "/images/og-image.png", width: 1200, height: 630, alt: "웨딩한방 견적 체크리스트" }],
  },
};

export default function QuoteCheckLayout({ children }: { children: React.ReactNode }) {
  return children;
}
