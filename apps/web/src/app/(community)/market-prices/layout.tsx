import type { Metadata } from "next";

// 클라이언트 페이지라 여기(서버 레이아웃)에서 메타데이터 제공 — 검색 결과·링크 미리보기용
export const metadata: Metadata = {
  title: "스드메·웨딩 시세표 — 한국소비자원 참가격 기준 | 웨딩한방",
  description:
    "스튜디오·드레스·메이크업·예식장 평균 가격을 한국소비자원 참가격 공공데이터 기준으로 공개합니다. 지역별 비교, 무료 열람.",
  alternates: { canonical: "/wedding/market-prices" },
  openGraph: {
    title: "스드메·웨딩 시세표 — 한국소비자원 참가격 기준",
    description: "웨딩 평균 가격 공개, 출처 명기, 무료 열람.",
    url: "/wedding/market-prices",
    siteName: "웨딩한방",
    locale: "ko_KR",
    type: "article",
    images: [{ url: "/images/og-image.png", width: 1200, height: 630, alt: "웨딩한방 웨딩 시세표" }],
  },
};

export default function MarketPricesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
