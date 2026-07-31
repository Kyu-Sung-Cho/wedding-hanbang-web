import type { Metadata } from "next";

// 은퇴한 주소는 /price로 이동한다. 검색 결과도 현재 공시가격 화면으로 모은다.
export const metadata: Metadata = {
  title: "업체가 공개한 결혼 준비 가격 | 웨딩한방",
  description:
    "웨딩 사진 촬영, 드레스, 헤어·메이크업, 결혼식장 업체가 공개한 가격의 기준일과 포함 범위를 확인합니다.",
  alternates: { canonical: "/price" },
  robots: { index: false, follow: true },
  openGraph: {
    title: "업체가 공개한 결혼 준비 가격",
    description: "업체 공개 가격의 기준일과 포함 범위를 확인하세요.",
    url: "/price",
    siteName: "웨딩한방",
    locale: "ko_KR",
    type: "article",
    images: [{ url: "/images/og-image.png", width: 1200, height: 630, alt: "웨딩한방 웨딩 시세표" }],
  },
};

export default function MarketPricesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
