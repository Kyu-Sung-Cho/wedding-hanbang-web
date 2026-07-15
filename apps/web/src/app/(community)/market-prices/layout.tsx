import type { Metadata } from "next";

// 클라이언트 페이지라 여기(서버 레이아웃)에서 메타데이터 제공 — 검색 결과·링크 미리보기용
export const metadata: Metadata = {
  title: "결혼서비스 공식 가격 조사 (조사월 기준) — 한국소비자원 참가격 | 웨딩한방",
  description:
    "한국소비자원 참가격의 조사월별 예식장 항목과 스드메 평균 계약금액을 조사 범위와 함께 보여줍니다. 개인 견적의 적정성이나 전체 결혼비용을 판정하는 자료가 아닙니다.",
  alternates: { canonical: "/wedding/market-prices" },
  openGraph: {
    title: "결혼서비스 공식 가격 조사 (조사월 기준) — 한국소비자원 참가격",
    description: "조사월·지역·항목별 공개 조사값입니다. 개인 견적이나 전체 결혼비용 판정 자료가 아닙니다.",
    url: "/wedding/market-prices",
    siteName: "웨딩한방",
    locale: "ko_KR",
    type: "article",
    images: [{ url: "/images/og-image.png", width: 1200, height: 630, alt: "웨딩한방 결혼서비스 공식 가격 조사" }],
  },
};

export default function MarketPricesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
